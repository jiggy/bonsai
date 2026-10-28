import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileContracts } from '../src/contracts.ts'
import type { Config, Snapshot, Verification } from '../src/model.ts'
import { evaluate, validateVerification, validEvidence } from '../src/policy.ts'
import { readConfig } from '../src/project.ts'
import { buildSnapshot } from '../src/retention.ts'

const config: Config = {
  maintained: ['bindings.ts'],
  bindings: 'bindings.ts',
  policy: {
    bootstrap: 1000,
    bootstrapSurface: 1,
    perDoubling: 0,
    hardLimit: 1000,
    maxFeedbackMs: 15000,
  },
}

function candidate(): Snapshot {
  const contracts = compileContracts([
    {
      file: 'handle.feature',
      text: 'Feature: Handle\nScenario: Observe\n When I invoke "handle" with {}\n Then response "status" equals "ok"\n',
    },
  ])
  const result = buildSnapshot('candidate', contracts, {
    files: [{ file: 'handler.ts', tokens: 1 }],
    components: [
      {
        id: 'handler.ts#handle',
        name: 'handle',
        file: 'handler.ts',
        line: 1,
        tokens: 1,
        kind: 'production',
      },
    ],
    relationships: [],
    actions: { handle: 'handler.ts#handle' },
    problems: [],
  })
  result.evidence = {
    schema: 'bonsai-evidence-v1',
    fingerprint: result.fingerprint,
    profile: 'isolated-scenarios-v1',
    complete: true,
    elapsedMs: 1,
    checks: contracts.checks.map(({ id }) => ({ id, status: 'passed' })),
  }
  return result
}

test('verification execution is selected at invocation rather than in project settings', () => {
  const parse = (value: unknown) => readConfig('/unused', undefined, JSON.stringify(value))
  assert.deepEqual(parse(config), config)
  assert.equal(Object.hasOwn(parse(config), 'verification'), false)
  for (const verification of [
    null,
    [],
    true,
    'isolated-scenarios-v1',
    {},
    { profile: 'in-process-v1', workers: 2 },
    { profile: 'isolated-scenarios-v1' },
    ...[0, 1, 4, 9].map((workers) => ({ profile: 'isolated-scenarios-v1', workers })),
    { profile: 'isolated-scenarios-v1', workers: 2, isolated: false },
  ])
    assert.throws(() => parse({ ...config, verification }), /Remove verification.*--serial/)
  for (const workers of [1, 2, 8, 64])
    assert.doesNotThrow(() => validateVerification({ profile: 'isolated-scenarios-v1', workers }))
  assert.doesNotThrow(() => validateVerification({ profile: 'in-process-v1', workers: 1 }))
  for (const verification of [
    { profile: 'in-process-v1', workers: 2 },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2'].map((workers) => ({
      profile: 'isolated-scenarios-v1',
      workers,
    })),
  ])
    assert.throws(() => validateVerification(verification as Verification), /Invalid verification/)
})

test('required evidence must match the invocation verification execution profile', () => {
  const result = candidate()
  const status = () => evaluate(undefined, result, config.policy).status
  assert.equal(status(), 'pass')
  result.evidence!.profile = 'in-process-v1'
  assert.equal(status(), 'incomplete', 'Default concurrent checks cannot accept serial evidence')
  result.verification = { profile: 'in-process-v1', workers: 1 }
  assert.equal(status(), 'pass')
  result.evidence!.profile = 'isolated-scenarios-v1'
  assert.equal(status(), 'incomplete', 'Serial checks cannot accept isolated evidence')
  result.verification = { profile: 'isolated-scenarios-v1', workers: 2 }
  assert.equal(status(), 'pass')
  result.verification.workers = 0
  assert.equal(status(), 'incomplete')
  result.verification = { profile: 'unknown', workers: 2 } as unknown as Verification
  result.evidence!.profile = 'unknown' as never
  assert.equal(
    status(),
    'incomplete',
    'Matching unknown profile strings cannot authorize acceptance',
  )
})

test('serialized evidence requires its supported schema and well-typed facts', () => {
  for (const change of [
    (e: any) => {
      delete e.schema
    },
    (e: any) => {
      e.schema = 'bonsai-evidence-v999'
    },
    (e: any) => {
      e.complete = 'true'
    },
    (e: any) => {
      e.checks = null
    },
    (e: any) => {
      e.checks = [null]
    },
    (e: any) => {
      e.checks = new Array(1)
    },
    (e: any) => {
      e.checks[0].status = 'skipped'
    },
    (e: any) => {
      e.checks[0].error = {}
    },
    (e: any) => {
      e.bindingImport = []
    },
  ]) {
    const result = candidate()
    change(result.evidence)
    assert.equal(evaluate(undefined, result, config.policy).status, 'incomplete')
  }
})

test('evidence shape validation rejects malformed records without reading unsafe contents', () => {
  const good = candidate().evidence!
  assert.equal(validEvidence(good), true)
  assert.equal(
    validEvidence({ ...good, checks: [{ ...good.checks[0], response: 'returned value' }] }),
    true,
  )
  assert.equal(validEvidence({ ...good, checks: [{ ...good.checks[0], response: {} }] }), false)
  for (const value of [
    null,
    [],
    true,
    'evidence',
    {},
    ...[NaN, Infinity, -1, '1'].map((elapsedMs) => ({ ...good, elapsedMs })),
    ...[
      null,
      [],
      {},
      { id: 1, status: 'passed' },
      { id: '', status: 'passed' },
      { id: 'check', status: 'skipped' },
      { id: 'check', status: 'passed', error: 3 },
    ].map((check) => ({ ...good, checks: [check] })),
    ...[
      null,
      [],
      {},
      { adapter: 'project-bindings-v1', file: '', fingerprint: 'x' },
      { adapter: 'unknown', file: 'bindings.ts', fingerprint: 'x' },
    ].map((bindingImport) => ({ ...good, bindingImport })),
  ])
    assert.equal(validEvidence(value), false)
})
