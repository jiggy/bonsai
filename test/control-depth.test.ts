import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {
  controlDepthSupported,
  measureControlDepth,
  validControlDepth,
  validateStructuralPolicy,
  type ControlDepthFacts,
} from '../src/control-depth.ts'
import { evaluate, validatePolicy } from '../src/policy.ts'
import { buildSnapshot } from '../src/retention.ts'
import { compileContracts } from '../src/contracts.ts'
import { checkReport } from '../src/check-report.ts'
import { validSnapshot } from '../src/snapshot-schema.ts'
import type { Snapshot } from '../src/model.ts'
import { assumedIdentity } from './identity-fixture.ts'

const policy = {
  bootstrap: 1000,
  bootstrapSurface: 1,
  perDoubling: 0,
  hardLimit: 1000,
  maxFeedbackMs: 15000,
}
function facts(text: string): ControlDepthFacts {
  return {
    metric: 'control-depth-v1',
    complete: true,
    regions: measureControlDepth(
      ts,
      ts.createSourceFile('app.ts', text, ts.ScriptTarget.Latest, true),
      'app.ts',
    ),
  }
}
const nested = (depth: number) =>
  'export function ready() {' +
  'if (true) {'.repeat(depth) +
  'return true;' +
  '}'.repeat(depth) +
  '}'

test('control depth counts decisions, not indentation, wrappers, or else-if chain length', () => {
  for (const [body, expected] of [
    ['if (a) { if (b) { if (c) { return 1 } } }', 3],
    ['if (a) return 1; if (b) return 2; return 3', 1],
    ['if (a) {} else if (b) {} else if (c) {}', 1],
    ['if (a) {} else { if (b) {} else { if (c) {} } }', 1],
    ['{{{ if (a) {} }}}', 1],
    ['try { if (a) {} } finally { if (b) {} }', 1],
    ['try {} catch (error) { if (a) {} }', 2],
    ['switch (a) { case 1: if (b) {} break; case 2: break; default: break }', 2],
    ['for (;;) { while (a) { do {} while (b) } }', 3],
    ['for (const a in b) { for (const c of d) { if (e) {} } }', 3],
    ['return a ? b ? 1 : 2 : 3', 2],
    ['if (a ? b : c) {}', 2],
    ['return a && b || c', 0],
    ['await operation()', 0],
  ] as const) {
    const result = facts(`async function ready() { ${body} }`)
    assert.equal(result.regions.find((region) => region.name === 'ready')!.depth, expected, body)
    assert.ok(validControlDepth(result, [{ file: 'app.ts' }]))
  }
  const compact = facts('function ready(){if(a){if(b){return 1}}}')
  const formatted = facts(
    'function ready() {\n\tif (a) {\n        if (b) {\n            return 1\n        }\n    }\n}',
  )
  assert.equal(compact.regions[1]!.depth, formatted.regions[1]!.depth)
})

test('closures reset depth while parameter initializers and lexical module decisions remain measured', () => {
  const result = facts(`if (outside) { if (again) {} }
class Example {
  static { if (startup) {} }
  field = choice ? 1 : 2
  method(value = first ? second ? 1 : 2 : 3) {
    if (outer) { const closure = () => { if (inner) { if (deep) {} } }; closure() }
  }
}`)
  assert.equal(result.regions.find((region) => region.kind === 'module')!.depth, 2)
  assert.equal(result.regions.find((region) => region.name === 'method')!.depth, 2)
  const closure = result.regions.find((region) => region.name === '<anonymous>')!
  assert.equal(closure.depth, 2)
  assert.ok(closure.deepestLine >= closure.line)
  assert.ok(closure.deepestColumn > 0)
  assert.equal(
    facts('function outer() { if (a) { return () => { if (b) {} } } }').regions[1]!.depth,
    1,
  )
})

test('destructured parameter bindings measure nested defaults and independent closures', () => {
  for (const parameters of [
    '{ value = first ? (second ? 1 : 2) : 3 }',
    '[value = first ? (second ? 1 : 2) : 3]',
    '{ nested: { value = first ? (second ? 1 : 2) : 3 } = {} }',
    '{ values: [value = first ? (second ? 1 : 2) : 3] = [] } = {}',
    '{ [first ? (second ? "a" : "b") : "c"]: value }',
  ]) {
    const result = facts(`function ready(${parameters}) { return value }`)
    assert.equal(result.regions.length, 2, parameters)
    assert.equal(result.regions[0]!.depth, 0, parameters)
    assert.equal(result.regions[1]!.name, 'ready')
    assert.equal(result.regions[1]!.depth, 2, parameters)
    assert.ok(validControlDepth(result, [{ file: 'app.ts' }]))
  }
  for (const parameters of [
    '{ value = first ? (() => second ? (third ? 1 : 2) : 3) : fallback }',
    '[value = first ? (() => second ? (third ? 1 : 2) : 3) : fallback]',
  ]) {
    const result = facts(`function ready(${parameters}) { return value }`)
    assert.equal(result.regions.length, 3, parameters)
    assert.equal(result.regions.find((region) => region.kind === 'module')!.depth, 0)
    assert.equal(result.regions.find((region) => region.name === 'ready')!.depth, 1)
    assert.equal(result.regions.find((region) => region.name === '<anonymous>')!.depth, 2)
    assert.ok(validControlDepth(result, [{ file: 'app.ts' }]))
  }
})

function candidate(depth = 4): Snapshot {
  const contracts = compileContracts([
    {
      file: 'ready.feature',
      text: 'Feature: Ready\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
    },
  ])
  const result = buildSnapshot('candidate', contracts, {
    files: [{ file: 'app.ts', tokens: 10 }],
    components: [
      {
        file: 'app.ts',
        line: 1,
        id: 'app.ts#ready',
        name: 'ready',
        kind: 'production',
        tokens: 10,
      },
    ],
    relationships: [],
    actions: { ready: 'app.ts#ready' },
    problems: [],
    controlDepth: facts(nested(depth)),
  })
  result.identity = assumedIdentity
  result.evidence = {
    schema: 'bonsai-evidence-v2',
    identity: assumedIdentity,
    fingerprint: 'candidate',
    profile: 'isolated-scenarios-v1',
    complete: true,
    elapsedMs: 1,
    checks: contracts.checks.map(({ id }) => ({ id, status: 'passed' })),
  }
  return result
}

test('the opt-in structural boundary rejects five, accepts four, and never changes retained size or allowance', () => {
  const required = { ...policy, structural: { metric: 'control-depth-v1' as const, maxDepth: 4 } }
  const baseline = evaluate(undefined, candidate(5), policy)
  assert.equal(baseline.status, 'pass', 'Existing configurations retain their behavior')
  assert.equal(evaluate(undefined, candidate(4), required).status, 'pass')
  const rejected = evaluate(undefined, candidate(5), required)
  assert.equal(rejected.status, 'reject')
  assert.equal(rejected.retained, baseline.retained)
  assert.equal(rejected.ceiling, baseline.ceiling)
  assert.equal(rejected.surface, baseline.surface)
  assert.equal(rejected.violations.length, 1)
  assert.match(rejected.violations[0]!, /Control-flow depth 5 exceeds 4 at app.ts:1:/)
})

test('missing, partial, foreign, duplicate and malformed required measurements cannot become depth zero', () => {
  const required = { ...policy, structural: { metric: 'control-depth-v1' as const, maxDepth: 4 } }
  for (const mutate of [
    (s: Snapshot) => {
      delete s.source.controlDepth
    },
    (s: Snapshot) => {
      s.source.controlDepth!.complete = false
    },
    (s: Snapshot) => {
      s.source.controlDepth!.regions.shift()
    },
    (s: Snapshot) => {
      s.source.controlDepth!.regions.push(s.source.controlDepth!.regions[0]!)
    },
    (s: Snapshot) => {
      s.source.controlDepth!.regions[0]!.file = 'foreign.ts'
    },
    (s: Snapshot) => {
      s.source.controlDepth!.regions[1]!.depth = -1
    },
    (s: Snapshot) => {
      s.source.controlDepth!.regions[1]!.depth = 1.5
    },
    (s: Snapshot) => {
      ;(s.source.controlDepth as unknown as { metric: string }).metric = 'unknown'
    },
  ]) {
    const snapshot = candidate()
    mutate(snapshot)
    assert.equal(evaluate(undefined, snapshot, required).status, 'incomplete')
  }
  assert.equal(validSnapshot(candidate()), true)
  const invalid = candidate()
  invalid.source.controlDepth!.regions[0]!.depth = Number.NaN
  assert.equal(validSnapshot(invalid), false)
})

test('a required TypeScript metric cannot claim empty Python/Rust or mixed executable scope', () => {
  const required = { ...policy, structural: { metric: 'control-depth-v1' as const, maxDepth: 4 } }
  // Hypothetical evaluator inputs do not claim an implemented Python or Rust collector.
  for (const file of ['bindings.py', 'bindings.rs']) {
    const snapshot = candidate()
    snapshot.source.files = [{ file, tokens: 10 }]
    snapshot.source.components[0]!.file = file
    snapshot.source.components[0]!.id = `${file}#ready`
    snapshot.source.actions.ready = `${file}#ready`
    snapshot.source.controlDepth = { metric: 'control-depth-v1', complete: true, regions: [] }
    assert.equal(validControlDepth(snapshot.source.controlDepth, snapshot.source.files), false)
    assert.equal(evaluate(undefined, snapshot, required).status, 'incomplete', file)
  }
  for (const file of ['support.py', 'support.pyi', 'support.rs', 'support.js', 'support.tsx']) {
    const snapshot = candidate()
    snapshot.source.files.push({ file, tokens: 1 })
    assert.equal(evaluate(undefined, snapshot, required).status, 'incomplete', file)
    snapshot.source.controlDepth!.complete = false
    assert.equal(validControlDepth(snapshot.source.controlDepth, snapshot.source.files), true)
    assert.equal(evaluate(undefined, snapshot, policy).status, 'pass', 'Legacy policy stays opt-in')
  }
  assert.equal(controlDepthSupported([]), false)
  assert.equal(controlDepthSupported([{ file: 'app.ts' }, { file: 'schema.json' }]), true)
  assert.equal(
    controlDepthSupported([{ file: 'app.ts' }, { file: 'app.custom', executable: true }]),
    false,
  )
  assert.equal(controlDepthSupported([{ file: 'app.ts', executable: 'yes' as never }]), false)
})

test('structural policy has an explicit metric and nonnegative integral limit without changing legacy defaults', () => {
  validatePolicy(policy)
  validateStructuralPolicy(undefined)
  validateStructuralPolicy({ metric: 'control-depth-v1', maxDepth: 0 })
  for (const value of [
    null,
    {},
    { maxDepth: 4 },
    { metric: 'unknown', maxDepth: 4 },
    { metric: 'control-depth-v1', maxDepth: -1 },
    { metric: 'control-depth-v1', maxDepth: 1.5 },
    { metric: 'control-depth-v1', maxDepth: 4, ignore: true },
  ])
    assert.throws(() => validateStructuralPolicy(value))
})

test('structural blockers provide cause-specific repairs using the existing critical alert role', () => {
  const required = { ...policy, structural: { metric: 'control-depth-v1' as const, maxDepth: 4 } }
  const snapshot = candidate(5)
  const render = () =>
    checkReport(snapshot, evaluate(undefined, snapshot, required), {
      bindings: 'bindings.ts',
      verbose: false,
      limit: 20,
      invocation: (words) => words.join(' '),
    }).problems
  const rejected = render()
  assert.ok(
    rejected.some(
      (line) =>
        typeof line !== 'string' &&
        line.role === 'error' &&
        line.text.includes('Control-flow depth 5 exceeds 4'),
    ),
  )
  assert.ok(
    rejected.some(
      (line) =>
        typeof line !== 'string' &&
        line.text.includes(
          'Reduce control-flow nesting at the reported location while preserving required behavior',
        ),
    ),
  )
  delete snapshot.source.controlDepth
  assert.ok(
    render().some(
      (line) =>
        typeof line !== 'string' &&
        line.text.includes(
          'Run complete source analysis with a checker supporting the configured control-depth-v1 requirement',
        ),
    ),
  )
})
