import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProject } from './project.ts'
import { runCli } from './cli.ts'
import {
  checkBasicProject,
  explainComponent,
  observedRequirements,
} from '../features/support/basic.ts'

test('real CLI explanation includes the contract route without loading application modules', () => {
  const project = createProject({
    'handler.ts': `import { middle } from './helper.ts'
throw new Error('explain must not load this application')
export function order() { return middle() }`,
    'helper.ts': `export function middle() { return subject() }
export function subject() { return { status: 'ok' } }`,
    'bindings.ts': `import { order } from './handler.ts'
export const actions = { order: order }`,
    'orders.feature': `Feature: Orders
Scenario: Place an order
 When I invoke "order" with {}
 Then response "status" equals "ok"
`,
  })
  try {
    const result = runCli(['explain', 'helper.ts#subject', '--root', project.root, '--json'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(result.stderr, '')
    const component = JSON.parse(result.stdout).components[0]
    assert.equal(component.checks.length, 1)
    assert.deepEqual(component.contractPaths, [
      {
        check: component.checks[0].id,
        components: ['handler.ts#order', 'helper.ts#middle', 'helper.ts#subject'],
      },
    ])
    assert.deepEqual(component.verificationSubjects, [])
  } finally {
    project.dispose()
  }
})

test('inspection markers observe real execution before an ancestry rejection', () => {
  const report = checkBasicProject({ observeApplicationLoad: true, unrooted: true })
  // The real startup marker is retained; a separate dormant export rejects ancestry.
  assert.equal(report.exitCode, 1, JSON.stringify(report))
  assert.equal(report.decision.status, 'reject')
  assert.equal(report.snapshot.analysis.status, 'complete')
  assert.deepEqual(report.snapshot.source.problems, [])
  assert.equal(report.snapshot.unrooted.length, 1)
  assert.equal(report.snapshot.unrooted[0], 'orders.ts#unused')
  assert.deepEqual(report.decision.violations, [
    `No contract ancestry: ${report.snapshot.unrooted[0]}`,
  ])
  assert.equal(report.snapshot.evidence.complete, true)
  assert.deepEqual(
    report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
    ['passed', 'passed'],
  )
  assert.equal(report.applicationLoaded, true)
  assert.equal(report.handlerExecuted, true)
  assert.equal(report.invocationCount, 2)
})

test('inspection requirements preserve content and duplicates independently of returned check order', () => {
  const report = explainComponent({})
  assert.equal(report.exitCode, 0, JSON.stringify(report))
  assert.equal(report.components[0].checks.length, 2)
  assert.deepEqual(
    observedRequirements([...report.components[0].checks].reverse()),
    report.requirements,
  )

  const accepted = { action: 'place-order', selector: 'status', expected: 'accepted' }
  const rejected = { action: 'place-order', selector: 'status', expected: 'rejected' }
  const checks = [
    { ...accepted, id: 'positive' },
    { ...rejected, id: 'zero' },
  ]
  assert.deepEqual(observedRequirements(checks), [accepted, rejected])
  assert.deepEqual(observedRequirements([...checks].reverse()), [accepted, rejected])
  assert.deepEqual(observedRequirements([...checks, checks[0]]), [accepted, accepted, rejected])
  assert.deepEqual(observedRequirements([{ ...checks[0], expected: 'incorrect' }, checks[1]]), [
    { ...accepted, expected: 'incorrect' },
    rejected,
  ])
})
