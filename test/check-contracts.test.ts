import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableParallelism } from 'node:os'
import { checkBasicProject, verifyIsolatedScenarios } from '../features/support/basic.ts'

type Timing = { elapsedMs: number; stages: Stage[] }
type Stage = { name: string; status: string; stages?: Stage[] }

function stage(timing: Timing, name: string) {
  const found = timing.stages.find((entry) => entry.name === name)
  assert.ok(found, `Missing report stage: ${name}`)
  return found
}

test('three outline requests retain their complete evidence and actual invocation count', () => {
  const report = checkBasicProject({ examples: 3 })
  assert.equal(report.exitCode, 0)
  assert.equal(report.decision.status, 'pass')
  assert.equal(report.decision.surface, 1)
  assert.equal(report.invocationCount, 3)
  assert.deepEqual(
    report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
    ['passed', 'passed', 'passed'],
  )
})

test('check JSON retains native analysis, complete evidence, and measured phase metadata', () => {
  const report = checkBasicProject({ examples: 2 })
  assert.equal(report.exitCode, 0)
  assert.equal(report.decision.status, 'pass')
  assert.equal(report.handlerExecuted, true)
  assert.equal(report.invocationCount, 2)
  assert.equal(report.snapshot.analysis.engine, 'rust')
  assert.equal(report.snapshot.analysis.backend, 'tsrs')
  assert.equal(report.snapshot.analysis.validation, 'native-diagnostics')
  assert.equal(report.snapshot.analysis.status, 'complete')
  assert.equal(report.snapshot.evidence.complete, true)
  assert.deepEqual(
    report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
    ['passed', 'passed'],
  )
  for (const elapsed of [report.timing.elapsedMs, report.snapshot.timing.elapsedMs]) {
    assert.ok(Number.isFinite(elapsed))
    assert.ok(elapsed > 0)
  }
  assert.equal(report.timing.feedback.limitMs, 15000)
  assert.equal(stage(report.snapshot.timing, 'verification').status, 'completed')
  const source = stage(report.snapshot.timing, 'source')
  assert.deepEqual(
    source.stages?.map((entry) => entry.name),
    ['measurement', 'program', 'diagnostics', 'graph', 'native'],
  )
  assert.ok(source.stages?.every((entry) => entry.status === 'completed'))
})

test('unsupported runtime tracing retains one source problem and skipped verification timing', () => {
  const report = checkBasicProject({ computedImport: true })
  assert.equal(report.exitCode, 2)
  assert.equal(report.decision.status, 'incomplete')
  assert.equal(report.snapshot.source.problems.length, 1)
  assert.ok(Number.isFinite(report.timing.elapsedMs) && report.timing.elapsedMs > 0)
  assert.ok(
    Number.isFinite(report.snapshot.timing.elapsedMs) && report.snapshot.timing.elapsedMs > 0,
  )
  assert.equal(stage(report.snapshot.timing, 'verification').status, 'skipped')
  assert.equal(report.handlerExecuted, false)
})

test('check evidence distinguishes an application mismatch from a retained-budget rejection', () => {
  for (const input of [{ broken: true }, { overBudget: true }]) {
    const report = checkBasicProject(input)
    assert.equal(report.exitCode, 1)
    assert.equal(report.decision.status, 'reject')
    assert.equal(report.snapshot.evidence.complete, true)
    assert.deepEqual(
      report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
      'broken' in input ? ['passed', 'failed'] : ['passed', 'passed'],
    )
    if ('overBudget' in input) assert.equal(report.decision.ceiling, 1)
    assert.equal(report.invocationCount, 2)
  }
})

test('subprocess report facts preserve measured inventory and supported executable ancestry', () => {
  for (const subprocess of ['live', 'unused', 'uncontracted', 'missing'] as const) {
    const report = checkBasicProject({ subprocess })
    assert.equal(report.exitCode, subprocess === 'missing' ? 2 : subprocess === 'live' ? 0 : 1)
    assert.equal(
      report.snapshot.source.files.some(
        (file: { file: string }) => file.file === 'order-worker.ts',
      ),
      subprocess !== 'missing',
    )
    assert.equal(
      !!report.snapshot.ancestry['order-worker.ts#evaluateOrder']?.length,
      subprocess === 'live' || subprocess === 'unused',
    )
    assert.equal(report.childExecuted, subprocess === 'live' || subprocess === 'unused')
    assert.equal(report.handlerExecuted, subprocess !== 'missing')
    if (subprocess === 'live' || subprocess === 'unused') assert.equal(report.invocationCount, 2)
    if (subprocess === 'live') assert.equal(report.snapshot.evidence.complete, true)
    if (subprocess === 'unused')
      assert.deepEqual(report.snapshot.unrooted, ['order-worker.ts#unused'])
    if (subprocess === 'missing') {
      assert.equal(report.handlerExecuted, false)
      assert.equal(stage(report.snapshot.timing, 'verification').status, 'skipped')
    }
  }
})

test('a comment-only contract reports no executable cases without running its application', () => {
  const report = checkBasicProject({ missingContracts: true })
  assert.equal(report.exitCode, 2)
  assert.equal(report.decision.status, 'incomplete')
  assert.deepEqual(report.snapshot.contracts.cases, [])
  assert.equal(report.snapshot.evidence, undefined)
  assert.equal(report.handlerExecuted, false)
})

test('counter scenarios retain both execution profiles and all four observation records', () => {
  for (const serial of [false, true]) {
    const report = verifyIsolatedScenarios({ serial })
    const profile = serial ? 'in-process-v1' : 'isolated-scenarios-v1'
    assert.equal(report.exitCode, 0)
    assert.equal(report.snapshot.verification.profile, profile)
    assert.equal(
      report.snapshot.verification.workers,
      serial ? 1 : Math.min(availableParallelism(), 2),
    )
    assert.equal(report.snapshot.evidence.profile, profile)
    assert.equal(report.snapshot.evidence.complete, true)
    assert.deepEqual(
      report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
      ['passed', 'passed', 'passed', 'passed'],
    )
    assert.equal(report.invocationCount, 4)
  }
})
