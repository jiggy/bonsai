import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProject } from './project.ts'
import { runCli } from './cli.ts'

test('real CLI explanation includes the contract route without loading application modules', () => {
  const project = createProject({
    'handler.ts': `import { middle } from './helper.ts'
throw new Error('explain must not load this application')
export function order() { return middle() }`,
    'helper.ts': `export function middle() { return subject() }
export function subject() { return { status: 'ok' } }`,
    'bindings.ts': `import { order } from './handler.ts'
export const actions = { order }`,
    'orders.feature': `Feature: Orders
Scenario: Place an order
 When I invoke "order" with {}
 Then response "status" equals "ok"
`,
  })
  try {
    const result = runCli(['explain', 'helper.ts#subject', '--root', project.root, '--json'])
    assert.equal(result.status, 0, result.stderr)
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
