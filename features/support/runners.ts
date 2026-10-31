import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { invoke } from './cli.ts'
import { project, write } from './project.ts'

/** A real supporting assertion emits a Vitest-compatible report; it is not a Vitest installation. */
export function checkSupportingSuite(input: {
  case:
    | 'passed'
    | 'failed'
    | 'skipped'
    | 'stale'
    | 'input-overlap'
    | 'coverage-complete'
    | 'coverage-missing'
}) {
  if (input.case === 'coverage-complete' || input.case === 'coverage-missing')
    return checkCoverageScope(input.case)
  const fixture = project({
    ...(input.case === 'input-overlap' ? { 'notes.txt': 'Authored project notes\n' } : {}),
    'app.ts': `export function double(value: number) { return value * ${input.case === 'failed' ? 3 : 2} }
export function ready() { return { status: double(1) > 0 ? 'ready' : 'unavailable' } }
`,
    'bindings.ts': "import { ready } from './app.ts'\nexport const actions = { ready: ready }\n",
    'ready.feature':
      'Feature: Readiness\nScenario: Service is available\n When I invoke "ready" with {}\n Then response "status" equals "ready"\n',
    'suite.test.ts': `import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { double } from './app.ts'
function verify() {
 let status = 'pending'
 if (${input.case !== 'skipped'}) {
  try { assert.equal(double(2), 4); status = 'passed' }
  catch { status = 'failed' }
 }
writeFileSync(new URL('./supporting.json', import.meta.url), JSON.stringify({
 success: status !== 'failed', numTotalTests: 1, numPassedTests: status === 'passed' ? 1 : 0,
 numFailedTests: status === 'failed' ? 1 : 0, numPendingTests: status === 'pending' ? 1 : 0,
 numTodoTests: 0, numTotalTestSuites: 1, numPassedTestSuites: status === 'failed' ? 0 : 1,
 numFailedTestSuites: status === 'failed' ? 1 : 0, numPendingTestSuites: 0,
 testResults: [{ name: 'suite.test.ts', status: status === 'failed' ? 'failed' : 'passed',
 assertionResults: [{ fullName: 'double preserves its rule', status }] }],
}))
process.exitCode = status === 'failed' ? 1 : 0
}
verify()
`,
  })
  try {
    const config = {
      ...fixture.config,
      runners: [
        {
          id: 'supporting-suite',
          adapter: 'vitest-json',
          report: input.case === 'input-overlap' ? 'notes.txt' : 'supporting.json',
          command:
            input.case === 'stale'
              ? [process.execPath, '-e', 'process.exit(0)']
              : [process.execPath, 'suite.test.ts'],
        },
      ],
    }
    write(fixture.root, 'bonsai.json', JSON.stringify(config))
    if (input.case === 'stale') {
      // The old file is valid output from a prior real assertion. The configured command does not replace it.
      execFileSync(process.execPath, ['suite.test.ts'], { cwd: fixture.root, stdio: 'ignore' })
    }
    const report = invoke(['check', '--serial', '--root', fixture.root, '--json'])
    return input.case === 'input-overlap'
      ? {
          ...report,
          maintainedText: existsSync(join(fixture.root, 'notes.txt'))
            ? readFileSync(join(fixture.root, 'notes.txt'), 'utf8')
            : null,
        }
      : report
  } finally {
    fixture.dispose()
  }
}

/** Compatibility reports use real assertion results and explicit executed-function counters. */
function checkCoverageScope(kind: 'coverage-complete' | 'coverage-missing') {
  const fixture = project({
    'app.ts':
      "import { status } from './rules.ts'\nexport let calls = 0\nexport function ready() { calls++; return { status: status() } }\n",
    'rules.ts': "export let calls = 0\nexport function status() { calls++; return 'ready' }\n",
    'bindings.ts': "import { ready } from './app.ts'\nexport const actions = { ready: ready }\n",
    'ready.feature':
      'Feature: Readiness\nScenario: Service is available\n When I invoke "ready" with {}\n Then response "status" equals "ready"\n',
    'suite.test.ts': `import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { ready, calls as appCalls } from './app.ts'
import { calls as ruleCalls } from './rules.ts'
function verify() {
  assert.equal(ready().status, 'ready')
  const measured = (calls: number) => Object.fromEntries(
    ['lines', 'branches', 'functions', 'statements'].map(metric =>
      [metric, { total: 1, covered: calls > 0 ? 1 : 0, skipped: 0 }]))
  const files = { 'app.ts': measured(appCalls),
    ${kind === 'coverage-complete' ? "'rules.ts': measured(ruleCalls)," : ''}
  }
  const total = measured(appCalls + ruleCalls)
  writeFileSync('coverage.json', JSON.stringify({ total, ...files }))
  writeFileSync('supporting.json', JSON.stringify({
    success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0,
    numPendingTests: 0, numTodoTests: 0, numTotalTestSuites: 1,
    numPassedTestSuites: 1, numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: [{ name: 'suite.test.ts', status: 'passed',
      assertionResults: [{ fullName: 'service readiness', status: 'passed' }] }],
  }))
}
verify()
`,
  })
  try {
    write(
      fixture.root,
      'bonsai.json',
      JSON.stringify({
        ...fixture.config,
        runners: [
          {
            id: 'supporting-suite',
            adapter: 'vitest-json',
            command: [process.execPath, 'suite.test.ts'],
            report: 'supporting.json',
            coverage: { report: 'coverage.json', lines: 100, scope: 'maintained-production' },
          },
        ],
      }),
    )
    return invoke(['check', '--root', fixture.root, '--json'])
  } finally {
    fixture.dispose()
  }
}
