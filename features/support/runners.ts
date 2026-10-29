import { execFileSync } from 'node:child_process'
import { invoke } from './cli.ts'
import { project, write } from './project.ts'

/** A real supporting assertion emits a Vitest-compatible report; it is not a Vitest installation. */
export function checkSupportingSuite(input: { case: 'passed' | 'failed' | 'skipped' | 'stale' }) {
  const fixture = project({
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
          report: 'supporting.json',
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
    return invoke(['check', '--root', fixture.root, '--json'])
  } finally {
    fixture.dispose()
  }
}
