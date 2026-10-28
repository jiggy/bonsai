import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  accountingProject,
  checkAccounting,
  compactionProject,
} from '../features/support/accounting.ts'
import { write } from '../features/support/project.ts'
import { runCli } from './cli.ts'
import { invalidContractProject } from './accounting-fixture.ts'

function check(root: string) {
  const result = runCli(['check', '--root', root, '--json'], { maxBuffer: 16 * 1024 * 1024 })
  assert.equal(result.error, undefined, String(result.error))
  assert.notEqual(result.status, null, result.stderr)
  return { exitCode: result.status, ...JSON.parse(result.stdout || result.stderr) }
}

test('duplicate and split feature files preserve every real evidence record', () => {
  for (const layout of ['duplicate', 'split'] as const) {
    const report = checkAccounting({ case: 'duplicate-contracts', layout })
    assert.equal(report.exitCode, 0)
    assert.equal(report.snapshot.evidence.checks.length, 4)
    assert.equal(
      new Set(report.snapshot.evidence.checks.map((entry: { id: string }) => entry.id)).size,
      4,
    )
    assert.ok(
      report.snapshot.evidence.checks.every(
        (entry: { status: string }) => entry.status === 'passed',
      ),
    )
  }
})

test('normalized collection selectors preserve all three distinct evidence records', () => {
  const report = checkAccounting({ case: 'selectors' })
  assert.equal(report.exitCode, 0)
  assert.equal(report.snapshot.evidence.checks.length, 3)
  assert.ok(
    report.snapshot.evidence.checks.every((entry: { status: string }) => entry.status === 'passed'),
  )
})

test('Background checks repeat in source order before each isolated scenario', () => {
  const fixture = accountingProject({ case: 'background' })
  try {
    const report = check(fixture.root)
    assert.equal(report.exitCode, 0)
    assert.equal(report.decision.status, 'pass')
    assert.equal(report.decision.surface, 1)
    assert.equal(report.snapshot.evidence.checks.length, 4)
    const calls = readFileSync(join(fixture.root, 'calls.log'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { value: number; pid: number })
    assert.equal(calls.length, 4)
    assert.deepEqual(
      calls.map((call) => call.value).sort((a, b) => a - b),
      [0, 1, 1, 2],
    )
    const sequences = new Map<number, number[]>()
    for (const call of calls) {
      const sequence = sequences.get(call.pid) ?? []
      sequence.push(call.value)
      sequences.set(call.pid, sequence)
    }
    assert.deepEqual(
      [...sequences.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      [
        [1, 0],
        [1, 2],
      ],
    )
  } finally {
    fixture.dispose()
  }
})

test('each invalid grammar file retains its exact diagnostic without executable cases or handler calls', () => {
  const fixture = invalidContractProject()
  try {
    const report = check(fixture.root)
    assert.equal(report.exitCode, 2)
    assert.equal(report.decision.status, 'incomplete')
    assert.equal(report.snapshot.contracts.cases.length, 0)
    assert.equal(
      report.snapshot.timing.stages.find((stage: { name: string }) => stage.name === 'verification')
        .status,
      'skipped',
    )
    assert.equal(existsSync(join(fixture.root, 'handler-ran')), false)
    assert.deepEqual(report.snapshot.contracts.problems, [
      'Error: datatable.feature:3: DataTables and DocStrings are not supported yet',
      'Error: docstring.feature:3: DataTables and DocStrings are not supported yet',
      "SyntaxError: JSON Parse error: Expected '}'",
      'Error: selector.feature:4: unsupported response selector',
      'Error: skipped.feature: skip tags are not accepted',
      'Error: unobserved.feature: scenario must invoke an action and observe its result',
      'Error: unsupported.feature:4: unsupported or unbound step: maybe response "status" equals "accepted"',
      'No executable contract cases found',
    ])
  } finally {
    fixture.dispose()
  }
})

test('compaction preserves exact wrapper charges, shared-file inventory, ancestry, and evidence', () => {
  const fixture = compactionProject()
  try {
    const previous = check(fixture.root)
    assert.equal(previous.exitCode, 1)
    assert.equal(previous.decision.status, 'reject')
    assert.deepEqual(previous.snapshot.unrooted, ['handlers.ts#abandoned'])
    assert.equal(previous.decision.requiredReduction, 19)
    assert.equal(
      previous.snapshot.source.components.find(
        (component: { id: string }) => component.id === 'handlers.ts#wrapper',
      ).tokens,
      10,
    )
    assert.equal(previous.snapshot.ancestry['handlers.ts#wrapper'].length, 2)
    assert.equal(
      previous.snapshot.source.files.filter((file: { file: string }) => file.file === 'shared.ts')
        .length,
      1,
    )
    write(fixture.root, 'handlers.ts', fixture.compact)
    const report = check(fixture.root)
    assert.equal(report.exitCode, 0)
    assert.equal(report.decision.status, 'pass')
    assert.equal(report.decision.requiredReduction, 0)
    assert.equal(report.snapshot.evidence.checks.length, 2)
    assert.equal(previous.decision.retained - report.decision.retained, 19)
    assert.equal(report.decision.ceiling - previous.decision.ceiling, 0)
  } finally {
    fixture.dispose()
  }
})
