import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { compileContracts } from '../src/contracts.ts'
import { commands } from '../src/cli-interface.ts'
import { actions } from '../bonsai.bindings.ts'
import { createProject } from './project.ts'
import { loadSpecifications, selectSpecifications } from './specs.ts'

const feature = `Feature: Focused specification feedback
Scenario Outline: Keep each authored example
 When I invoke "sample" with {"id":<id>}
 Then response "id" equals <id>
 Examples:
 | id |
 | 1 |
 | 2 |
Scenario: Another promise
 When I invoke "other" with {}
 Then response "status" equals "ready"
`

test('specification bindings preserve public command identities rather than fixture aliases', () => {
  assert.deepEqual(
    Object.keys(actions).sort(),
    Object.keys(commands)
      .map((command) => (command === 'config' ? 'config-show' : command))
      .sort(),
  )
})

test('focused selection preserves authored observation IDs and the full product surface', () => {
  const contracts = compileContracts([{ file: 'focus.feature', text: feature }])
  assert.deepEqual(contracts.problems, [])
  const selected = selectSpecifications(contracts, 'focus.feature:1')
  assert.equal(selected.cases.length, 1)
  assert.deepEqual(selected.checks, [contracts.checks[1]])
  assert.deepEqual(
    selected.pairs,
    contracts.pairs,
    'Focused execution must not recalculate allowance',
  )
  assert.equal(selectSpecifications(contracts, 'Keep each authored example').cases.length, 2)
  assert.throws(() => selectSpecifications(contracts, ''), /must not be empty/)
  assert.throws(
    () => selectSpecifications(contracts, 'missing scenario'),
    /No authored scenarios match/,
  )
  assert.equal(contracts.cases.length, 3)
  assert.equal(contracts.checks.length, 3)
  const many = compileContracts([
    {
      file: 'focus.feature',
      text: feature.replace(
        ' | 2 |',
        Array.from({ length: 11 }, (_, index) => ` | ${index + 2} |`).join('\n'),
      ),
    },
  ])
  assert.equal(selectSpecifications(many, 'focus.feature:1').cases.length, 1)
})

test('listing authored examples never executes bindings and unknown selections fail explicitly', () => {
  const fixture = createProject({
    'bindings.ts': 'throw new Error("Listing must not execute application bindings")\n',
    'focus.feature': feature,
  })
  const executable = fileURLToPath(new URL('./specs.ts', import.meta.url))
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [executable, '--', '--root', fixture.root, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, BONSAI_NATIVE_BINARY: '/missing/list-must-not-start-native' },
    })
  try {
    const loaded = loadSpecifications(fixture.root)
    assert.equal(loaded.contracts.cases.length, 3)
    const listed = run('--list', '--scenario', 'Keep each authored example')
    assert.equal(listed.status, 0, listed.stderr)
    assert.equal(listed.stderr, '')
    assert.match(listed.stdout, /^focus\.feature:0\tKeep each authored example$/m)
    assert.match(listed.stdout, /^focus\.feature:1\tKeep each authored example$/m)
    assert.doesNotMatch(listed.stdout, /Another promise|budget verdict|pass/i)
    const missing = run('--list', '--scenario', 'missing scenario')
    assert.equal(missing.status, 2)
    assert.equal(missing.stdout, '')
    assert.match(missing.stderr, /No authored scenarios match/)
    const usage = run('--unknown-option')
    assert.equal(usage.status, 2)
    assert.equal(usage.stdout, '')
    assert.match(usage.stderr, /Unknown option/)
  } finally {
    fixture.dispose()
  }
})
