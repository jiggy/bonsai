import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileContracts } from '../src/contracts.ts'
import { runEvidence } from '../src/evidence.ts'

test('Bonsai defines and fulfills its own executable feature contracts', {
  timeout: 60000,
}, async () => {
  const contracts = compileContracts(
    readdirSync('features')
      .filter((file) => file.endsWith('.feature'))
      .sort()
      .map((file) => ({
        file: `features/${file}`,
        text: readFileSync(`features/${file}`, 'utf8'),
      })),
  )
  assert.deepEqual(contracts.problems, [])
  assert.ok(contracts.cases.length >= 10)
  assert.ok(contracts.checks.length > contracts.pairs.length)
  const evidence = await runEvidence(
    resolve('.'),
    'bonsai.bindings.ts',
    contracts,
    'self-host-test',
    60000,
  )
  assert.equal(evidence.complete, true)
  assert.deepEqual(
    evidence.checks.map((check) => check.id).sort(),
    contracts.checks.map((check) => check.id).sort(),
    'Every declared observation must have exactly one execution result',
  )
  assert.deepEqual(
    evidence.checks.filter((check) => check.status !== 'passed'),
    [],
  )
})
