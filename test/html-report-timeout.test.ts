import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cliEnvironment, runCli } from './cli.ts'
import { createProject } from './project.ts'

// Dispatch the already registered command deadline only after report projection
// begins. No CPU-dependent sleep decides whether the check reached delivery.
const preload = `import { createRequire, syncBuiltinESMExports } from 'node:module'
const require = createRequire(import.meta.url)
const fs = require('node:fs')
const read = fs.readFileSync
const write = fs.writeFileSync
const schedule = globalThis.setTimeout
let deadline
let dispatched = false
if (process.argv[1]?.endsWith('/src/cli.ts')) {
  globalThis.setTimeout = function (callback, delay, ...args) {
    if (!deadline && typeof callback === 'function' && delay > 20000) deadline = callback
    return schedule(callback, delay, ...args)
  }
  fs.readFileSync = function (path, ...args) {
    const text = Reflect.apply(read, fs, [path, ...args])
    if (!dispatched && String(path).endsWith('/src/report/template.html')) {
      dispatched = true
      queueMicrotask(() => {
        if (!deadline) throw new Error('Command deadline was not registered')
        write(process.env.BONSAI_REPORT_TIMEOUT_MARKER, 'deadline dispatched')
        deadline()
      })
    }
    return text
  }
  syncBuiltinESMExports()
}
`

test('delivery timeout preserves an established incomplete status and reports the matching exit code', () => {
  for (const [outcome, exitCode] of [
    ['pass', 1],
    ['reject', 1],
    ['incomplete', 2],
  ] as const) {
    const fixture = createProject(
      {
        'app.ts': "export function ready() { return { status: 'ok' } }\n",
        'bindings.ts': "import { ready } from './app.ts'\nexport const actions = { ready }\n",
        'ready.feature':
          'Feature: Readiness\nScenario: Read the status\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n' +
          (outcome === 'incomplete'
            ? 'Scenario: A required action is unbound\n When I invoke "unbound" with {}\n Then response "status" equals "ok"\n'
            : ''),
      },
      outcome === 'reject' ? { bootstrap: 0, hardLimit: 0 } : {},
      'bonsai-report-timeout-',
    )
    try {
      writeFileSync(join(fixture.root, 'report-timeout.js'), preload)
      const destination = join(fixture.root, 'report.html')
      const previous = '<!doctype html><title>Previous complete report</title>'
      writeFileSync(destination, previous)
      const marker = join(fixture.root, 'timeout-dispatched')
      const result = runCli(
        [
          'check',
          '--root',
          fixture.root,
          '--serial',
          '--json',
          '--report',
          'report.html',
          '--timeout',
          '30',
        ],
        {
          cwd: fixture.root,
          timeout: 45000,
          env: cliEnvironment({
            BONSAI_REPORT_TIMEOUT_MARKER: marker,
            BUN_OPTIONS: [process.env.BUN_OPTIONS, '--preload ./report-timeout.js']
              .filter(Boolean)
              .join(' '),
          }),
        },
      )
      assert.equal(result.error, undefined, String(result.error))
      assert.equal(result.signal, null, result.stderr)
      assert.equal(
        existsSync(marker),
        true,
        'The positive marker proves the deadline dispatched during HTML delivery',
      )
      assert.equal(result.status, exitCode, result.stderr || result.stdout)
      assert.equal(JSON.parse(result.stdout).decision.status, outcome)
      const error = JSON.parse(result.stderr)
      assert.equal(error.code, 'TIMEOUT')
      assert.equal(error.exit_code, exitCode)
      assert.equal(readFileSync(destination, 'utf8'), previous)
      assert.equal(
        readdirSync(fixture.root).some((path) => path.startsWith('.bonsai-report-')),
        false,
      )
    } finally {
      fixture.dispose()
    }
  }
})

test('the deadline-dispatch preload observes actual named filesystem imports', () => {
  const fixture = createProject({ 'bindings.ts': 'export const actions = {}\n' })
  try {
    mkdirSync(join(fixture.root, 'src', 'report'), { recursive: true })
    writeFileSync(join(fixture.root, 'report-timeout.js'), preload)
    writeFileSync(join(fixture.root, 'src', 'report', 'template.html'), '<!doctype html>')
    const marker = join(fixture.root, 'deadline-marker')
    writeFileSync(
      join(fixture.root, 'src', 'cli.ts'),
      `import { readFileSync } from 'node:fs'
const timer = setTimeout(() => { process.exitCode = 7 }, 30000)
readFileSync(new URL('./report/template.html', import.meta.url), 'utf8')
await new Promise(resolve => setImmediate(resolve))
clearTimeout(timer)
`,
    )
    const result = spawnSync(
      process.execPath,
      ['--preload', './report-timeout.js', './src/cli.ts'],
      {
        cwd: fixture.root,
        env: cliEnvironment({ BONSAI_REPORT_TIMEOUT_MARKER: marker }),
        encoding: 'utf8',
      },
    )
    assert.equal(result.status, 7, result.stderr)
    assert.equal(readFileSync(marker, 'utf8'), 'deadline dispatched')
  } finally {
    fixture.dispose()
  }
})
