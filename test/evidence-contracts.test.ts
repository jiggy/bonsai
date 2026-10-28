import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkVerification } from '../features/support/verification.ts'

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
