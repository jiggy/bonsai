import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { collectRustSource, CollectorError } from '../src/collector.ts'
import { openNativeSession } from '../src/native-session.ts'

const repository = resolve('.')
const sessionModule = pathToFileURL(resolve('src/native-session.ts')).href
const ownerEntry = fileURLToPath(new URL('./native-session-owner.ts', import.meta.url))

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-session-lifecycle-'))
  const files = ['handler.ts', 'bindings.ts', 'sample.feature', 'bonsai.json']
  writeFileSync(join(root, 'handler.ts'), 'export function sample() { return { status: "ok" } }\n')
  writeFileSync(
    join(root, 'bindings.ts'),
    "import { sample } from './handler.ts'\nexport const actions = { sample: sample }\n",
  )
  writeFileSync(
    join(root, 'sample.feature'),
    'Feature: Sample\nScenario: Run\n When I invoke "sample" with {}\n Then response "status" equals "ok"\n',
  )
  writeFileSync(
    join(root, 'bonsai.json'),
    JSON.stringify({
      maintained: files,
      bindings: 'bindings.ts',
      policy: {
        bootstrap: 10000,
        bootstrapSurface: 1,
        perDoubling: 0,
        hardLimit: 10000,
        maxFeedbackMs: 15000,
      },
    }),
  )
  return { root, files, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function run(script: string, environment: NodeJS.ProcessEnv = {}, args: string[] = []) {
  return capture(
    spawn(process.execPath, [script, ...args], {
      cwd: repository,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
}

function capture(child: ReturnType<typeof spawn>) {
  const completion = new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (done, reject) => {
      let stdout = ''
      let stderr = ''
      child.stdout!.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr!.on('data', (chunk) => {
        stderr += chunk
      })
      child.once('error', reject)
      child.once('close', (status) => done({ status, stdout, stderr }))
    },
  )
  return { child, completion }
}

async function until(predicate: () => boolean, message: string, timeout = 5000) {
  const deadline = performance.now() + timeout
  while (!predicate()) {
    assert.ok(performance.now() < deadline, message)
    await new Promise((done) => setTimeout(done, 10))
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function running(pid: number) {
  if (!alive(pid)) return false
  if (process.platform === 'linux') {
    try {
      return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
    } catch {
      return false
    }
  }
  return true
}

function preload(root: string, body: string) {
  const file = join(root, 'preload.mjs')
  writeFileSync(
    file,
    `import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
if (process.argv[1]?.endsWith('tsrs-worker.ts') && process.argv[2] === '--session') {
  appendFileSync(${JSON.stringify(join(root, 'worker-pids'))}, process.pid + '\\n')
  const write = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk, ...args) => {
    const value = JSON.parse(String(chunk))
    ${body}
    return write(JSON.stringify(value) + '\\n', ...args)
  }
}
`,
  )
  return `--preload ${pathToFileURL(file).href}`
}

async function scoped(options: string, body: (session: string) => Promise<void>) {
  const previous = {
    session: process.env.BONSAI_NATIVE_SESSION,
    binary: process.env.BONSAI_NATIVE_BINARY,
    options: process.env.BUN_OPTIONS,
  }
  delete process.env.BONSAI_NATIVE_SESSION
  delete process.env.BONSAI_NATIVE_BINARY
  process.env.BUN_OPTIONS = options
  let session: Awaited<ReturnType<typeof openNativeSession>> | undefined
  try {
    session = await openNativeSession()
    process.env.BONSAI_NATIVE_SESSION = session.value
    await body(session.value)
  } finally {
    try {
      await session?.close()
    } finally {
      for (const [key, value] of [
        ['BONSAI_NATIVE_SESSION', previous.session],
        ['BONSAI_NATIVE_BINARY', previous.binary],
        ['BUN_OPTIONS', previous.options],
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  }
  if (session) assert.equal(existsSync(dirname(JSON.parse(session.value).path)), false)
}

test('shared native diagnostics are bounded per request instead of over the worker lifetime', {
  timeout: 30000,
}, async () => {
  const project = fixture()
  try {
    await scoped(preload(project.root, "process.stderr.write('x'.repeat(10 * 1024))"), async () => {
      for (let index = 0; index < 8; index++) {
        const result = await collectRustSource(
          project.root,
          project.files,
          'bindings.ts',
          undefined,
          5000,
        )
        assert.deepEqual(result.source.problems, [])
        assert.equal(result.analysis.status, 'complete')
      }
      const pids = readFileSync(join(project.root, 'worker-pids'), 'utf8').trim().split('\n')
      assert.equal(pids.length, 1, 'All eight requests must use one lexical worker')
    })
  } finally {
    project.dispose()
  }
})

test('a busy shared worker lets another CLI collect fresh source and evidence', {
  timeout: 15000,
}, async () => {
  const project = fixture()
  try {
    const gate = join(project.root, 'gate')
    const ready = join(project.root, 'ready')
    const pids = join(project.root, 'worker-pids')
    const file = join(project.root, 'gate-preload.mjs')
    writeFileSync(
      file,
      `import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
if (process.argv[1]?.endsWith('tsrs-worker.ts') && process.argv[2] === '--session') {
  appendFileSync(${JSON.stringify(pids)}, process.pid + '\\n')
  writeFileSync(${JSON.stringify(ready)}, 'ready')
  while (!existsSync(${JSON.stringify(gate)})) await new Promise(done => setTimeout(done, 10))
}
`,
    )
    await scoped(`--preload ${pathToFileURL(file).href}`, async (session) => {
      let firstCompleted = false
      const first = collectRustSource(
        project.root,
        project.files,
        'bindings.ts',
        undefined,
        10000,
      ).then((result) => {
        firstCompleted = true
        return result
      })
      let cli: ReturnType<typeof run> | undefined
      try {
        await until(() => existsSync(ready), 'Shared worker must be occupied before second CLI')
        cli = run(resolve('src/cli.ts'), { BONSAI_NATIVE_SESSION: session }, [
          'check',
          '--root',
          project.root,
          '--engine',
          'rust',
          '--json',
          '--timeout',
          '5',
        ])
        const result = await cli.completion
        assert.equal(result.status, 0, result.stderr || result.stdout)
        const report = JSON.parse(result.stdout)
        assert.equal(report.decision.status, 'pass')
        assert.deepEqual(report.snapshot.source.problems, [])
        assert.equal(report.snapshot.evidence.complete, true)
        assert.deepEqual(
          report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
          ['passed'],
        )
        assert.equal(existsSync(gate), false)
        assert.equal(
          firstCompleted,
          false,
          'Second CLI must finish without waiting for the shared worker',
        )
      } finally {
        writeFileSync(gate, 'release')
        assert.deepEqual((await first).source.problems, [])
        cli?.child.kill('SIGKILL')
        await cli?.completion
      }
      const next = await collectRustSource(
        project.root,
        project.files,
        'bindings.ts',
        undefined,
        5000,
      )
      assert.deepEqual(next.source.problems, [])
      assert.equal(readFileSync(pids, 'utf8').trim().split('\n').length, 1)
    })
  } finally {
    project.dispose()
  }
})

test('malformed shared response identities and DTOs retire the worker before another request', {
  timeout: 30000,
}, async () => {
  for (const mutation of ['value.id += 1', "value.response = { session: 'busy' }"]) {
    const project = fixture()
    try {
      const changed = join(project.root, 'changed')
      const options = preload(
        project.root,
        `if (!existsSync(${JSON.stringify(changed)})) {
        writeFileSync(${JSON.stringify(changed)}, 'changed')
        ${mutation}
      }`,
      )
      await scoped(options, async () => {
        await assert.rejects(
          collectRustSource(project.root, project.files, 'bindings.ts', undefined, 5000),
          (error: unknown) => error instanceof CollectorError && error.code === 'RUST_COLLECTOR',
        )
        const first = Number(readFileSync(join(project.root, 'worker-pids'), 'utf8').trim())
        await until(() => !running(first), 'Rejected worker must stop')
        const repaired = await collectRustSource(
          project.root,
          project.files,
          'bindings.ts',
          undefined,
          5000,
        )
        assert.deepEqual(repaired.source.problems, [])
        // The first healthy caller may use the busy fallback while close events
        // settle. A later caller must obtain a new reusable worker, not old data.
        const reused = await collectRustSource(
          project.root,
          project.files,
          'bindings.ts',
          undefined,
          5000,
        )
        assert.deepEqual(reused.source.problems, [])
        const pids = readFileSync(join(project.root, 'worker-pids'), 'utf8').trim().split('\n')
        assert.equal(pids.length, 2)
        assert.notEqual(pids[0], pids[1])
      })
    } finally {
      project.dispose()
    }
  }
})

test('a worker that exits after its response cannot be accepted during a delayed validation', {
  timeout: 15000,
}, async () => {
  const project = fixture()
  try {
    const options = preload(
      project.root,
      `write(JSON.stringify(value) + '\\n', () => process.exit(17)); return true`,
    )
    await scoped(options, async (session) => {
      const accepted = join(project.root, 'accepted')
      const script = join(project.root, 'client.mjs')
      const request = {
        protocol: 2,
        root: project.root,
        files: project.files,
        bindings: 'bindings.ts',
        cwd: repository,
      }
      writeFileSync(
        script,
        `import { requestNativeSession } from ${JSON.stringify(sessionModule)}
import { writeFileSync } from 'node:fs'
try {
  await requestNativeSession(${JSON.stringify(JSON.stringify(request))}, undefined, 5000, () => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  })
  writeFileSync(${JSON.stringify(accepted)}, 'accepted')
  process.exitCode = 9
} catch (error) { console.log(error.constructor.name) }
`,
      )
      const result = await run(script, { BONSAI_NATIVE_SESSION: session }).completion
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /SessionError/)
      assert.equal(existsSync(accepted), false)
    })
  } finally {
    project.dispose()
  }
})

test('aborting a shared request reaps its compiler and lexical worker', {
  timeout: 15000,
}, async () => {
  const project = fixture()
  const previous = {
    binary: process.env.BONSAI_NATIVE_BINARY,
    session: process.env.BONSAI_NATIVE_SESSION,
    options: process.env.BUN_OPTIONS,
  }
  let close: (() => Promise<void>) | undefined
  try {
    const nativePid = join(project.root, 'native-pid')
    const binary = join(project.root, 'hanging-native.mjs')
    writeFileSync(
      binary,
      `#!${process.execPath}\nimport { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(nativePid)}, String(process.pid))\nsetInterval(() => {}, 1000)\n`,
      { mode: 0o755 },
    )
    delete process.env.BONSAI_NATIVE_SESSION
    process.env.BONSAI_NATIVE_BINARY = binary
    process.env.BUN_OPTIONS = preload(project.root, '')
    const session = await openNativeSession()
    close = session.close
    process.env.BONSAI_NATIVE_SESSION = session.value
    const controller = new AbortController()
    const request = collectRustSource(
      project.root,
      project.files,
      'bindings.ts',
      controller.signal,
      5000,
    )
    await until(() => existsSync(nativePid), 'Compiler must start before cancellation')
    const compiler = Number(readFileSync(nativePid, 'utf8'))
    const worker = Number(readFileSync(join(project.root, 'worker-pids'), 'utf8').trim())
    controller.abort()
    const result = await request
    assert.equal(result.interrupted, true)
    assert.equal(result.analysis.status, 'unsupported')
    await until(() => !alive(compiler), 'Compiler child must be reaped')
    await until(() => !running(worker), 'Cancelled lexical worker must stop')
    await session.close()
    close = undefined
    assert.equal(existsSync(dirname(JSON.parse(session.value).path)), false)
  } finally {
    await close?.()
    for (const [key, value] of [
      ['BONSAI_NATIVE_BINARY', previous.binary],
      ['BONSAI_NATIVE_SESSION', previous.session],
      ['BUN_OPTIONS', previous.options],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    project.dispose()
  }
})

test('hard owner death aborts an active compiler and cleans a warm session scope', {
  timeout: 15000,
}, async () => {
  const project = fixture()
  let owner: ReturnType<typeof run> | undefined
  try {
    const descriptor = join(project.root, 'descriptor')
    const nativePid = join(project.root, 'native-pid')
    const binary = join(project.root, 'hanging-native.mjs')
    writeFileSync(
      binary,
      `#!${process.execPath}\nimport { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(nativePid)}, String(process.pid))\nsetInterval(() => {}, 1000)\n`,
      { mode: 0o755 },
    )
    owner = capture(
      spawn(
        process.execPath,
        [ownerEntry, project.root, JSON.stringify(project.files), descriptor],
        {
          cwd: repository,
          env: {
            ...process.env,
            BONSAI_NATIVE_SESSION: undefined,
            BONSAI_NATIVE_BINARY: binary,
            BUN_OPTIONS: preload(project.root, ''),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    )
    await until(() => existsSync(nativePid), 'Compiler must be active before owner death')
    const compiler = Number(readFileSync(nativePid, 'utf8'))
    const worker = Number(readFileSync(join(project.root, 'worker-pids'), 'utf8').trim())
    const path = JSON.parse(readFileSync(descriptor, 'utf8')).path
    owner.child.kill('SIGKILL')
    await owner.completion
    await until(() => !alive(compiler), 'Orphaned worker must reap the compiler')
    await until(() => !running(worker), 'Orphaned worker must exit after stdin EOF')
    await until(
      () => !existsSync(dirname(path)),
      'Warm session directory must be removed after EOF',
    )
  } finally {
    owner?.child.kill('SIGKILL')
    await owner?.completion
    project.dispose()
  }
})

test('shared requests await compiler shutdown and can abort after the SDK clears its process', {
  timeout: 15000,
}, async () => {
  const project = fixture()
  const previous = {
    binary: process.env.BONSAI_NATIVE_BINARY,
    session: process.env.BONSAI_NATIVE_SESSION,
    options: process.env.BUN_OPTIONS,
  }
  let close: (() => Promise<void>) | undefined
  try {
    const require = createRequire(import.meta.url)
    const manifest = require.resolve('tsrs/package.json')
    const native = require(join(dirname(manifest), 'lib/getExePath.js')).default() as string
    const current = join(project.root, 'proxy-pid')
    const pending = join(project.root, 'shutdown-pending')
    const exited = join(project.root, 'proxy-exited')
    const proxy = join(project.root, 'delayed-native.mjs')
    writeFileSync(
      proxy,
      `#!${process.execPath}
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(current)}, String(process.pid))
const child = spawn(${JSON.stringify(native)}, process.argv.slice(2), { stdio: ['pipe', 'pipe', 'pipe'] })
process.stdin.pipe(child.stdin)
child.stdin.on('error', () => {})
child.stdout.pipe(process.stdout, { end: false })
child.stderr.pipe(process.stderr, { end: false })
child.once('close', code => {
  writeFileSync(${JSON.stringify(pending)}, String(process.pid))
  setTimeout(() => {
    writeFileSync(${JSON.stringify(exited)}, String(process.pid))
    process.exit(code ?? 1)
  }, 2000)
})
`,
      { mode: 0o755 },
    )
    delete process.env.BONSAI_NATIVE_SESSION
    process.env.BONSAI_NATIVE_BINARY = proxy
    process.env.BUN_OPTIONS = preload(project.root, '')
    const session = await openNativeSession()
    close = session.close
    process.env.BONSAI_NATIVE_SESSION = session.value

    const first = await collectRustSource(
      project.root,
      project.files,
      'bindings.ts',
      undefined,
      7000,
    )
    assert.deepEqual(first.source.problems, [])
    const firstProxy = Number(readFileSync(current, 'utf8'))
    assert.equal(readFileSync(exited, 'utf8'), String(firstProxy))
    assert.equal(alive(firstProxy), false, 'A successful request must reap its compiler proxy')

    rmSync(pending)
    rmSync(exited)
    const controller = new AbortController()
    const next = collectRustSource(
      project.root,
      project.files,
      'bindings.ts',
      controller.signal,
      7000,
    )
    await until(() => existsSync(pending), 'The real compiler must close before aborting its proxy')
    const secondProxy = Number(readFileSync(pending, 'utf8'))
    assert.notEqual(secondProxy, firstProxy)
    assert.equal(alive(secondProxy), true)
    const workers = readFileSync(join(project.root, 'worker-pids'), 'utf8').trim().split('\n')
    assert.equal(workers.length, 1, 'Both compiler runs must use the same lexical worker')
    controller.abort()
    const interrupted = await next
    assert.equal(interrupted.interrupted, true)
    await until(() => !alive(secondProxy), 'Abort must reap a proxy after SDK process clearing')
    await until(() => !running(Number(workers[0])), 'Abort must stop the lexical worker')
    assert.equal(existsSync(exited), false, 'Abort must interrupt the delayed proxy exit')
  } finally {
    try {
      await close?.()
    } finally {
      for (const [key, value] of [
        ['BONSAI_NATIVE_BINARY', previous.binary],
        ['BONSAI_NATIVE_SESSION', previous.session],
        ['BUN_OPTIONS', previous.options],
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      project.dispose()
    }
  }
})
