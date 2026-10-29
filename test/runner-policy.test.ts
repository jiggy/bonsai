import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileContracts } from '../src/contracts.ts'
import type { Config, Snapshot } from '../src/model.ts'
import { evaluate } from '../src/policy.ts'
import { readConfig, snapshot } from '../src/project.ts'
import { buildSnapshot } from '../src/retention.ts'
import type { RunnerEvidence, RunnerRequirement } from '../src/runners.ts'
import { assumedIdentity } from './identity-fixture.ts'
import { createProject } from './project.ts'

const policy = {
  bootstrap: 1000,
  bootstrapSurface: 1,
  perDoubling: 0,
  hardLimit: 1000,
  maxFeedbackMs: 15000,
}
const requirement: RunnerRequirement = {
  id: 'unit',
  adapter: 'vitest-json',
  command: ['bun', 'run', 'vitest'],
  report: '.bonsai/unit.json',
}

// Assumed report facts exercise policy independently of the process/adapter tests.
function candidate(): Snapshot {
  const contracts = compileContracts([
    {
      file: 'behavior.feature',
      text: 'Feature: Ready\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
    },
  ])
  const snapshot = buildSnapshot('candidate', contracts, {
    files: [],
    components: [],
    relationships: [],
    actions: { ready: 'handler.ts#ready' },
    problems: [],
  })
  snapshot.identity = assumedIdentity
  snapshot.evidence = {
    schema: 'bonsai-evidence-v2',
    identity: assumedIdentity,
    fingerprint: 'candidate',
    profile: 'isolated-scenarios-v1',
    complete: true,
    elapsedMs: 1,
    checks: contracts.checks.map(({ id }) => ({ id, status: 'passed' })),
  }
  snapshot.runners = [requirement]
  snapshot.runnerEvidence = [
    {
      schema: 'bonsai-runner-evidence-v1',
      identity: assumedIdentity,
      id: 'unit',
      adapter: 'vitest-json',
      fingerprint: 'candidate',
      complete: true,
      status: 'passed',
      elapsedMs: 1,
      exitCode: 0,
      reportHash: 'a'.repeat(64),
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      problems: [],
    },
  ]
  return structuredClone(snapshot)
}

test('required supporting evidence cannot be omitted, duplicated, stale, foreign or identity-mismatched', () => {
  assert.equal(evaluate(undefined, candidate(), policy).status, 'pass')
  for (const mutate of [
    (s: Snapshot) => {
      delete s.runnerEvidence
    },
    (s: Snapshot) => {
      s.runnerEvidence!.push(s.runnerEvidence![0]!)
    },
    (s: Snapshot) => {
      s.runnerEvidence![0]!.fingerprint = 'old-candidate'
    },
    (s: Snapshot) => {
      s.runnerEvidence![0]!.id = 'another-runner'
    },
    (s: Snapshot) => {
      delete s.runnerEvidence![0]!.identity
    },
    (s: Snapshot) => {
      s.runnerEvidence![0]!.identity = structuredClone(assumedIdentity)
      s.runnerEvidence![0]!.identity!.runtime.version = 'another-runtime'
    },
    (s: Snapshot) => {
      s.runnerEvidence![0]!.status = 'failed'
    },
  ]) {
    const snapshot = candidate()
    mutate(snapshot)
    assert.equal(evaluate(undefined, snapshot, policy).status, 'incomplete')
  }
})

test('supporting failure rejects while incomplete work blocks without increasing allowance', () => {
  const baseline = evaluate(undefined, candidate(), policy)
  for (const [facts, expected] of [
    [{ passed: 0, failed: 1, exitCode: 1, status: 'failed' }, 'reject'],
    [{ passed: 0, skipped: 1, status: 'incomplete' }, 'incomplete'],
  ] as const) {
    const snapshot = candidate()
    Object.assign(snapshot.runnerEvidence![0]!, facts)
    const decision = evaluate(undefined, snapshot, policy)
    assert.equal(decision.status, expected)
    assert.equal(decision.surface, baseline.surface)
    assert.equal(decision.ceiling, baseline.ceiling)
    assert.equal(decision.retained, baseline.retained)
  }
})

test('coverage and mutation floors are reapplied from measured facts', () => {
  const snapshot = candidate()
  snapshot.runners![0]!.coverage = { report: '.bonsai/coverage.json', lines: 80 }
  const evidence = snapshot.runnerEvidence![0]!
  evidence.coverageReportHash = 'b'.repeat(64)
  evidence.coverage = Object.fromEntries(
    ['lines', 'branches', 'functions', 'statements'].map((key) => [
      key,
      { total: 10, covered: 8, skipped: 0 },
    ]),
  ) as RunnerEvidence['coverage']
  assert.equal(evaluate(undefined, snapshot, policy).status, 'pass')
  snapshot.runners![0]!.coverage!.lines = 90
  evidence.status = 'failed'
  assert.equal(evaluate(undefined, snapshot, policy).status, 'reject')
  evidence.status = 'passed'
  assert.equal(
    evaluate(undefined, snapshot, policy).status,
    'incomplete',
    'A serialized pass cannot override the floor',
  )
  delete snapshot.runners![0]!.coverage
  Object.assign(snapshot.runners![0]!, { adapter: 'stryker-json', minimumMutationScore: 90 })
  Object.assign(evidence, {
    adapter: 'stryker-json',
    total: 10,
    passed: 8,
    failed: 2,
    status: 'failed',
    mutation: { detected: 8, undetected: 2, invalid: 0, ignored: 0, pending: 0 },
    mutationScore: 80,
  })
  assert.equal(evaluate(undefined, snapshot, policy).status, 'reject')
})

test('runner requirements survive effective configuration parsing and invalid settings are rejected', () => {
  const config: Config = {
    maintained: ['bindings.ts'],
    bindings: 'bindings.ts',
    policy,
    runners: [requirement],
  }
  assert.deepEqual(readConfig('/unused', undefined, JSON.stringify(config)), config)
  for (const runners of [
    null,
    {},
    [{ ...requirement, adapter: 'unknown' }],
    [{ ...requirement, report: '../old.json' }],
  ])
    assert.throws(() => readConfig('/unused', undefined, JSON.stringify({ ...config, runners })))
})

test('report and coverage destinations cannot delete maintained inputs before execution', async () => {
  const fixture = createProject({
    'app.ts': "export function ready() { return { status: 'ok' } }\n",
    'bindings.ts': "import { ready } from './app.ts'\nexport const actions = { ready: ready }\n",
    'ready.feature': 'Feature: Ready\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
  })
  try {
    const config = readConfig(fixture.root)
    const before = readFileSync(join(fixture.root, 'app.ts'))
    for (const runner of [
      { ...requirement, report: 'app.ts' },
      { ...requirement, coverage: { report: 'app.ts', lines: 80 } },
    ]) {
      config.runners = [runner]
      await assert.rejects(snapshot(fixture.root, config), /Runner report overlaps maintained input: app.ts/)
      assert.deepEqual(readFileSync(join(fixture.root, 'app.ts')), before)
    }
  } finally { fixture.dispose() }
})
