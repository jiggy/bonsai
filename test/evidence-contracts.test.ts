import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkVerification, startedAfterInterruption } from '../features/support/verification.ts'

test('interruption observer distinguishes held calls from later starts regardless of input IDs', () => {
  const held = [
    { kind: 'start', id: 7, pid: 100 },
    { kind: 'start', id: 4, pid: 101 },
  ] as const
  assert.deepEqual(startedAfterInterruption(held, held.length), [])
  const later = [
    ...held,
    { kind: 'finish', id: 7, pid: 100 },
    { kind: 'start', id: 0, pid: 102 },
    { kind: 'start', id: 4, pid: 103 },
  ] as const
  assert.deepEqual(startedAfterInterruption(later, held.length), [0, 4])
})

// CPU-sized pool fill, worker bounds, fresh profiles, exact check IDs/order, and
// malformed shard reports belong to evidence-parallel.test.ts. These regressions
// preserve the CLI report details separately from the stakeholder examples.
test('crashed and expired CLI verification report one infrastructure blocker', async () => {
  for (const kind of ['crash', 'timeout'] as const) {
    const report = await checkVerification({ case: kind })
    assert.equal(report.exitCode, 2)
    assert.equal(report.decision.status, 'incomplete')
    assert.equal(report.snapshot.source.problems.length, 1)
    assert.match(
      report.snapshot.source.problems[0],
      kind === 'crash' ? /worker exited|complete report/i : /feedback deadline expired/,
    )
    assert.equal(report.snapshot.evidence, undefined)
  }
})

test('maintained input changes invalidate complete passing CLI evidence', async () => {
  const report = await checkVerification({ case: 'source-change' })
  assert.equal(report.exitCode, 2)
  assert.equal(report.decision.status, 'incomplete')
  assert.equal(report.snapshot.evidence.complete, true)
  assert.equal(report.snapshot.evidence.checks[0].status, 'passed')
  assert.deepEqual(report.snapshot.source.problems, [
    'Maintained files changed during verification',
  ])
  assert.equal(report.maintainedText, '{"revision":2}\n')
})
