import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { checkAncestry, inspectAncestryConfiguration } from '../features/support/ancestry.ts'
import { runCli } from './cli.ts'
import { createProject } from './project.ts'

// These protocol, compiler, metric, and source-graph assertions supplement the
// stakeholder examples in ancestry.feature; they do not define product surface.
function verification(report: ReturnType<typeof checkAncestry>) {
  return report.snapshot.timing.stages.find(
    (stage: { name: string }) => stage.name === 'verification',
  )
}

function supportedEvidence(report: ReturnType<typeof checkAncestry>) {
  assert.deepEqual(report.snapshot.source.problems, [])
  assert.equal(report.snapshot.evidence.complete, true)
  assert.equal(report.snapshot.evidence.checks[0].status, 'passed')
}

test('ancestry rejection fixtures retain valid source and complete passing evidence', () => {
  for (const fixture of [
    'test-only',
    'mixed-test',
    'uncontracted-registration',
    'shared-helper',
  ] as const) {
    const report = checkAncestry({ case: fixture })
    assert.equal(report.exitCode, 1, fixture)
    assert.equal(report.decision.status, 'reject', fixture)
    assert.equal(report.handlerExecuted, true, fixture)
    supportedEvidence(report)
    assert.equal(!!report.snapshot.ancestry['dead.ts#dead']?.length, false, fixture)
    if (fixture === 'shared-helper') {
      assert.ok(report.snapshot.ancestry['helpers.test.ts#common']?.length)
      assert.equal(!!report.snapshot.ancestry['unit.test.ts#deadCase']?.length, false)
    }
  }
})

test('an unmaintained local import leaves verification explicitly skipped', () => {
  const report = checkAncestry({ case: 'missing-inventory' })
  assert.equal(verification(report)?.status, 'skipped')
  assert.equal(report.snapshot.evidence, undefined)
})

test('trusted policy comparison preserves capacity, inventory ordering, and effective configuration', () => {
  const budget = checkAncestry({ case: 'trusted-budget' })
  assert.equal(budget.decision.base.additionalCapacity, 0)
  assert.deepEqual(budget.snapshot.unrooted, [])
  assert.equal(budget.snapshot.evidence.complete, true)

  const scope = checkAncestry({ case: 'trusted-scope' })
  assert.equal(scope.snapshot.source.files[6].file, 'src/dead.ts')
  assert.equal(scope.snapshot.source.files[7].file, 'src/nested/bonsai.json')
  assert.equal(scope.snapshot.source.files[8].file, 'src/nested/hidden.ts')
  const configuration = inspectAncestryConfiguration({ case: 'trusted-scope' })
  assert.equal(configuration.exitCode, 0)
  assert.equal(configuration.origin.policy, 'base')
  assert.equal(configuration.config.maintained[0], 'src')
  assert.deepEqual(configuration.config.exclude, ['*.generated.ts'])
  assert.equal(configuration.handlerExecuted, false)

  const explicit = checkAncestry({ case: 'explicit-policy' })
  assert.equal(explicit.snapshot.evidence.complete, true)
  const explicitConfiguration = inspectAncestryConfiguration({ case: 'explicit-policy' })
  assert.equal(explicitConfiguration.exitCode, 0)
  assert.equal(explicitConfiguration.origin.policy, '--policy')
  assert.equal(explicitConfiguration.config.policy.bootstrap, 100000)
  assert.equal(explicitConfiguration.handlerExecuted, false)
})

test('literal selected imports retain complete native verification evidence', () => {
  const report = checkAncestry({ case: 'literal-import' })
  supportedEvidence(report)
  assert.equal(report.exitCode, 1)
  assert.equal(report.decision.status, 'reject')
  assert.deepEqual(report.snapshot.unrooted, ['format.ts#unused'])
  assert.equal(report.handlerExecuted, true)
})

test('unsupported Rust source preserves its diagnostic, metric, and skipped-verification metadata', () => {
  const report = checkAncestry({ case: 'unsupported-language' })
  assert.equal(report.exitCode, 2)
  assert.equal(report.decision.status, 'incomplete')
  assert.equal(report.handlerExecuted, false)
  assert.deepEqual(report.snapshot.source.problems, ['Unsupported source language: unsupported.rs'])
  assert.equal(report.snapshot.source.files[5].file, 'unsupported.rs')
  assert.equal(report.snapshot.source.files[5].tokens, 7)
  assert.equal(verification(report)?.status, 'skipped')
})

test('native type-error analysis identifies its backend and skips verification', () => {
  const report = checkAncestry({ case: 'type-error' })
  assert.equal(report.snapshot.source.problems.length, 1)
  assert.equal(report.snapshot.analysis.backend, 'tsrs')
  assert.equal(verification(report)?.status, 'skipped')
})

test('maintained JSON keeps its exact token metric and inventory location with real evidence', () => {
  const report = checkAncestry({ case: 'json-dependency' })
  assert.equal(report.exitCode, 0)
  assert.equal(report.decision.status, 'pass')
  assert.equal(report.handlerExecuted, true)
  assert.equal(report.snapshot.evidence.complete, true)
  assert.equal(report.snapshot.evidence.checks[0].status, 'passed')
  assert.equal(report.snapshot.source.files[5].file, 'settings.json')
  assert.equal(report.snapshot.source.files[5].tokens, 9)
})

const behavior = `Feature: Source conformance
Scenario: Observe a registered handler
 When I invoke "live" with {}
 Then response "status" equals "ok"
`

function sourceContract(
  extra: Record<string, string>,
  registration = "export const actions = { 'live': live }",
) {
  const project = createProject({
    'package.json': '{"type":"module"}\n',
    'app.ts': `import { writeFileSync } from 'node:fs'
export function live() {
 writeFileSync(new URL('./handler-ran', import.meta.url), 'executed')
 return { status: 'ok' }
}
`,
    'bindings.ts': `import { live } from './app.ts'\n${registration}\n`,
    'orders.feature': behavior,
    ...extra,
  })
  try {
    const result = runCli(['check', '--root', project.root, '--json'], {
      timeout: 30000,
    })
    assert.equal(result.error, undefined, String(result.error))
    assert.notEqual(result.status, null, result.stderr)
    return {
      exitCode: result.status,
      ...JSON.parse(result.stdout || result.stderr),
      handlerExecuted: existsSync(join(project.root, 'handler-ran')),
    }
  } finally {
    project.dispose()
  }
}

test('uppercase no-default-lib directives produce the specific native unsupported result before execution', () => {
  const report = sourceContract({
    'globals.d.ts': '/// <REFERENCE NO-DEFAULT-LIB="true"/>\n',
  })
  assert.equal(report.exitCode, 2)
  assert.equal(report.decision.status, 'incomplete')
  assert.deepEqual(report.snapshot.source.problems, [
    "Rust checker unsupported: globals.d.ts disables default libraries with no-default-lib; tsrs does not preserve this directive's diagnostics",
  ])
  assert.equal(report.snapshot.source.files[3].file, 'globals.d.ts')
  assert.equal(report.snapshot.source.files[3].tokens, 16)
  assert.equal(report.snapshot.analysis.status, 'unsupported')
  assert.equal(verification(report)?.status, 'skipped')
  assert.equal(report.handlerExecuted, false)
})

test('computed, spread, and inline registrations preserve the adapter diagnostic without executing handlers', () => {
  for (const registration of [
    "const key = 'live'; export const actions = { [key]: live }",
    "const entries = { 'live': live }; export const actions = { ...entries }",
    "export const actions = { 'live': () => live() }",
  ]) {
    const report = sourceContract({}, registration)
    assert.equal(report.exitCode, 2, registration)
    assert.equal(report.decision.status, 'incomplete', registration)
    assert.equal(
      report.snapshot.source.problems[0],
      'Each action binding must be a literal key and named handler',
      registration,
    )
    assert.equal(verification(report)?.status, 'skipped', registration)
    assert.equal(report.handlerExecuted, false, registration)
  }
})
