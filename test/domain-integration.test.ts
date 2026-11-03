import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileContracts } from '../src/contracts.ts'
import { collectRustSource } from '../src/collector.ts'
import { fingerprint, inventory } from '../src/inventory.ts'
import { buildSnapshot, explain } from '../src/retention.ts'
import { parseSnapshot, validSnapshot } from '../src/snapshot-schema.ts'
import type { Config, Snapshot } from '../src/model.ts'
import type { DomainStepDefinition } from '../src/domain-steps.ts'
import { analyzeSource } from './reference.ts'
import { canonicalSource } from './native/client.ts'
import { cliEnvironment, runCli } from './cli.ts'

const feature = `Feature: Commission useful material
  Scenario: Commission a sample for a chosen reader problem
    Given a publisher has chosen "confusing feedback"
    When they commission a pilot
    Then they receive a sample and its practice materials
`
const bindings = `import { pilot } from './handler.ts'
export const actions = { pilot: pilot }
export const steps = [
  { given: 'a publisher has chosen {problem:string}', input: { problem: { parameter: 'problem' } } },
  { when: 'they commission a pilot', action: 'pilot' },
  { then: 'they receive a sample and its practice materials', observations: [
    { selector: 'sample.available', equals: true },
    { selector: 'materials.available', equals: true },
  ] },
] as const
`
const handler = `import { writeFileSync } from 'node:fs'
import { materials } from './materials.ts'
export function pilot(input: {problem: string}) {
  writeFileSync(new URL('./called.json', import.meta.url), JSON.stringify(input))
  return { sample: {available: true}, materials: materials() }
}
`

function fixture(extra: Record<string, string> = {}) {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/domain-integration-'))
  const content = {
    'package.json': '{"private":true,"type":"module"}',
    'bindings.ts': bindings,
    'handler.ts': handler,
    'materials.ts': 'export function materials() { return {available: true} }\n',
    'pilot.feature': feature,
    ...extra,
  }
  for (const [file, text] of Object.entries(content)) writeFileSync(resolve(root, file), text)
  const config: Config = {
    maintained: [...Object.keys(content), 'bonsai.json'],
    bindings: 'bindings.ts',
    policy: {
      bootstrap: 20000,
      bootstrapSurface: 20,
      perDoubling: 2000,
      hardLimit: 30000,
      maxFeedbackMs: 15000,
    },
  }
  writeFileSync(resolve(root, 'bonsai.json'), JSON.stringify(config))
  return { root, config, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

test('native domain facts preserve reference parity, metadata provenance, and selected source ancestry', async () => {
  const project = fixture({
    'bindings.ts':
      "import { unused } from './unused.ts'\n" +
      bindings
        .replace('pilot: pilot }', 'pilot: pilot, unused: unused }')
        .replace(
          '] as const',
          "  { when: 'they request unrelated work', action: 'unused' },\n] as const",
        ),
    'unused.ts': 'export function unused() { return {unrelated: true} }\n',
  })
  try {
    const files = inventory(project.root, project.config.maintained)
    const reference = analyzeSource(project.root, files, project.config.bindings)
    const native = await collectRustSource(project.root, files, project.config.bindings)
    assert.deepEqual(native.source.problems, [])
    assert.deepEqual(canonicalSource(native.source), canonicalSource(reference))
    assert.equal(native.source.stepRegistry, 'bindings.ts#steps')
    assert.equal(native.source.stepDefinitions?.length, 4)
    const contracts = compileContracts(
      [{ file: 'pilot.feature', text: feature }],
      native.source.stepDefinitions,
    )
    assert.deepEqual(contracts.problems, [])
    const before = fingerprint(project.root, files, project.config)
    const snapshot = buildSnapshot(before, contracts, native.source)
    const ids = contracts.checks.map((check) => check.id)
    for (const component of ['bindings.ts#steps', 'handler.ts#pilot', 'materials.ts#materials'])
      assert.deepEqual(snapshot.ancestry[component], ids)
    assert.ok(snapshot.unrooted.includes('unused.ts#unused'))
    assert.equal(snapshot.ancestry['unused.ts#unused'], undefined)
    assert.equal(native.source.files.filter((file) => file.file === 'bindings.ts').length, 1)
    assert.ok(native.source.files.find((file) => file.file === 'bindings.ts')!.tokens > 0)
    const metadata = explain(snapshot, 'bindings.ts#steps')[0]!
    assert.deepEqual(
      metadata.contractPaths,
      ids.map((check) => ({ check, components: ['bindings.ts#steps'], registry: true })),
    )
    const child = explain(snapshot, 'materials.ts#materials')[0]!
    assert.deepEqual(
      child.contractPaths,
      ids.map((check) => ({ check, components: ['handler.ts#pilot', 'materials.ts#materials'] })),
    )
    assert.ok(
      child.checks.every(
        (check) =>
          check.file === 'pilot.feature' && check.line === 5 && check.definitionRefs?.length === 3,
      ),
    )
    assert.equal(existsSync(resolve(project.root, 'called.json')), false)

    const changed = readFileSync(resolve(project.root, 'bindings.ts'), 'utf8').replace(
      "selector: 'materials.available', equals: true",
      "selector: 'materials.available', equals: false",
    )
    writeFileSync(resolve(project.root, 'bindings.ts'), changed)
    const refreshed = await collectRustSource(project.root, files, project.config.bindings)
    assert.deepEqual(refreshed.source.problems, [])
    assert.deepEqual(
      canonicalSource(refreshed.source),
      canonicalSource(analyzeSource(project.root, files, project.config.bindings)),
    )
    const updated = compileContracts(
      [{ file: 'pilot.feature', text: feature }],
      refreshed.source.stepDefinitions,
    )
    assert.deepEqual(
      updated.checks.map((check) => check.expected),
      [true, false],
    )
    assert.notEqual(fingerprint(project.root, files, project.config), before)
    assert.equal(existsSync(resolve(project.root, 'called.json')), false)
  } finally {
    project.dispose()
  }
})

test('domain checks execute real application facts in both profiles and reject an independently wrong consequence', {
  timeout: 60000,
}, () => {
  for (const serial of [false, true]) {
    const project = fixture()
    try {
      for (const wrong of [false, true]) {
        writeFileSync(
          resolve(project.root, 'materials.ts'),
          `export function materials() { return {available: ${!wrong}} }\n`,
        )
        rmSync(resolve(project.root, 'called.json'), { force: true })
        const result = runCli([
          'check',
          '--root',
          project.root,
          '--json',
          '--no-report',
          ...(serial ? ['--serial'] : []),
        ])
        assert.equal(result.error, undefined)
        assert.equal(result.status, wrong ? 1 : 0, result.stderr || result.stdout)
        const report = JSON.parse(result.stdout)
        assert.equal(report.decision.status, wrong ? 'reject' : 'pass')
        assert.deepEqual(report.snapshot.source.problems, [])
        assert.deepEqual(report.snapshot.contracts.problems, [])
        assert.equal(report.snapshot.evidence.complete, true)
        assert.equal(
          report.snapshot.evidence.profile,
          serial ? 'in-process-v1' : 'isolated-scenarios-v1',
        )
        assert.deepEqual(
          report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
          ['passed', wrong ? 'failed' : 'passed'],
        )
        assert.deepEqual(
          report.snapshot.evidence.checks.map((check: { id: string }) => check.id),
          report.snapshot.contracts.checks.map((check: { id: string }) => check.id),
        )
        assert.deepEqual(JSON.parse(readFileSync(resolve(project.root, 'called.json'), 'utf8')), {
          problem: 'confusing feedback',
        })
      }
    } finally {
      project.dispose()
    }
  }
})

test('domain metadata explain is read-only even when importing the registry would throw', () => {
  const project = fixture({
    'bindings.ts': "throw new Error('explain must not import the registry')\n" + bindings,
  })
  try {
    const result = runCli(['explain', 'bindings.ts#steps', '--root', project.root, '--json'])
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.analysis.status, 'complete')
    assert.deepEqual(report.problems, [])
    assert.equal(report.components.length, 1)
    assert.equal(report.components[0].checks.length, 2)
    assert.equal(report.components[0].contractPaths.length, 2)
    assert.ok(
      report.components[0].contractPaths.every((path: { registry?: boolean }) => path.registry),
    )
    assert.equal(existsSync(resolve(project.root, 'called.json')), false)
  } finally {
    project.dispose()
  }
})

test('unsupported executable step metadata blocks before registry or handler execution', () => {
  const project = fixture({
    'bindings.ts':
      "import { writeFileSync } from 'node:fs'\n" +
      bindings
        .replace(
          'export const steps = [',
          "export const steps = (() => { writeFileSync(new URL('./metadata-executed', import.meta.url), 'executed'); return [",
        )
        .replace('] as const', '] as const })()'),
  })
  try {
    const result = runCli(['check', '--root', project.root, '--json', '--no-report'])
    assert.equal(result.error, undefined)
    assert.equal(result.status, 2, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.decision.status, 'incomplete')
    assert.match(report.snapshot.source.problems.join('\n'), /unsupported domain step definitions/)
    assert.equal(report.snapshot.evidence, undefined)
    assert.equal(existsSync(resolve(project.root, 'metadata-executed')), false)
    assert.equal(existsSync(resolve(project.root, 'called.json')), false)
  } finally {
    project.dispose()
  }
})

test('malformed native domain metadata cannot reach application execution', {
  timeout: 60000,
}, () => {
  const project = fixture()
  const preload = resolve(project.root, 'corrupt-domain-metadata.mjs')
  const mutationMarker = resolve(project.root, 'mutation-observed')
  writeFileSync(
    preload,
    `import { writeFileSync } from 'node:fs'
if (process.argv[1]?.endsWith('tsrs-worker.ts')) {
  const write = process.stdout.write.bind(process.stdout)
  const mutations = {
    missingRegistry(value) { delete value.source.stepRegistry },
    wrongRegistry(value) { value.source.stepRegistry = value.source.registry },
    foreignDefinition(value) { value.source.stepDefinitions[0].sourceRef.file = 'handler.ts' },
    malformedDefinition(value) { value.source.stepDefinitions[0].input = [] },
    missingDefinitions(value) { delete value.source.stepDefinitions },
  }
  process.stdout.write = (chunk, ...args) => {
    const value = JSON.parse(String(chunk))
    if (value.protocol === 2 && value.source) {
      const mutate = mutations[process.env.BONSAI_TEST_DOMAIN_CORRUPTION]
      if (mutate) { mutate(value); writeFileSync(${JSON.stringify(mutationMarker)}, 'applied') }
    }
    return write(JSON.stringify(value) + '\\n', ...args)
  }
}
`,
  )
  const env = cliEnvironment({ BUN_OPTIONS: `--preload ${pathToFileURL(preload).href}` })
  try {
    const control = runCli(['check', '--root', project.root, '--json', '--no-report'], { env })
    assert.equal(control.error, undefined)
    assert.equal(control.status, 0, control.stderr || control.stdout)
    assert.equal(existsSync(resolve(project.root, 'called.json')), true)
    for (const mode of [
      'missingRegistry',
      'wrongRegistry',
      'foreignDefinition',
      'malformedDefinition',
      'missingDefinitions',
    ]) {
      rmSync(resolve(project.root, 'called.json'), { force: true })
      rmSync(mutationMarker, { force: true })
      const result = runCli(['check', '--root', project.root, '--json', '--no-report'], {
        env: { ...env, BONSAI_TEST_DOMAIN_CORRUPTION: mode },
      })
      assert.equal(result.error, undefined)
      assert.equal(result.status, 1, `${mode}: ${result.stderr || result.stdout}`)
      assert.equal(result.stdout, '', mode)
      assert.equal(JSON.parse(result.stderr).code, 'RUST_COLLECTOR', mode)
      assert.equal(
        existsSync(mutationMarker),
        true,
        `${mode} must exercise the actual worker response`,
      )
      assert.equal(existsSync(resolve(project.root, 'called.json')), false, mode)
    }
  } finally {
    project.dispose()
  }
})

test('serialized domain facts and contributing definition references fail closed on malformed shapes', () => {
  const definitions: DomainStepDefinition[] = [
    {
      kind: 'given',
      pattern: 'a publisher has chosen {problem:string}',
      input: { problem: { parameter: 'problem' } },
      sourceRef: { file: 'bindings.ts', line: 4 },
    },
    {
      kind: 'when',
      pattern: 'they commission a pilot',
      action: 'pilot',
      sourceRef: { file: 'bindings.ts', line: 5 },
    },
    {
      kind: 'then',
      pattern: 'they receive a sample and its practice materials',
      observations: [
        { selector: 'sample.available', equals: true },
        { selector: 'materials.available', equals: true },
      ],
      sourceRef: { file: 'bindings.ts', line: 6 },
    },
  ]
  const contracts = compileContracts([{ file: 'pilot.feature', text: feature }], definitions)
  const snapshot = buildSnapshot('structural-domain-fixture', contracts, {
    files: [
      { file: 'bindings.ts', tokens: 80 },
      { file: 'handler.ts', tokens: 20 },
    ],
    components: [
      {
        id: 'bindings.ts#actions',
        name: 'actions',
        file: 'bindings.ts',
        line: 2,
        tokens: 10,
        kind: 'binding',
      },
      {
        id: 'bindings.ts#steps',
        name: 'steps',
        file: 'bindings.ts',
        line: 3,
        tokens: 70,
        kind: 'binding',
      },
      {
        id: 'handler.ts#pilot',
        name: 'pilot',
        file: 'handler.ts',
        line: 1,
        tokens: 20,
        kind: 'production',
      },
    ],
    relationships: [],
    actions: { pilot: 'handler.ts#pilot' },
    registry: 'bindings.ts#actions',
    stepRegistry: 'bindings.ts#steps',
    stepDefinitions: definitions,
    problems: [],
  })
  assert.equal(validSnapshot(snapshot), true)
  assert.deepEqual(parseSnapshot(JSON.stringify(snapshot)), JSON.parse(JSON.stringify(snapshot)))
  const corruptions: ((value: Snapshot) => void)[] = [
    (value) => {
      value.contracts.checks[0]!.definitionRefs![0]!.line = 0
    },
    (value) => {
      const action = value.contracts.cases[0]!.steps[0]!
      if (action.kind === 'action') action.definitionRefs = 'invalid' as never
    },
    (value) => {
      value.source.stepRegistry = 3 as never
    },
    (value) => {
      value.source.stepDefinitions![0]!.sourceRef.line = -1
    },
    (value) => {
      value.source.stepDefinitions![0]!.kind = 'unknown' as never
    },
    (value) => {
      const definition = value.source.stepDefinitions![0]!
      if (definition.kind === 'given') definition.input = [] as never
    },
    (value) => {
      const definition = value.source.stepDefinitions![2]!
      if (definition.kind === 'then') definition.observations[0]!.selector = 'sample.*'
    },
  ]
  for (const corrupt of corruptions) {
    const malformed = structuredClone(snapshot)
    corrupt(malformed)
    assert.equal(validSnapshot(malformed), false)
    assert.throws(
      () => parseSnapshot(JSON.stringify(malformed)),
      /Invalid|Unsupported|invalid|unsupported/,
    )
  }
})
