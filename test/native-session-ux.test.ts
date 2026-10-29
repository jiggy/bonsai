import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkUx } from '../features/support/ux.ts'
import { nativeBinary } from '../src/native-install.ts'
import { createProject } from './project.ts'

test('ordinary UX checks reuse the matching warmed lexical process', {
  timeout: 60000,
}, async () => {
  const binary = nativeBinary()
  const temporary = mkdtempSync(join(tmpdir(), 'bonsai-ux-session-'))
  const candidate = createProject({
    'handler.ts': "export function ready() { return { status: 'ok' } }\n",
    'bindings.ts':
      "import { ready } from './handler.ts'\nexport const actions = { ready: ready }\n",
    'ready.feature':
      'Feature: Ready\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
  })
  const trace = join(temporary, 'loads')
  const preload = join(temporary, 'trace.mjs')
  const descriptor = join(temporary, 'descriptor')
  const ready = join(temporary, 'ready')
  const entry = fileURLToPath(new URL('./native-session-owner.ts', import.meta.url))
  const manifest = fileURLToPath(new URL('../package.json', import.meta.url))
  const keys = [
    'BUN_OPTIONS',
    'BONSAI_NATIVE_BINARY',
    'BONSAI_NATIVE_SESSION',
    'BONSAI_NO_COLOR',
  ] as const
  const previous = new Map(keys.map((key) => [key, process.env[key]]))
  let owner: ReturnType<typeof spawn> | undefined
  let closed: Promise<void> | undefined
  let stopped = false
  let diagnostics = ''
  try {
    writeFileSync(
      preload,
      [
        "import { appendFileSync } from 'node:fs'",
        "import { createRequire } from 'node:module'",
        "if (process.argv[1]?.endsWith('tsrs-worker.ts')) {",
        ' const require = createRequire(' + JSON.stringify(manifest) + ')',
        ' const write = process.stdout.write.bind(process.stdout)',
        ' let recorded = false',
        ' process.stdout.write = (chunk, ...args) => {',
        "  if (!recorded && require.cache[require.resolve('typescript')]) {",
        '   appendFileSync(' +
          JSON.stringify(trace) +
          ", JSON.stringify({ pid: process.pid, shared: process.argv[2] === '--session' }) + '\\n')",
        '   recorded = true',
        '  }',
        '  return write(chunk, ...args)',
        ' }',
        '}',
      ].join('\n'),
    )
    const environment = {
      ...process.env,
      BUN_OPTIONS: '--preload ' + pathToFileURL(preload).href,
      BONSAI_NATIVE_BINARY: binary,
      BONSAI_NATIVE_SESSION: undefined,
      BONSAI_NO_COLOR: undefined,
    }
    owner = spawn(
      process.execPath,
      [
        entry,
        candidate.root,
        JSON.stringify([...candidate.files].sort()),
        descriptor,
        '--ready',
        ready,
      ],
      {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    closed = new Promise((done) =>
      owner!.once('close', () => {
        stopped = true
        done()
      }),
    )
    const diagnostic = (chunk: unknown) => {
      diagnostics = (diagnostics + String(chunk)).slice(-16384)
    }
    owner.once('error', diagnostic)
    owner.stdout?.on('data', diagnostic)
    owner.stderr?.on('data', diagnostic)
    const deadline = performance.now() + 15000
    while (!existsSync(ready)) {
      assert.equal(stopped, false, diagnostics || 'Native session owner stopped before warmup')
      assert.ok(performance.now() < deadline, diagnostics || 'Native session owner did not warm up')
      await new Promise((done) => setTimeout(done, 20))
    }
    const records = () =>
      readFileSync(trace, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { pid: number; shared: boolean })
    const first = records()
    assert.equal(first.length, 1)
    assert.equal(first[0]!.shared, true)
    const context = {
      BUN_OPTIONS: environment.BUN_OPTIONS,
      BONSAI_NATIVE_BINARY: binary,
      BONSAI_NATIVE_SESSION: readFileSync(descriptor, 'utf8'),
      BONSAI_NO_COLOR: undefined,
    }
    for (const key of keys) {
      const value = context[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    // The broker lives in another process, so these synchronous CLI launches
    // cannot block its listener. Only lexical startup is reused, never source facts.
    for (const kind of ['human-blocker', 'verbose-blocker', 'machine']) {
      const report = checkUx({ case: kind })
      assert.equal(report.exitCode, 2, JSON.stringify(report))
      if (kind === 'machine') {
        assert.equal(report.decision.status, 'incomplete')
        assert.match(report.snapshot.source.problems.join('\n'), /missing-child\.ts/)
      } else {
        assert.equal(report.missingEntryVisible, true)
        assert.equal(report.handlerExecuted, false)
      }
      assert.deepEqual(
        records(),
        first,
        kind + ' must reuse the same warmed lexical process without a cold fallback',
      )
    }
  } finally {
    for (const key of keys) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (owner && !stopped) {
      owner.kill('SIGTERM')
      const force = setTimeout(() => owner?.kill('SIGKILL'), 1000)
      try {
        await closed
      } finally {
        clearTimeout(force)
      }
    }
    candidate.dispose()
    rmSync(temporary, { recursive: true, force: true })
  }
})
