import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectBehavior } from '../features/support/project-behavior.ts'
import { explainComponent, inspectConfiguration } from '../features/support/basic.ts'

test('inspection JSON retains project provenance, conventional bindings, and not-found codes', () => {
  const configuration = inspectConfiguration({})
  assert.equal(configuration.exitCode, 0)
  assert.equal(configuration.origin.policy, 'project')
  assert.equal(configuration.config.bindings, 'bindings.ts')
  assert.equal(configuration.handlerExecuted, false)

  const missing = explainComponent({ target: 'missing.ts' })
  assert.equal(missing.exitCode, 4)
  assert.equal(missing.code, 'NOT_FOUND')
  assert.equal(missing.handlerExecuted, false)
})

test('initialized ownership retains the exact inventory and nested configuration bytes', () => {
  const report = projectBehavior({ case: 'saved-scope' })
  assert.equal(report.exitCode, 0)
  assert.deepEqual(report.inventory, [
    '.gitignore',
    'bonsai.bindings.ts',
    'bonsai.json',
    'features/bonsai.feature',
    'package.json',
    'src/app.ts',
    'src/later.ts',
  ])
  assert.equal(report.nestedConfigurationText, '{}\n')
})

test('explicit and piped JSONC inspection preserve exact policy provenance', () => {
  const explicit = projectBehavior({ case: 'config-precedence' })
  assert.equal(explicit.exitCode, 0)
  assert.equal(explicit.origin.root, '--root')
  assert.equal(explicit.origin.policy, '--policy')
  assert.equal(explicit.config.policy.bootstrap, 777)
  assert.equal(explicit.configurationUnchanged, true)
  assert.equal(explicit.handlerExecuted, false)

  const piped = projectBehavior({ case: 'piped-policy' })
  assert.equal(piped.exitCode, 0)
  assert.equal(piped.file, 'stdin')
  assert.equal(piped.origin.policy, '--policy')
  assert.equal(piped.config.policy.bootstrap, 888)
  assert.equal(piped.configurationUnchanged, true)
  assert.equal(piped.handlerExecuted, false)
})

test('explanation JSON retains exact registry relationships and normalized stdin targets', () => {
  const positional = projectBehavior({ case: 'explain-readonly' })
  assert.equal(positional.exitCode, 0)
  assert.equal(positional.components[0].id, 'handler.ts#app')
  assert.equal(positional.components[0].checks.length, 1)
  assert.equal(positional.components[0].relationships[0].from, 'bindings.ts#actions')
  assert.equal(positional.components[0].relationships[0].to, 'handler.ts#app')
  assert.equal(positional.handlerExecuted, false)

  const piped = projectBehavior({ case: 'piped-target' })
  assert.equal(piped.exitCode, 0)
  assert.equal(piped.components.length, 1)
  assert.equal(piped.components[0].id, 'handler.ts#app')
  assert.equal(piped.components[0].checks.length, 1)
  assert.equal(piped.handlerExecuted, false)

  const conflicting = projectBehavior({ case: 'conflicting-pipes' })
  assert.equal(conflicting.exitCode, 2)
  assert.equal(conflicting.code, 'USAGE')
  assert.equal(conflicting.handlerExecuted, false)
})
