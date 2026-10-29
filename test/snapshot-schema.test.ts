import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compileContracts } from '../src/contracts.ts'
import { buildSnapshot } from '../src/retention.ts'
import { parseSnapshot, SNAPSHOT_SCHEMA, validSnapshot } from '../src/snapshot-schema.ts'

// Assumed identities exercise schema parsing only; they are not execution attestations.
const identity = {
  schema: 'bonsai-execution-v1' as const,
  checker: { name: 'fixture-checker', version: '1', digest: 'a'.repeat(64) },
  runtime: { name: 'bun' as const, version: 'fixture-runtime', options: 'b'.repeat(64) },
  compiler: { name: 'tsrs' as const, version: 'fixture-compiler', digest: 'c'.repeat(64) },
}

function fixture() {
  const contracts = compileContracts([
    {
      file: 'behavior.feature',
      text: 'Feature: Handle\nScenario: Observe\n When I invoke "handle" with {}\n Then response "status" equals "ok"\n',
    },
  ])
  return {
    ...buildSnapshot('fixture-content', contracts, {
      files: [{ file: 'handler.ts', tokens: 4 }],
      components: [
        {
          id: 'handler.ts#handle',
          name: 'handle',
          file: 'handler.ts',
          line: 1,
          kind: 'production',
          tokens: 4,
        },
      ],
      actions: { handle: 'handler.ts#handle' },
      relationships: [],
      problems: [],
    }),
    schema: SNAPSHOT_SCHEMA,
    identity: structuredClone(identity),
    verification: { profile: 'isolated-scenarios-v1' as const, workers: 1 },
    evidence: {
      schema: 'bonsai-evidence-v2' as const,
      identity: structuredClone(identity),
      fingerprint: 'fixture-content',
      profile: 'isolated-scenarios-v1' as const,
      complete: true,
      elapsedMs: 1,
      checks: contracts.checks.map(({ id }) => ({ id, status: 'passed' as const })),
    },
    analysis: {
      engine: 'rust' as const,
      backend: 'tsrs' as const,
      validation: 'native-diagnostics' as const,
      status: 'complete' as const,
      version: 'fixture-compiler',
    },
    timing: {
      elapsedMs: 2,
      stages: [{ name: 'source', elapsedMs: 1, status: 'completed' as const }],
      feedback: { elapsedMs: 2, limitMs: 100 },
    },
  }
}

test('versioned snapshots preserve complete facts and support read-only structural snapshots', () => {
  const value = fixture()
  assert.equal(validSnapshot(value), true)
  assert.deepEqual(parseSnapshot(JSON.stringify(value)), JSON.parse(JSON.stringify(value)))
  const structural: any = fixture()
  delete structural.identity
  delete structural.evidence
  delete structural.verification
  assert.equal(validSnapshot(structural), true)
})

test('serialized snapshots reject unsupported versions and malformed nested facts', () => {
  for (const mutate of [
    (value: any) => {
      delete value.schema
    },
    (value: any) => {
      value.schema = 'bonsai-snapshot-v999'
    },
    (value: any) => {
      value.fingerprint = 1
    },
    (value: any) => {
      value.contracts.checks[0].line = 0
    },
    (value: any) => {
      value.contracts.cases[0].steps[0].action = null
    },
    (value: any) => {
      delete value.contracts.cases[0].steps[0].input
    },
    (value: any) => {
      value.source.files[0].tokens = -1
    },
    (value: any) => {
      value.source.components[0].kind = 'unknown'
    },
    (value: any) => {
      value.source.components[0].kind = ['production']
    },
    (value: any) => {
      value.timing.stages[0].status = ['completed']
    },
    (value: any) => {
      value.source.relationships = [{ from: 'handler.ts#handle' }]
    },
    (value: any) => {
      value.source.actions.handle = []
    },
    (value: any) => {
      value.ancestry['handler.ts#handle'] = [1]
    },
    (value: any) => {
      value.unrooted = [null]
    },
    (value: any) => {
      value.verification.workers = 0
    },
    (value: any) => {
      value.identity.runtime.options = 'not a digest'
    },
    (value: any) => {
      value.evidence.complete = 'true'
    },
    (value: any) => {
      delete value.evidence.identity
    },
    (value: any) => {
      value.timing.stages[0].elapsedMs = null
    },
    (value: any) => {
      value.timing.feedback.limitMs = 0
    },
    (value: any) => {
      value.analysis.validation = 'assumed'
    },
  ]) {
    const value = fixture()
    mutate(value)
    assert.equal(validSnapshot(value), false, String(mutate))
    assert.throws(() => parseSnapshot(JSON.stringify(value)), /snapshot schema/)
  }
  for (const value of [null, [], {}, true]) assert.equal(validSnapshot(value), false)
  assert.throws(() => parseSnapshot('{'), SyntaxError)
})

test('snapshot validation rejects sparse facts and bounded recursive timing corruption', () => {
  const value: any = fixture()
  value.source.components = new Array(1)
  assert.equal(validSnapshot(value), false)
  const recursive: any = fixture()
  const stage = { name: 'cycle', elapsedMs: 1, status: 'completed', stages: [] as unknown[] }
  stage.stages.push(stage)
  recursive.timing.stages = [stage]
  assert.equal(validSnapshot(recursive), false)
  const flat: any = fixture()
  flat.timing.stages = Array.from({ length: 100 }, (_, index) => ({
    name: `phase-${index}`,
    elapsedMs: 1,
    status: 'completed',
  }))
  assert.equal(
    validSnapshot(flat),
    true,
    'Recursion depth does not impose a limit on independent phases',
  )
})

test('snapshot shape validation does not replace policy evaluation of freshness and completion', () => {
  const value = fixture()
  value.evidence.fingerprint = 'another-candidate'
  value.evidence.complete = false
  assert.equal(validSnapshot(value), true)
})

test('snapshot schemas preserve optional runner facts while rejecting malformed requirements or evidence', () => {
  const value: any = fixture()
  value.runners = [
    {
      id: 'unit',
      adapter: 'vitest-json',
      command: ['bun', 'vitest.js'],
      report: '.bonsai/unit.json',
    },
  ]
  value.runnerEvidence = [
    {
      schema: 'bonsai-runner-evidence-v1',
      id: 'unit',
      adapter: 'vitest-json',
      fingerprint: value.fingerprint,
      status: 'incomplete',
      elapsedMs: 0,
      exitCode: null,
      complete: false,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      problems: ['Runner did not finish'],
    },
  ]
  assert.equal(validSnapshot(value), true)
  const malformed = structuredClone(value)
  malformed.runners[0].report = '../outside.json'
  assert.equal(validSnapshot(malformed), false)
  const sparse = structuredClone(value)
  sparse.runnerEvidence = new Array(1)
  assert.equal(validSnapshot(sparse), false)
  value.runnerEvidence[0].passed = -1
  assert.equal(validSnapshot(value), false)
})
