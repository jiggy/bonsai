import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseRunnerReport,
  runnerViolations,
  runSupportingVerification,
  validRunnerEvidence,
  validateRunnerRequirements,
  type RunnerAdapter,
  type RunnerEvidence,
  type RunnerRequirement,
} from '../src/runners.ts'

function vitest(statuses = ['passed']) {
  const counts = (status: string) => statuses.filter((value) => value === status).length
  return JSON.stringify({
    success: !counts('failed'),
    numTotalTests: statuses.length,
    numPassedTests: counts('passed'),
    numFailedTests: counts('failed'),
    numPendingTests: counts('pending') + counts('skipped'),
    numTodoTests: counts('todo'),
    numTotalTestSuites: 1,
    numPassedTestSuites: counts('failed') ? 0 : 1,
    numFailedTestSuites: counts('failed') ? 1 : 0,
    numPendingTestSuites: 0,
    testResults: [
      {
        name: 'orders.test.ts',
        status: counts('failed') ? 'failed' : 'passed',
        assertionResults: statuses.map((status, index) => ({ fullName: `order ${index}`, status })),
      },
    ],
  })
}

test('Vitest adapter observes individual results instead of trusting success alone', () => {
  const passed = parseRunnerReport('vitest-json', vitest())
  assert.equal(passed.complete, true)
  assert.equal(passed.total, 1)
  assert.equal(passed.passed, 1)
  const skipped = parseRunnerReport('vitest-json', vitest(['passed', 'skipped']))
  assert.equal(skipped.skipped, 1)
  const forged = JSON.parse(vitest(['failed']))
  forged.success = true
  assert.equal(parseRunnerReport('vitest-json', JSON.stringify(forged)).complete, false)
})

test('serialized enum fields and protocol versions cannot be coerced from arrays', () => {
  const report = JSON.parse(vitest())
  report.testResults[0].assertionResults[0].status = ['passed']
  assert.equal(parseRunnerReport('vitest-json', JSON.stringify(report)).complete, false)
  const item = evidence('vitest-json', vitest())
  assert.equal(validRunnerEvidence({ ...item, status: ['passed'] }), false)
  const stream = cucumber()
    .split('\n')
    .map((line) => JSON.parse(line))
  stream[0].meta.protocolVersion = ['31.2.0']
  assert.equal(
    parseRunnerReport('cucumber-messages', stream.map((entry) => JSON.stringify(entry)).join('\n'))
      .complete,
    false,
  )
})

const requirement = (adapter: RunnerAdapter = 'vitest-json'): RunnerRequirement => ({
  id: 'unit',
  adapter,
  command: [process.execPath, 'runner.ts'],
  report: '.bonsai/results.json',
  ...(adapter === 'stryker-json' && { minimumMutationScore: 75 }),
})
function evidence(adapter: RunnerAdapter, input: string): RunnerEvidence {
  return {
    ...parseRunnerReport(adapter, input),
    schema: 'bonsai-runner-evidence-v1',
    id: 'unit',
    adapter,
    fingerprint: 'candidate',
    status: 'passed',
    elapsedMs: 1,
    exitCode: 0,
    reportHash: 'a'.repeat(64),
  }
}

test('Vitest summaries cannot conceal missing, empty, unknown, failed suites or skipped tests', () => {
  for (const change of [
    (r: any) => {
      delete r.testResults
    },
    (r: any) => {
      r.numPassedTests = 2
    },
    (r: any) => {
      r.testResults[0].assertionResults[0].status = 'other'
    },
    (r: any) => {
      r.numTotalTestSuites = 3
    },
  ]) {
    const report = JSON.parse(vitest())
    change(report)
    assert.equal(parseRunnerReport('vitest-json', JSON.stringify(report)).complete, false)
  }
  for (const statuses of [[], ['pending'], ['todo'], ['skipped']]) {
    const item = evidence('vitest-json', vitest(statuses))
    assert.equal(runnerViolations(requirement(), item).status, 'incomplete')
  }
  const hook = JSON.parse(vitest())
  Object.assign(hook, { success: false, numPassedTestSuites: 0, numFailedTestSuites: 1 })
  assert.notEqual(
    runnerViolations(requirement(), evidence('vitest-json', JSON.stringify(hook))).status,
    'passed',
  )
})

function cucumber(statuses = ['PASSED'], protocol = '31.2.0') {
  const timestamp = { seconds: 1, nanos: 0 }
  return [
    { meta: { protocolVersion: protocol } },
    { testRunStarted: { timestamp } },
    {
      testCase: {
        id: 'case',
        pickleId: 'pickle',
        testSteps: statuses.map((_, index) => ({ id: `step${index}` })),
      },
    },
    { testCaseStarted: { id: 'attempt', testCaseId: 'case', attempt: 0, timestamp } },
    ...statuses.flatMap((status, index) => [
      { testStepStarted: { testCaseStartedId: 'attempt', testStepId: `step${index}`, timestamp } },
      {
        testStepFinished: {
          testCaseStartedId: 'attempt',
          testStepId: `step${index}`,
          testStepResult: { status, duration: { seconds: 0, nanos: 1 } },
          timestamp,
        },
      },
    ]),
    { testCaseFinished: { testCaseStartedId: 'attempt', willBeRetried: false, timestamp } },
    { testRunFinished: { success: !statuses.includes('FAILED'), timestamp } },
  ]
    .map((message) => JSON.stringify(message))
    .join('\n')
}

test('Cucumber adapter requires correlated starts, every step, case finishes, and run completion', () => {
  for (const protocol of ['31.2.0', '34.2.1']) {
    const result = parseRunnerReport('cucumber-messages', cucumber(['PASSED', 'PASSED'], protocol))
    assert.equal(result.complete, true)
    assert.equal(result.total, 1)
    assert.equal(result.passed, 1)
  }
  const messages = cucumber().split('\n')
  for (const remove of [0, 1, 2, 3, 4, 5, 6, 7])
    assert.equal(
      parseRunnerReport(
        'cucumber-messages',
        messages.filter((_, index) => index !== remove).join('\n'),
      ).complete,
      false,
      String(remove),
    )
  for (const input of [
    cucumber(['PASSED'], '999.0.0'),
    cucumber() + '\n' + messages[5],
    cucumber().replace('"willBeRetried":false', '"willBeRetried":true'),
    cucumber().replace('"step0","testStepResult"', '"unknown","testStepResult"'),
    cucumber() + '\n{"parseError":{"message":"bad source"}}',
  ])
    assert.equal(parseRunnerReport('cucumber-messages', input).complete, false)
})

test('Cucumber skipped steps and failed run hooks cannot produce configured success', () => {
  const req = requirement('cucumber-messages')
  assert.equal(
    runnerViolations(req, evidence(req.adapter, cucumber(['SKIPPED']))).status,
    'incomplete',
  )
  const hookFailure = cucumber().split('\n')
  hookFailure.splice(
    2,
    0,
    '{"testRunHookStarted":{"id":"hook"}}',
    '{"testRunHookFinished":{"testRunHookStartedId":"hook","result":{"status":"FAILED","duration":{"seconds":0,"nanos":1}}}}',
  )
  assert.equal(parseRunnerReport(req.adapter, hookFailure.join('\n')).complete, false)
})

function stryker(statuses = ['Killed', 'Timeout', 'Survived', 'NoCoverage']) {
  return JSON.stringify({
    schemaVersion: '2',
    thresholds: { high: 80, low: 60 },
    files: {
      'order.ts': {
        language: 'typescript',
        source: 'export const accepted = true',
        mutants: statuses.map((status, index) => ({
          id: String(index),
          mutatorName: 'BooleanLiteral',
          location: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
          status,
        })),
      },
    },
  })
}

test('Stryker computes the upstream valid-mutant denominator and reapplies the configured floor', () => {
  const facts = parseRunnerReport('stryker-json', stryker())
  assert.equal(facts.mutationScore, 50)
  assert.deepEqual(facts.mutation, {
    detected: 2,
    undetected: 2,
    invalid: 0,
    ignored: 0,
    pending: 0,
  })
  const req = requirement('stryker-json')
  const item = evidence(req.adapter, stryker())
  item.status = 'failed'
  assert.equal(runnerViolations(req, item).status, 'failed')
  assert.equal(
    runnerViolations({ ...req, minimumMutationScore: 50 }, { ...item, status: 'passed' }).status,
    'passed',
  )
  item.status = 'passed'
  assert.equal(
    runnerViolations(req, item).status,
    'incomplete',
    'a forged serialized pass cannot bypass the floor',
  )
  assert.equal(validRunnerEvidence({ ...item, mutationScore: 100 }), false)
})

test('Stryker schema versions use one-based report positions including the first column', () => {
  for (const version of ['1', '1.0', '2', '2.0.0']) {
    const report = JSON.parse(stryker(['Killed']))
    report.schemaVersion = version
    assert.equal(parseRunnerReport('stryker-json', JSON.stringify(report)).complete, true)
    report.files['order.ts'].mutants[0].location.start.column = 0
    assert.equal(parseRunnerReport('stryker-json', JSON.stringify(report)).complete, false)
  }
})

test('Stryker pending, invalid, ignored, zero-denominator and duplicate mutants remain blocking', () => {
  const req = requirement('stryker-json')
  for (const statuses of [
    [],
    ['Pending'],
    ['Ignored'],
    ['CompileError'],
    ['RuntimeError'],
    ['Killed', 'Pending'],
  ])
    assert.equal(
      runnerViolations(req, evidence(req.adapter, stryker(statuses))).status,
      'incomplete',
    )
  for (const change of [
    (r: any) => {
      r.schemaVersion = '999'
    },
    (r: any) => {
      r.files['order.ts'].mutants[1].id = '0'
    },
    (r: any) => {
      r.files['order.ts'].mutants[0].status = 'unknown'
    },
  ]) {
    const report = JSON.parse(stryker())
    change(report)
    assert.equal(parseRunnerReport(req.adapter, JSON.stringify(report)).complete, false)
  }
})

test('runner requirements and serialized facts reject malformed identities, counts, floors and paths', () => {
  assert.doesNotThrow(() => validateRunnerRequirements(undefined))
  assert.doesNotThrow(() => validateRunnerRequirements([]))
  for (const change of [
    { adapter: 'other' },
    { command: [] },
    { command: ['bun', undefined] },
    { report: '../results.json' },
    { report: '/tmp/results.json' },
    { report: 'a\\b.json' },
    { report: 'a/../b.json' },
    { minimumMutationScore: 70 },
    { coverage: { report: 'coverage.json', lines: 101 } },
  ])
    assert.throws(() => validateRunnerRequirements([{ ...requirement(), ...change }]))
  assert.throws(() => validateRunnerRequirements([requirement(), requirement()]))
  assert.throws(() =>
    validateRunnerRequirements([
      { ...requirement('stryker-json'), minimumMutationScore: undefined },
    ]),
  )
  assert.throws(() =>
    validateRunnerRequirements([
      { ...requirement(), coverage: { report: requirement().report, lines: 80 } },
    ]),
  )
  const good = evidence('vitest-json', vitest())
  assert.equal(validRunnerEvidence(good), true)
  for (const change of [
    { schema: 'unknown' },
    { total: 3 },
    { skipped: -1 },
    { elapsedMs: Infinity },
    { problems: null },
    { identity: {} },
    { reportHash: 'not-a-hash' },
  ])
    assert.equal(validRunnerEvidence({ ...good, ...change }), false)
  assert.equal(runnerViolations(requirement(), { ...good, status: 'failed' }).status, 'incomplete')
})

function project() {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-runner-'))
  mkdirSync(join(root, '.bonsai'))
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

test('runner commands must replace stale reports, exit normally, and provide candidate-bound facts', async () => {
  const fixture = project()
  try {
    const report = join(fixture.root, '.bonsai/results.json')
    writeFileSync(report, vitest())
    const req = { ...requirement(), command: [process.execPath, '-e', ''] }
    const stale = await runSupportingVerification(fixture.root, [req], 'candidate', 5000)
    assert.equal(stale[0]!.status, 'incomplete')
    assert.equal(existsSync(report), false)
    req.command = [
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(report)}, ${JSON.stringify(vitest())})`,
    ]
    const [fresh] = await runSupportingVerification(fixture.root, [req], 'candidate', 5000)
    assert.equal(fresh!.status, 'passed', JSON.stringify(fresh))
    assert.equal(fresh!.fingerprint, 'candidate')
    assert.match(fresh!.reportHash!, /^[a-f0-9]{64}$/)
    assert.deepEqual(runnerViolations(req, fresh), { status: 'passed', problems: [] })
    req.command.push('extra-argument')
    req.command[2] += '; process.exit(1)'
    const [nonzero] = await runSupportingVerification(fixture.root, [req], 'candidate', 5000)
    assert.equal(nonzero!.status, 'failed')
  } finally {
    fixture.dispose()
  }
})

test('runner reports must be valid UTF-8 rather than silently repaired text', async () => {
  const fixture = project()
  try {
    const payload = Buffer.from(vitest())
    payload[payload.indexOf('orders.test.ts')] = 0xff
    const req = {
      ...requirement(),
      command: [
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync('.bonsai/results.json', Buffer.from(${JSON.stringify([...payload])}))`,
      ],
    }
    const [result] = await runSupportingVerification(fixture.root, [req], 'candidate', 5000)
    assert.equal(result!.status, 'incomplete')
  } finally {
    fixture.dispose()
  }
})

test('runner failure output is bounded and escaped before becoming diagnostic facts', async () => {
  const fixture = project()
  try {
    const req = {
      ...requirement(),
      command: [
        process.execPath,
        '-e',
        "process.stdout.write('x'.repeat(20000)); process.stderr.write('\\u001b[31mcause'); process.exit(3)",
      ],
    }
    const [result] = await runSupportingVerification(fixture.root, [req], 'candidate', 5000)
    assert.equal(result!.status, 'incomplete')
    assert.equal(result!.exitCode, 3)
    const output = result!.problems.find((problem) => problem.startsWith('Runner output'))
    assert.ok(output)
    assert.ok(output.length < 25000)
    assert.doesNotMatch(output, /\u001b/)
  } finally {
    fixture.dispose()
  }
})

test('coverage floors use measured counts from a fresh Istanbul summary', async () => {
  const fixture = project()
  try {
    const req: RunnerRequirement = {
      ...requirement(),
      coverage: { report: '.bonsai/coverage.json', lines: 80, branches: 90 },
    }
    const counts = { total: 10, covered: 8, skipped: 0, pct: 100 }
    const coverage = {
      total: { lines: counts, branches: counts, statements: counts, functions: counts },
    }
    req.command = [
      process.execPath,
      '-e',
      `const fs = require('node:fs'); fs.writeFileSync('.bonsai/results.json', ${JSON.stringify(vitest())}); fs.writeFileSync('.bonsai/coverage.json', ${JSON.stringify(JSON.stringify(coverage))})`,
    ]
    const [result] = await runSupportingVerification(fixture.root, [req], 'candidate', 5000)
    assert.equal(result!.status, 'failed', JSON.stringify(result))
    assert.match(runnerViolations(req, result).problems.join('\n'), /Coverage branches is below 90/)
    assert.equal(
      runnerViolations(
        { ...req, coverage: { report: '.bonsai/coverage.json', lines: 80 } },
        { ...result, status: 'passed' },
      ).status,
      'passed',
    )
    const empty = structuredClone(result!)
    empty.coverage!.lines.total = empty.coverage!.lines.covered = 0
    assert.equal(runnerViolations(req, empty).status, 'incomplete')
  } finally {
    fixture.dispose()
  }
})

test('report symlinks, non-files and oversized outputs are rejected without following them', async () => {
  const fixture = project()
  try {
    writeFileSync(join(fixture.root, 'outside.json'), vitest())
    symlinkSync(join(fixture.root, 'outside.json'), join(fixture.root, '.bonsai/results.json'))
    const [linked] = await runSupportingVerification(
      fixture.root,
      [{ ...requirement(), command: [process.execPath, '-e', ''] }],
      'candidate',
      5000,
    )
    assert.equal(linked!.status, 'incomplete')
    assert.equal(readFileSync(join(fixture.root, 'outside.json'), 'utf8'), vitest())
    rmSync(join(fixture.root, '.bonsai/results.json'))
    mkdirSync(join(fixture.root, '.bonsai/results.json'))
    const [directory] = await runSupportingVerification(
      fixture.root,
      [{ ...requirement(), command: [process.execPath, '-e', ''] }],
      'candidate',
      5000,
    )
    assert.equal(directory!.status, 'incomplete')
    rmSync(join(fixture.root, '.bonsai/results.json'), { recursive: true })
    const req = {
      ...requirement(),
      command: [
        process.execPath,
        '-e',
        "require('node:fs').writeFileSync('.bonsai/results.json', 'x'.repeat(16 * 1024 * 1024 + 1))",
      ],
    }
    const [large] = await runSupportingVerification(fixture.root, [req], 'candidate', 5000)
    assert.equal(large!.status, 'incomplete')
    assert.match(large!.problems.join('\n'), /16 MiB/)
  } finally {
    fixture.dispose()
  }
})

test('one supporting deadline stops a hung runner and leaves later commands unstarted', async () => {
  const fixture = project()
  try {
    const first = {
      ...requirement(),
      command: [
        process.execPath,
        '-e',
        `require('node:fs').writeFileSync('.bonsai/results.json', ${JSON.stringify(vitest())}); setInterval(() => {}, 1000)`,
      ],
    }
    const second = {
      ...requirement(),
      id: 'later',
      report: '.bonsai/later.json',
      command: [process.execPath, '-e', "require('node:fs').writeFileSync('later', 'started')"],
    }
    const result = await runSupportingVerification(fixture.root, [first, second], 'candidate', 200)
    assert.deepEqual(
      result.map((item) => item.status),
      ['incomplete', 'incomplete'],
    )
    assert.match(result[0]!.problems.join('\n'), /deadline/)
    assert.equal(existsSync(join(fixture.root, 'later')), false)
    const abort = new AbortController()
    abort.abort()
    const cancelled = await runSupportingVerification(
      fixture.root,
      [second],
      'candidate',
      5000,
      abort.signal,
    )
    assert.equal(cancelled[0]!.status, 'incomplete')
    assert.equal(existsSync(join(fixture.root, 'later')), false)
  } finally {
    fixture.dispose()
  }
})

test('live runner cancellation stops its process-group descendants before completion', {
  skip: process.platform === 'win32' && 'Process-group cleanup requires Unix',
}, async () => {
  const fixture = project()
  const cancellation = new AbortController()
  const marker = join(fixture.root, 'descendant')
  const descendant = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`
  const command = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' }); setInterval(() => {}, 1000)`
  const pending = runSupportingVerification(
    fixture.root,
    [{ ...requirement(), command: [process.execPath, '-e', command] }],
    'candidate',
    10000,
    cancellation.signal,
  )
  const until = async (condition: () => boolean) => {
    const deadline = performance.now() + 3000
    while (!condition()) {
      assert.ok(performance.now() < deadline, 'Controlled descendant must start and stop')
      await new Promise((done) => setTimeout(done, 10))
    }
  }
  const stopped = (pid: number) => {
    try {
      process.kill(pid, 0)
      if (process.platform === 'linux') {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
        return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')
      }
      return false
    } catch (error) {
      if (['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) return true
      throw error
    }
  }
  try {
    await until(() => existsSync(marker))
    const pid = Number(readFileSync(marker, 'utf8'))
    assert.equal(stopped(pid), false)
    cancellation.abort()
    const [result] = await pending
    assert.equal(result!.status, 'incomplete')
    await until(() => stopped(pid))
  } finally {
    cancellation.abort()
    await pending
    fixture.dispose()
  }
})
