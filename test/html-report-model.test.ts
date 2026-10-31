import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Component, Config, Contracts, Source } from '../src/model.ts'
import { buildSnapshot } from '../src/retention.ts'
import { evaluate } from '../src/policy.ts'
import { buildReportData, type ReportContext, type ReportInput } from '../src/report/model.ts'
import { assumedIdentity } from './identity-fixture.ts'

function fixture() {
  const component = (
    id: string,
    file: string,
    kind: Component['kind'],
    tokens: number,
    name = id,
  ): Component => ({ id, file, kind, tokens, name, line: 1 })
  const source: Source = {
    files: [
      { file: 'src/orders.ts', tokens: 1000, kind: 'production', executable: true },
      { file: 'bindings.ts', tokens: 40, kind: 'binding', executable: true },
      { file: 'message.txt', tokens: 50 },
      { file: 'test/order.test.ts', tokens: 70, kind: 'test', executable: true },
      { file: 'features/orders.feature', tokens: 60 },
      { file: 'features/draft.feature', tokens: 1 },
      { file: 'README.md', tokens: 20 },
    ],
    components: [
      component('place', 'src/orders.ts', 'production', 5),
      component('cancel', 'src/orders.ts', 'production', 20),
      component('legacy', 'src/orders.ts', 'production', 900),
      component('startup', 'src/orders.ts', 'production', 0, '<module>'),
      component('registry', 'bindings.ts', 'binding', 20),
      component('resource', 'message.txt', 'production', 50, '<resource>'),
      component('test', 'test/order.test.ts', 'test', 60),
    ],
    actions: { place: 'place', cancel: 'cancel', unused: 'legacy' },
    registry: 'registry',
    relationships: [
      { from: 'place', to: 'resource', kind: 'reference', origin: 'static', sourceRef: { file: 'src/orders.ts', line: 2 } },
      { from: 'place', to: 'cancel', kind: 'reference', runtime: false, origin: 'static', sourceRef: { file: 'src/orders.ts', line: 3 } },
      { from: 'registry', to: 'startup', kind: 'module-initialization', origin: 'static', sourceRef: { file: 'bindings.ts', line: 1 } },
      { from: 'test', to: 'place', kind: 'reference', origin: 'static', sourceRef: { file: 'test/order.test.ts', line: 2 } },
    ],
    problems: [],
  }
  const contracts: Contracts = {
    pairs: ['place/status', 'cancel/status', '__proto__/status'],
    cases: [],
    problems: [],
    checks: ['place', 'cancel', '__proto__'].map((action, index) => ({
      id: `features/orders.feature:${index}:1`, file: 'features/orders.feature', line: index + 3,
      action, selector: 'status', expected: 'ok',
    })),
  }
  const snapshot = buildSnapshot('candidate-fingerprint', contracts, source)
  const config: Config = {
    maintained: ['src', 'src/orders.ts', 'bindings.ts', 'message.txt', 'test', 'features', 'README.md'],
    exclude: ['.bonsai/'],
    bindings: 'bindings.ts',
    policy: { bootstrap: 100, bootstrapSurface: 2, perDoubling: 10, hardLimit: 200, maxFeedbackMs: 1500 },
  }
  const context: ReportContext = {
    config, root: '/project', configFile: 'git:reviewed-base:bonsai.json',
    origin: { root: 'flag', base: 'environment', policy: 'base' },
    base: 'reviewed-base', project: 'orders', generatedAt: '2026-10-31T12:00:00.000Z',
  }
  const input: ReportInput = {
    snapshot, decision: evaluate(undefined, snapshot, config.policy),
    timing: { elapsedMs: 35, stages: [] },
  }
  return { input, context }
}

test('report keeps complete file costs and unknown classifications without inventory expansion', () => {
  const { input, context } = fixture()
  const data = buildReportData(input, context)
  assert.equal(data.files.length, input.snapshot.source.files.length)
  assert.equal(data.files.reduce((sum, file) => sum + file.tokens, 0), input.decision.retained)
  assert.deepEqual(data.files[0], { path: 'src/orders.ts', tokens: 1000, kind: 'production', executable: true, components: ['place', 'cancel', 'legacy', 'startup'] })
  const readme = data.files.find((file) => file.path === 'README.md')!
  assert.deepEqual(readme.components, [])
  assert.equal(Object.hasOwn(readme, 'kind'), false)
  assert.equal(Object.hasOwn(readme, 'executable'), false)
  assert.equal(data.components.find((component) => component.id === 'resource')!.tokens, 50)
  assert.equal(data.components.find((component) => component.id === 'startup')!.tokens, 0)
})

test('feature grouping retains empty indexed specifications and never expands exact ancestry', () => {
  const { input, context } = fixture()
  const data = buildReportData(input, context)
  assert.deepEqual(data.features.map(({ id, name, path }) => ({ id, name, path })), [
    { id: 'features/orders.feature', path: 'features/orders.feature', name: 'orders.feature' },
    { id: 'features/draft.feature', path: 'features/draft.feature', name: 'draft.feature' },
  ])
  assert.deepEqual(data.features[1]!.checks, [])
  assert.deepEqual(data.features[1]!.actions, [])
  assert.deepEqual(data.components.find((component) => component.id === 'place')!.features, ['features/orders.feature'])
  assert.deepEqual(data.ancestry.place, ['features/orders.feature:0:1'])
  assert.equal(data.features[0]!.checks.length, 3)
  assert.deepEqual(data.components.find((component) => component.id === 'legacy')!.features, [])
  assert.deepEqual(data.ancestry, input.snapshot.ancestry)
  assert.deepEqual(data.relationships, input.snapshot.source.relationships)
  assert.equal(data.relationships[1]!.runtime, false)
  assert.equal(data.relationships[2]!.kind, 'module-initialization')
})

test('bindings include unused registrations and mark absent own properties explicitly', () => {
  const { input, context } = fixture()
  const missing = buildReportData(input, context).bindings
  assert.deepEqual(missing, [
    { action: 'place', handler: 'place' }, { action: 'cancel', handler: 'cancel' },
    { action: '__proto__', handler: null }, { action: 'unused', handler: 'legacy' },
  ])
  Object.defineProperty(input.snapshot.source.actions, '__proto__', { value: 'cancel', enumerable: true })
  assert.deepEqual(buildReportData(input, context).bindings[2], { action: '__proto__', handler: 'cancel' })
})

test('missing evidence and feedback remain absent rather than fabricated successful or not-run results', () => {
  const { input, context } = fixture()
  const before = JSON.stringify({ input, context })
  const data = buildReportData(input, context)
  assert.equal(data.decision, input.decision)
  assert.equal(data.decision.status, 'incomplete')
  assert.equal(Object.hasOwn(data, 'evidence'), false)
  assert.equal(data.evidenceState, 'unavailable')
  assert.equal(data.feedbackMs, null)
  assert.equal(data.features.some((feature) => feature.checks.some((check) => Object.hasOwn(check, 'status'))), false)
  assert.equal(JSON.stringify(data).includes('not-run'), false)
  assert.equal(JSON.stringify({ input, context }), before)
})

test('raw evidence, supporting requirements, structural facts, and incomplete analysis survive projection', () => {
  const { input, context } = fixture()
  const { snapshot } = input
  snapshot.identity = assumedIdentity
  snapshot.evidence = {
    schema: 'bonsai-evidence-v2', identity: assumedIdentity, fingerprint: 'stale-candidate',
    profile: 'isolated-scenarios-v1', complete: false, elapsedMs: 12,
    checks: [{ id: snapshot.contracts.checks[0]!.id, status: 'failed', error: 'wrong status', response: '{"status":"error"}' }],
  }
  snapshot.runners = [{ id: 'tests', adapter: 'vitest-json', command: ['bun', 'test'], report: '.bonsai/tests.json', coverage: { report: '.bonsai/coverage.json', scope: 'maintained-production', lines: 80 } }]
  context.config.runners = snapshot.runners
  context.config.policy.structural = { metric: 'control-depth-v1', maxDepth: 3 }
  snapshot.source.controlDepth = { metric: 'control-depth-v1', complete: false, regions: [] }
  snapshot.runnerEvidence = [{ schema: 'bonsai-runner-evidence-v1', id: 'tests', adapter: 'vitest-json', fingerprint: snapshot.fingerprint, status: 'incomplete', complete: false, elapsedMs: 5, exitCode: null, total: 0, passed: 0, failed: 0, skipped: 0, problems: ['Report unavailable'] }]
  snapshot.analysis = { engine: 'rust', backend: 'tsrs', validation: 'native-diagnostics', status: 'unsupported', version: 'fixture' }
  snapshot.source.problems.push('Unsupported source')
  snapshot.contracts.problems.push('Draft scenario')
  input.decision = evaluate(undefined, snapshot, context.config.policy)
  const data = buildReportData(input, context)
  assert.equal(data.decision, input.decision)
  assert.equal(data.evidence, snapshot.evidence)
  assert.equal(data.identity, snapshot.identity)
  assert.equal(data.runners, snapshot.runners)
  assert.equal(data.runnerEvidence, snapshot.runnerEvidence)
  assert.equal(data.controlDepth, snapshot.source.controlDepth)
  assert.equal(data.analysis, snapshot.analysis)
  assert.deepEqual(data.problems, { contracts: ['Draft scenario'], source: ['Unsupported source'] })
  assert.equal(data.feedbackMs, 12)
  assert.equal(data.evidence!.fingerprint, 'stale-candidate')
  assert.equal(data.evidenceState, 'mismatched')
  assert.equal(data.decision.status, 'incomplete')
})

test('same-invocation configuration and timing retain policy provenance and a measured zero', () => {
  const { input, context } = fixture()
  input.snapshot.timing = { elapsedMs: 0, stages: [{ name: 'verification', elapsedMs: null, status: 'skipped' }], feedback: { elapsedMs: 0, limitMs: 1500 } }
  const data = buildReportData(input, context)
  assert.equal(data.feedbackMs, 0)
  assert.equal(data.timing, input.timing)
  assert.equal(data.candidateTiming, input.snapshot.timing)
  assert.deepEqual(data.config, { ...context.config, origin: context.configFile })
  assert.deepEqual(data.provenance, { root: '/project', configFile: context.configFile, base: 'reviewed-base', origin: context.origin })
  assert.equal(Object.hasOwn(data, 'commit'), false)
  assert.equal(Object.hasOwn(data, 'illustrative'), false)
})

test('maintained membership normalizes selected paths without losing overlap or empty entries', () => {
  const { input, context } = fixture()
  context.config.maintained = ['./src/', 'src/orders.ts', '/project/src', 'test/../features', 'empty', 'src-other']
  const data = buildReportData(input, context)
  assert.deepEqual(data.maintainedEntries, [
    { entry: './src/', files: ['src/orders.ts'] },
    { entry: 'src/orders.ts', files: ['src/orders.ts'] },
    { entry: '/project/src', files: ['src/orders.ts'] },
    { entry: 'test/../features', files: ['features/orders.feature', 'features/draft.feature'] },
    { entry: 'empty', files: [] },
    { entry: 'src-other', files: [] },
  ])
  assert.equal(data.files.length, input.snapshot.source.files.length)
})

test('evidence compatibility preserves partial current records and distinguishes stale contexts', () => {
  const { input, context } = fixture()
  const { snapshot } = input
  snapshot.identity = assumedIdentity
  snapshot.evidence = {
    schema: 'bonsai-evidence-v2', identity: assumedIdentity,
    fingerprint: snapshot.fingerprint, profile: 'isolated-scenarios-v1',
    complete: false, elapsedMs: 3, checks: [],
  }
  assert.equal(buildReportData(input, context).evidenceState, 'matched')
  assert.equal(buildReportData(input, context).evidence!.complete, false)
  snapshot.evidence.fingerprint = 'other-candidate'
  assert.equal(buildReportData(input, context).evidenceState, 'mismatched')
  snapshot.evidence.fingerprint = snapshot.fingerprint
  snapshot.evidence.identity = { ...assumedIdentity, runtime: { ...assumedIdentity.runtime, version: 'other-runtime' } }
  assert.equal(buildReportData(input, context).evidenceState, 'mismatched')
  snapshot.evidence.identity = assumedIdentity
  snapshot.verification = { profile: 'in-process-v1', workers: 1 }
  assert.equal(buildReportData(input, context).evidenceState, 'mismatched')
  snapshot.evidence.profile = 'in-process-v1'
  assert.equal(buildReportData(input, context).evidenceState, 'matched')
  Object.assign(snapshot.evidence, { schema: 'unknown-schema' })
  const data = buildReportData(input, context)
  assert.equal(data.evidenceState, 'mismatched')
  assert.equal(data.evidence, snapshot.evidence)
  assert.equal(data.decision, input.decision)
})

test('supporting compatibility exposes unavailable, partial current, stale, duplicate, and unexpected records', () => {
  const { input, context } = fixture()
  const { snapshot } = input
  snapshot.identity = assumedIdentity
  context.config.runners = [{ id: 'tests', adapter: 'vitest-json', command: ['bun', 'test'], report: '.bonsai/tests.json' }]
  assert.deepEqual(buildReportData(input, context).runnerEvidenceStates, [{ id: 'tests', state: 'unavailable' }])
  snapshot.runnerEvidence = [{ schema: 'bonsai-runner-evidence-v1', id: 'tests', adapter: 'vitest-json', fingerprint: snapshot.fingerprint, identity: assumedIdentity, status: 'incomplete', complete: false, elapsedMs: 5, exitCode: null, total: 0, passed: 0, failed: 0, skipped: 0, problems: ['Interrupted'] }]
  assert.deepEqual(buildReportData(input, context).runnerEvidenceStates, [{ id: 'tests', state: 'matched' }])
  snapshot.runnerEvidence[0]!.fingerprint = 'other-candidate'
  assert.deepEqual(buildReportData(input, context).runnerEvidenceStates, [{ id: 'tests', state: 'mismatched' }])
  snapshot.runnerEvidence[0]!.fingerprint = snapshot.fingerprint
  snapshot.runnerEvidence.push(snapshot.runnerEvidence[0]!)
  assert.deepEqual(buildReportData(input, context).runnerEvidenceStates, [{ id: 'tests', state: 'mismatched' }])
  snapshot.runnerEvidence = [{ ...snapshot.runnerEvidence[0]!, id: 'unexpected' }]
  const data = buildReportData(input, context)
  assert.deepEqual(data.runnerEvidenceStates, [{ id: 'tests', state: 'unavailable' }, { id: 'unexpected', state: 'mismatched' }])
  assert.equal(data.runnerEvidence, snapshot.runnerEvidence)
})
