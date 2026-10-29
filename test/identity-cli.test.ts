import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cliEnvironment } from './cli.ts'
import { createProject } from './project.ts'

test('checker bytes changed during real native analysis cannot label earlier facts as current', {
  timeout: 60000,
}, () => {
  const checker = mkdtempSync(join(tmpdir(), 'bonsai-identity-cli-'))
  const repository = fileURLToPath(new URL('../', import.meta.url))
  const project = createProject({
    'package.json': '{"type":"module"}\n',
    'handler.ts':
      "import { writeFileSync } from 'node:fs'\nexport function ready() { writeFileSync(new URL('./handler-ran', import.meta.url), 'executed'); return { status: 'ok' } }\n",
    'bindings.ts':
      "import { ready } from './handler.ts'\nexport const actions = { ready: ready }\n",
    'ready.feature':
      'Feature: Ready\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
  })
  try {
    cpSync(join(repository, 'src'), join(checker, 'src'), { recursive: true })
    cpSync(join(repository, 'package.json'), join(checker, 'package.json'))
    symlinkSync(join(repository, 'node_modules'), join(checker, 'node_modules'), 'dir')
    const identity = join(checker, 'src/identity.ts')
    const original = readFileSync(identity, 'utf8')
    const preload = join(checker, 'change-after-analysis.mjs')
    const fault = [
      "import { appendFileSync } from 'node:fs'",
      "if (process.argv[1]?.endsWith('tsrs-worker.ts') && process.env.BONSAI_TEST_IDENTITY_FAULT === '1') {",
      ' const write = process.stdout.write.bind(process.stdout)',
      ' let changed = false',
      ' process.stdout.write = (...args) => {',
      '  const text = String(args[0])',
      '  if (!changed && text.includes(\'"protocol":2\') && text.includes(\'"source":\')) {',
      '   appendFileSync(' +
        JSON.stringify(identity) +
        ", String.fromCharCode(10) + '// controlled identity-content change' + String.fromCharCode(10))",
      '   changed = true',
      '  }',
      '  return write(...args)',
      ' }',
      '}',
    ].join('\n')
    writeFileSync(preload, fault)
    const check = (mutate = false) => {
      const result = spawnSync(
        process.execPath,
        [join(checker, 'src/cli.ts'), 'check', '--root', project.root, '--json'],
        {
          env: cliEnvironment({
            BUN_OPTIONS: '--preload ' + pathToFileURL(preload).href,
            BONSAI_TEST_IDENTITY_FAULT: mutate ? '1' : undefined,
            BONSAI_NATIVE_SESSION: undefined,
          }),
          encoding: 'utf8',
          timeout: 20000,
          maxBuffer: 8 * 1024 * 1024,
        },
      )
      assert.equal(result.error, undefined, String(result.error))
      assert.equal(result.signal, null, result.stderr)
      return { exitCode: result.status, ...JSON.parse(result.stdout || result.stderr) }
    }
    const control = check()
    assert.equal(control.exitCode, 0, JSON.stringify(control))
    assert.equal(control.snapshot.evidence.complete, true)
    assert.equal(existsSync(join(project.root, 'handler-ran')), true)
    rmSync(join(project.root, 'handler-ran'))
    const changed = check(true)
    assert.notEqual(
      readFileSync(identity, 'utf8'),
      original,
      'The controlled byte change must actually occur',
    )
    assert.equal(changed.exitCode, 2, JSON.stringify(changed))
    assert.equal(changed.decision.status, 'incomplete')
    assert.ok(
      changed.snapshot.source.problems.includes(
        'Checker or toolchain changed during source analysis',
      ),
    )
    assert.equal(changed.snapshot.evidence, undefined)
    assert.equal(existsSync(join(project.root, 'handler-ran')), false)
    writeFileSync(identity, original)
    const restored = check()
    assert.equal(restored.exitCode, 0, JSON.stringify(restored))
    assert.equal(restored.snapshot.fingerprint, control.snapshot.fingerprint)
  } finally {
    project.dispose()
    rmSync(checker, { recursive: true, force: true })
  }
})
