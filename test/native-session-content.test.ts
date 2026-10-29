import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkerIdentity, sessionContentKey } from '../src/identity.ts'
import { nativeBinary } from '../src/native-install.ts'
import { createProject } from './project.ts'

const repository = resolve('.')
const require = createRequire(import.meta.url)

test('metadata session content keys do not need a native executable and keep frozen runtime options', () => {
  const environment = { ...process.env, BONSAI_NATIVE_BINARY: '/missing/metadata-only-native' }
  const first = sessionContentKey(environment)
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(sessionContentKey({ ...environment }), first)
  assert.notEqual(
    sessionContentKey({ ...environment, BUN_OPTIONS: '--preload another-module' }),
    first,
  )
  assert.equal(sessionContentKey(environment), first)
})

async function until(
  condition: () => boolean,
  description: string,
  dead?: () => string | undefined,
) {
  const deadline = performance.now() + 15000
  while (!condition()) {
    const stopped = dead?.()
    if (stopped) throw new Error(stopped)
    assert.ok(performance.now() < deadline, description)
    await new Promise((done) => setTimeout(done, 20))
  }
}

test('warm sessions cannot reuse loaded checker or SDK modules after their installed bytes change', {
  timeout: 60000,
}, async () => {
  // Resolve before creating the fixture, preserving the ordinary unsupported-target error locally.
  const binary = nativeBinary()
  const temporary = mkdtempSync(join(tmpdir(), 'bonsai-session-content-'))
  const checker = join(temporary, 'checker')
  const modules = join(checker, 'node_modules')
  const sdk = join(modules, 'tsrs')
  const candidate = createProject({
    'handler.ts': "export function ready() { return { status: 'ok' } }\n",
    'bindings.ts':
      "import { ready } from './handler.ts'\nexport const actions = { ready: ready }\n",
    'ready.feature':
      'Feature: Ready\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
  })
  let owner: ReturnType<typeof spawn> | undefined
  let ownerClosed: Promise<void> | undefined
  let ownerStopped = false
  let diagnostics = ''
  try {
    mkdirSync(checker)
    cpSync(join(repository, 'src'), join(checker, 'src'), { recursive: true })
    cpSync(join(repository, 'package.json'), join(checker, 'package.json'))
    mkdirSync(modules)
    const originalModules = realpathSync(join(repository, 'node_modules'))
    for (const name of readdirSync(originalModules)) {
      if (name === 'tsrs') continue
      symlinkSync(join(originalModules, name), join(modules, name))
    }
    cpSync(realpathSync(dirname(require.resolve('tsrs/package.json'))), sdk, { recursive: true })
    mkdirSync(join(checker, 'test'))
    const ownerEntry = join(checker, 'test', 'native-session-owner.ts')
    writeFileSync(
      ownerEntry,
      readFileSync(join(repository, 'test', 'native-session-owner.ts'), 'utf8') +
        `
writeFileSync(process.argv[5]!, 'ready')
process.on('SIGTERM', () => { void session.close().then(() => process.exit(0)) })
`,
    )
    const loads = join(temporary, 'loads')
    const preload = join(temporary, 'trace.mjs')
    writeFileSync(
      preload,
      `import { appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
if (process.argv[1]?.endsWith('tsrs-worker.ts')) {
 const require = createRequire(${JSON.stringify(join(checker, 'package.json'))})
 const write = process.stdout.write.bind(process.stdout)
 let recorded = false
 process.stdout.write = (chunk, ...args) => {
  if (!recorded && require.cache[require.resolve('typescript')]) {
   appendFileSync(${JSON.stringify(loads)}, JSON.stringify({ pid: process.pid, shared: process.argv[2] === '--session' }) + '\\n')
   recorded = true
  }
  return write(chunk, ...args)
 }
}
`,
    )
    const records = () =>
      readFileSync(loads, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { pid: number; shared: boolean })
    const descriptor = join(temporary, 'descriptor')
    const ready = join(temporary, 'ready')
    const environment = {
      ...process.env,
      BONSAI_NATIVE_BINARY: binary,
      BONSAI_NATIVE_SESSION: undefined,
      BUN_OPTIONS: '--preload ' + pathToFileURL(preload).href,
    }
    owner = spawn(
      process.execPath,
      [ownerEntry, candidate.root, JSON.stringify([...candidate.files].sort()), descriptor, ready],
      { cwd: checker, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    ownerClosed = new Promise((done) =>
      owner!.once('close', () => {
        ownerStopped = true
        done()
      }),
    )
    owner.once('error', (error) => {
      diagnostics += String(error)
    })
    owner.stdout!.on('data', (chunk) => {
      diagnostics += String(chunk)
    })
    owner.stderr!.on('data', (chunk) => {
      diagnostics += String(chunk)
    })
    await until(
      () => existsSync(ready),
      'Owner must warm its native worker',
      () => (ownerStopped ? diagnostics || 'Owner exited before warmup' : undefined),
    )
    const session = readFileSync(descriptor, 'utf8')
    const check = () =>
      new Promise<any>((done, reject) => {
        const child = spawn(
          process.execPath,
          [join(checker, 'src', 'cli.ts'), 'check', '--root', candidate.root, '--json'],
          {
            cwd: checker,
            env: {
              ...environment,
              BONSAI_NATIVE_SESSION: session,
              BONSAI_ROOT: undefined,
              BONSAI_BASE: undefined,
              BONSAI_POLICY: undefined,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        )
        let stdout = '',
          stderr = ''
        const timeout = setTimeout(() => child.kill('SIGKILL'), 20000)
        child.stdout.on('data', (chunk) => {
          stdout += String(chunk)
        })
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk)
        })
        child.once('error', reject)
        child.once('close', (status) => {
          clearTimeout(timeout)
          try {
            assert.equal(status, 0, stderr || stdout)
            done(JSON.parse(stdout))
          } catch (error) {
            reject(error)
          }
        })
      })
    const first = await check()
    assert.equal(records().length, 1, 'An unchanged checker must reuse its warmed lexical process')
    assert.equal(records()[0]!.shared, true)
    const source = join(checker, 'src', 'source.ts')
    const originalSource = readFileSync(source, 'utf8')
    const originalChecker = checkerIdentity(checker)
    assert.equal(originalSource.split('let count = 0').length, 2)
    writeFileSync(source, originalSource.replace('let count = 0', 'let count = 1'))
    assert.notEqual(checkerIdentity(checker).digest, originalChecker.digest)
    const changed = await check()
    const tokens = (report: any) =>
      report.snapshot.source.files.find((file: any) => file.file === 'handler.ts').tokens
    assert.equal(
      tokens(changed),
      tokens(first) + 1,
      'The changed lexical metric must execute, not cached checker code',
    )
    assert.equal(
      changed.snapshot.fingerprint,
      first.snapshot.fingerprint,
      'The consuming candidate did not change',
    )
    assert.notEqual(
      changed.snapshot.identity.checker.digest,
      first.snapshot.identity.checker.digest,
    )
    assert.equal(records().length, 2)
    assert.equal(records()[1]!.shared, false)
    writeFileSync(source, originalSource)
    const restored = await check()
    assert.equal(tokens(restored), tokens(first))
    assert.equal(records().length, 2, 'Restored exact code may reuse the unchanged original owner')
    const sdkEntry = join(sdk, 'dist', 'api', 'async', 'api.js')
    writeFileSync(sdkEntry, readFileSync(sdkEntry, 'utf8') + '\n// installed SDK content changed\n')
    const changedSdk = await check()
    assert.equal(changedSdk.snapshot.fingerprint, first.snapshot.fingerprint)
    assert.notEqual(
      changedSdk.snapshot.identity.compiler.digest,
      first.snapshot.identity.compiler.digest,
    )
    assert.equal(records().length, 3)
    assert.equal(
      records()[2]!.shared,
      false,
      'A changed installed SDK cannot reuse its loaded old module',
    )
  } finally {
    if (owner && !ownerStopped) {
      owner.kill('SIGTERM')
      const forced = setTimeout(() => owner?.kill('SIGKILL'), 1000)
      await ownerClosed
      clearTimeout(forced)
    }
    candidate.dispose()
    rmSync(temporary, { recursive: true, force: true })
  }
})
