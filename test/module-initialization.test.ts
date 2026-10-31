import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createProject } from './project.ts'
import { runCli } from './cli.ts'
import { collectRustSource } from '../src/collector.ts'
import { compileContracts } from '../src/contracts.ts'
import { buildSnapshot, explain } from '../src/retention.ts'
import { inventory, fingerprint } from '../src/inventory.ts'
import { runEvidence } from '../src/evidence.ts'
import { readConfig } from '../src/project.ts'
import { analyzeSource } from './reference.ts'
import { canonicalSource } from './native/client.ts'
import type { Source } from '../src/model.ts'

const feature = [
  'Feature: Read initialized state',
  'Scenario: Read the result',
  ' When I invoke "live" with {}',
  ' Then response "status" equals "ready"',
  '',
].join('\n')

test('the native gate retains imported startup without executing it during explain', () => {
  const project = createProject({
    'package.json': '{"type":"module"}',
    'bindings.ts': "import { live } from './app.ts'\nexport const actions = { live: live }\n",
    'app.ts':
      "import './boot.ts'\nimport { read } from './state.ts'\nexport function live() { return { status: read() } }\n",
    'state.ts':
      "let status = 'cold'\nexport function initialize() { status = 'ready' }\nexport function read() { return status }\n",
    'boot.ts':
      "import { writeFileSync } from 'node:fs'\nimport { initialize } from './state.ts'\ninitialize()\nwriteFileSync(new URL('./started', import.meta.url), 'started')\n",
    'live.feature': feature,
  })
  try {
    const inspection = runCli(['explain', 'boot.ts', '--root', project.root, '--json'])
    assert.equal(inspection.status, 0, inspection.stderr || inspection.stdout)
    assert.equal(existsSync(join(project.root, 'started')), false)
    const result = runCli(['check', '--root', project.root, '--json'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.decision.status, 'pass')
    assert.equal(report.snapshot.evidence.complete, true)
    assert.deepEqual(
      report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
      ['passed'],
    )
    assert.deepEqual(report.snapshot.source.problems, [])
    assert.deepEqual(report.snapshot.unrooted, [])
    assert.equal(existsSync(join(project.root, 'started')), true)
  } finally {
    project.dispose()
  }
})

async function both(project: ReturnType<typeof createProject>) {
  const files = inventory(project.root, project.files)
  const reference = analyzeSource(project.root, files, 'bindings.ts')
  const native = await collectRustSource(project.root, files, 'bindings.ts')
  assert.deepEqual(canonicalSource(native.source), canonicalSource(reference))
  assert.deepEqual(native.source.problems, [])
  const contracts = compileContracts([{ file: 'live.feature', text: feature }])
  return {
    source: native.source,
    snapshot: buildSnapshot('module-startup', contracts, native.source),
  }
}

test('registry initialization retains startup while its unused action remains unrooted', async () => {
  const project = createProject({
    'package.json': '{"type":"module"}',
    'bindings.ts':
      "import './registration.ts'\nimport { live, unused } from './app.ts'\nexport const actions = { live: live, unused: unused }\n",
    'app.ts':
      "export function live() { return { status: 'ready' } }\nexport function unused() { return 42 }\n",
    'registration.ts': "import { register } from './startup.ts'\nregister()\n",
    'startup.ts': "export function register() { return 'registered' }\n",
    'live.feature': feature,
  })
  try {
    const { source, snapshot } = await both(project)
    assert.ok(snapshot.ancestry['startup.ts#register']?.length)
    assert.deepEqual(snapshot.unrooted, ['app.ts#unused'])
    assert.ok(
      source.relationships.some(
        (edge) => edge.from === 'bindings.ts#actions' && edge.kind === 'module-initialization',
      ),
    )
  } finally {
    project.dispose()
  }
})

test('type-only and erased value imports retain type ancestry without activating startup', async () => {
  for (const clause of ['import type', 'import']) {
    const project = createProject({
      'package.json': '{"type":"module"}',
      'bindings.ts': "import { live } from './app.ts'\nexport const actions = { live: live }\n",
      'app.ts':
        clause +
        " { Shape, configured } from './types.ts'\ntype Handler = typeof configured\nexport function live(_input?: Shape, _handler?: Handler) { return { status: 'ready' } }\n",
      'types.ts':
        "import { writeFileSync } from 'node:fs'\nexport class Shape { value = 1 }\nexport function configured() { return 'ready' }\nwriteFileSync(new URL('./type-started', import.meta.url), 'started')\n",
      'live.feature': feature,
    })
    try {
      const { source, snapshot } = await both(project)
      assert.ok(snapshot.ancestry['types.ts#Shape']?.length)
      assert.ok(snapshot.ancestry['types.ts#configured']?.length)
      const initialization = source.components.find(
        (component) => component.file === 'types.ts' && component.name.startsWith('<top-level:'),
      )!
      assert.ok(initialization)
      assert.ok(snapshot.unrooted.includes(initialization.id))
      assert.ok(
        source.relationships.some((edge) => edge.to === 'types.ts#Shape' && edge.runtime === false),
      )
      assert.equal(existsSync(join(project.root, 'type-started')), false)
      const result = runCli(['check', '--root', project.root, '--json'])
      assert.equal(result.status, 1, result.stderr || result.stdout)
      const report = JSON.parse(result.stdout)
      assert.equal(report.snapshot.evidence.complete, true)
      assert.ok(
        report.snapshot.evidence.checks.every(
          (check: { status: string }) => check.status === 'passed',
        ),
      )
      assert.equal(
        existsSync(join(project.root, 'type-started')),
        false,
        clause + ' must agree with actual Bun import erasure',
      )
    } finally {
      project.dispose()
    }
  }
})

test('a real runtime import through a re-export activates startup after a type path', async () => {
  const project = createProject({
    'package.json': '{"type":"module"}',
    'bindings.ts': "import { live } from './app.ts'\nexport const actions = { live: live }\n",
    'app.ts':
      "import type { Shape } from './target.ts'\nimport { read } from './barrel.ts'\nexport function live(_input?: Shape) { return { status: read() } }\n",
    'barrel.ts': "export { read } from './target.ts'\n",
    'target.ts':
      "export class Shape { value = 1 }\nlet status = 'cold'\nfunction start() { status = 'ready' }\nstart()\nexport function read() { return status }\n",
    'live.feature': feature,
  })
  try {
    const { snapshot } = await both(project)
    assert.ok(snapshot.ancestry['target.ts#start']?.length)
    assert.deepEqual(snapshot.unrooted, [])
    const result = runCli(['check', '--root', project.root, '--json'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } finally {
    project.dispose()
  }
})

test('runtime traversal revisits a component after type ancestry without duplicating obligations', () => {
  const components = ['actions', 'handler', 'bridge', 'typed', 'startup'].map((name) => ({
    id: 'app.ts#' + name,
    name,
    file: 'app.ts',
    line: 1,
    tokens: 1,
    kind: name === 'actions' ? ('binding' as const) : ('production' as const),
  }))
  const edge = (
    from: string,
    to: string,
    runtime?: false,
    initialization = false,
  ): Source['relationships'][number] => ({
    from: 'app.ts#' + from,
    to: 'app.ts#' + to,
    kind: initialization ? 'module-initialization' : 'reference',
    origin: 'static',
    sourceRef: { file: 'app.ts', line: 1 },
    ...(runtime === false ? { runtime } : {}),
  })
  const source: Source = {
    files: [{ file: 'app.ts', tokens: 5 }],
    components,
    registry: 'app.ts#actions',
    actions: { live: 'app.ts#handler' },
    relationships: [
      edge('actions', 'handler'),
      edge('handler', 'bridge'),
      edge('handler', 'typed', false),
      edge('bridge', 'typed'),
      edge('typed', 'startup', undefined, true),
    ],
    problems: [],
  }
  const contracts = compileContracts([{ file: 'live.feature', text: feature }])
  const snapshot = buildSnapshot('mixed-path', contracts, source)
  assert.equal(snapshot.ancestry['app.ts#typed']?.length, 1)
  assert.equal(snapshot.ancestry['app.ts#startup']?.length, 1)
  const typeOnly = buildSnapshot('type-only', contracts, {
    ...source,
    relationships: source.relationships.filter(
      (relationship) => relationship.from !== 'app.ts#bridge',
    ),
  })
  assert.equal(typeOnly.ancestry['app.ts#typed']?.length, 1)
  assert.ok(typeOnly.unrooted.includes('app.ts#startup'))
})

test('admitted tests cannot promote production through their initialization dependencies', async () => {
  const project = createProject({
    'package.json': '{"type":"module"}',
    'bindings.ts': "import { live } from './app.ts'\nexport const actions = { live: live }\n",
    'app.ts': "export function live() { return { status: 'ready' } }\n",
    'support.test.ts':
      "import { live } from './app.ts'\nimport './barrel.test.ts'\nexport function exercise() { return live() }\n",
    'barrel.test.ts': "import './uncontracted.ts'\n",
    'uncontracted.ts': 'function hidden() { return 42 }\nhidden()\n',
    'live.feature': feature,
  })
  try {
    const { source, snapshot } = await both(project)
    assert.ok(snapshot.ancestry['support.test.ts#exercise']?.length)
    assert.equal(
      source.relationships.some(
        (relationship) =>
          relationship.from === 'support.test.ts#exercise' &&
          relationship.kind === 'module-initialization',
      ),
      false,
    )
    assert.ok(
      source.components
        .filter((component) => component.file === 'uncontracted.ts')
        .every((component) => snapshot.unrooted.includes(component.id)),
    )
  } finally {
    project.dispose()
  }
})

test('module initialization cycles terminate and preserve dormant exports', async () => {
  const project = createProject({
    'package.json': '{"type":"module"}',
    'bindings.ts': "import { live } from './app.ts'\nexport const actions = { live: live }\n",
    'app.ts':
      "import { answer } from './first.ts'\nexport function live() { return { status: answer() } }\n",
    'first.ts': "import './second.ts'\nexport function answer() { return 'ready' }\n",
    'second.ts':
      "import './first.ts'\nfunction start() { return true }\nstart()\nexport function dormant() { return 42 }\n",
    'live.feature': feature,
  })
  try {
    const { source, snapshot } = await both(project)
    assert.ok(snapshot.ancestry['second.ts#start']?.length)
    assert.deepEqual(snapshot.unrooted, ['second.ts#dormant'])
    const keys = source.relationships.map((edge) => [edge.from, edge.to, edge.kind].join('\0'))
    assert.equal(new Set(keys).size, keys.length)
  } finally {
    project.dispose()
  }
})

test('preserved import modes are incomplete until worker-context rules are supported', () => {
  for (const clause of ['import { Shape }', 'import { type Shape }', 'export { type Shape }']) {
    const project = createProject({
      'package.json': '{"type":"module"}',
      'tsconfig.json': '{"compilerOptions":{"verbatimModuleSyntax":true}}',
      'bindings.ts': "import { live } from './app.ts'\nexport const actions = { live: live }\n",
      'app.ts':
        clause +
        " from './types.ts'\nexport function live(_input?: import('./types.ts').Shape) { return { status: 'ready' } }\n",
      'types.ts': 'export class Shape { value = 1 }\n',
      'live.feature': feature,
    })
    try {
      const result = runCli(['check', '--root', project.root, '--json'])
      assert.equal(result.status, 2, result.stderr || result.stdout)
      const report = JSON.parse(result.stdout)
      assert.ok(
        report.snapshot.source.problems.some((problem: string) =>
          /preserved, inherited or legacy/.test(problem),
        ),
      )
      assert.equal(report.snapshot.evidence, undefined)
    } finally {
      project.dispose()
    }
  }
})

test('pinned Bun import and re-export probes use the real evidence-worker context', async () => {
  const clauses = [
    ["import { Shape } from './types.ts'", false],
    ["import { type Shape } from './types.ts'", false],
    ["import type { Shape } from './types.ts'", false],
    ["export { type Shape } from './types.ts'", false],
    ["export type { Shape } from './types.ts'", false],
    ["import { Shape } from './types.ts'; export { Shape as Renamed }", true],
    ["export {} from './types.ts'", true],
    ["export { Shape } from './types.ts'", true],
    ["import {} from './types.ts'", true],
  ] as const
  for (const preserve of [false, true])
    for (const [clause, started] of clauses) {
      const project = createProject({
        'package.json': '{"type":"module"}',
        'tsconfig.json': JSON.stringify({ compilerOptions: { verbatimModuleSyntax: preserve } }),
        'bindings.ts': "import { live } from './app.ts'\nexport const actions = { live: live }\n",
        'app.ts':
          clause +
          "\nexport function live(_input?: import('./types.ts').Shape) { return { status: 'ready' } }\n",
        'types.ts':
          "import { writeFileSync } from 'node:fs'\nexport class Shape { value = 1 }\nwriteFileSync(new URL('./probe-started',import.meta.url),'started')\n",
        'live.feature': feature,
      })
      try {
        const contracts = compileContracts([{ file: 'live.feature', text: feature }])
        const config = readConfig(project.root)
        const evidence = await runEvidence(
          project.root,
          config,
          contracts,
          fingerprint(project.root, inventory(project.root, project.files), config),
          15000,
        )
        assert.equal(evidence.complete, true)
        assert.ok(evidence.checks.every((check) => check.status === 'passed'))
        assert.equal(existsSync(join(project.root, 'probe-started')), started, clause)
        if (!preserve) {
          const { source, snapshot } = await both(project)
          const startup = source.components.find(
            (component) =>
              component.file === 'types.ts' && component.name.startsWith('<top-level:'),
          )!
          assert.ok(startup)
          assert.equal(!!snapshot.ancestry[startup.id]?.length, started, clause)
        }
        console.log(
          JSON.stringify({
            moduleImportProbe: {
              bun: process.versions.bun,
              preserve,
              clause,
              started: existsSync(join(project.root, 'probe-started')),
            },
          }),
        )
      } finally {
        project.dispose()
      }
    }
})

test('unsupported inherited import settings are incomplete rather than guessed', () => {
  const project = createProject({
    'package.json': '{"type":"module"}',
    'tsconfig.json': '{"extends":"./base.json"}',
    'base.json': '{"compilerOptions":{"verbatimModuleSyntax":true}}',
    'bindings.ts': "import { live } from './app.ts'\nexport const actions = { live: live }\n",
    'app.ts':
      "import { Shape } from './types.ts'\nexport function live(_input?: Shape) { return { status: 'ready' } }\n",
    'types.ts': 'export class Shape { value = 1 }\n',
    'live.feature': feature,
  })
  try {
    const result = runCli(['check', '--root', project.root, '--json'])
    assert.equal(result.status, 2, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.ok(
      report.snapshot.source.problems.some((problem: string) =>
        /inherited or legacy/.test(problem),
      ),
    )
    assert.equal(report.snapshot.evidence, undefined)
  } finally {
    project.dispose()
  }
})

test('type-only references do not activate child entry-point startup', () => {
  const source: Source = {
    files: [{ file: 'app.ts', tokens: 4 }],
    components: ['handler', 'launcher', 'child', 'actions'].map((name) => ({
      id: 'app.ts#' + name,
      name,
      file: 'app.ts',
      line: 1,
      tokens: 1,
      kind: name === 'actions' ? ('binding' as const) : ('production' as const),
    })),
    actions: { live: 'app.ts#handler' },
    registry: 'app.ts#actions',
    problems: [],
    relationships: [
      {
        from: 'app.ts#handler',
        to: 'app.ts#launcher',
        kind: 'reference',
        runtime: false,
        origin: 'static',
        sourceRef: { file: 'app.ts', line: 1 },
      },
      {
        from: 'app.ts#launcher',
        to: 'app.ts#child',
        kind: 'entry-point',
        origin: 'static',
        sourceRef: { file: 'app.ts', line: 1 },
      },
    ],
  }
  const snapshot = buildSnapshot(
    'type-child',
    compileContracts([{ file: 'live.feature', text: feature }]),
    source,
  )
  assert.ok(snapshot.ancestry['app.ts#launcher']?.length)
  assert.ok(snapshot.unrooted.includes('app.ts#child'))
})

test('a fixed child entry containing only an import reaches imported startup', () => {
  const project = createProject({
    'package.json': '{"type":"module"}',
    'bindings.ts': "import {live} from './app.ts'\nexport const actions={live:live}\n",
    'app.ts':
      "import {spawnSync} from 'node:child_process'\nimport {fileURLToPath} from 'node:url'\nexport function live(){ const child=spawnSync(process.execPath,[fileURLToPath(new URL('./entry.ts',import.meta.url))],{encoding:'utf8'}); if(child.status!==0)throw new Error(child.stderr); return {status:'ready'} }\n",
    'entry.ts': "import './boot.ts'\n",
    'boot.ts':
      "import {writeFileSync} from 'node:fs'\nwriteFileSync(new URL('./child-started',import.meta.url),'started')\n",
    'live.feature': feature,
  })
  try {
    const inspection = runCli(['explain', 'boot.ts', '--root', project.root, '--json'])
    assert.equal(inspection.status, 0, inspection.stderr || inspection.stdout)
    assert.equal(existsSync(join(project.root, 'child-started')), false)
    const result = runCli(['check', '--root', project.root, '--json'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.snapshot.evidence.complete, true)
    assert.deepEqual(report.snapshot.unrooted, [])
    assert.equal(existsSync(join(project.root, 'child-started')), true)
  } finally {
    project.dispose()
  }
})

test('explain preserves production eligibility when a shorter test bridge exists', () => {
  const source: Source = {
    files: [
      { file: 'app.ts', tokens: 5 },
      { file: 'support.test.ts', tokens: 1 },
    ],
    components: [
      ...['actions', 'handler', 'bridge', 'middle', 'startup'].map((name) => ({
        file: 'app.ts',
        line: 1,
        id: 'app.ts#' + name,
        name,
        tokens: 1,
        kind: name === 'actions' ? ('binding' as const) : ('production' as const),
      })),
      {
        file: 'support.test.ts',
        line: 1,
        id: 'support.test.ts#test',
        name: 'test',
        tokens: 1,
        kind: 'test',
      },
    ],
    registry: 'app.ts#actions',
    actions: { live: 'app.ts#handler' },
    problems: [],
    relationships: [
      {
        from: 'app.ts#handler',
        to: 'support.test.ts#test',
        kind: 'reference',
        origin: 'static',
        sourceRef: { file: 'app.ts', line: 1 },
      },
      {
        from: 'support.test.ts#test',
        to: 'app.ts#startup',
        kind: 'reference',
        origin: 'static',
        sourceRef: { file: 'support.test.ts', line: 1 },
      },
      {
        from: 'app.ts#actions',
        to: 'app.ts#bridge',
        kind: 'module-initialization',
        origin: 'static',
        sourceRef: { file: 'app.ts', line: 1 },
      },
      {
        from: 'app.ts#bridge',
        to: 'app.ts#middle',
        kind: 'module-initialization',
        origin: 'static',
        sourceRef: { file: 'app.ts', line: 1 },
      },
      {
        from: 'app.ts#middle',
        to: 'app.ts#startup',
        kind: 'module-initialization',
        origin: 'static',
        sourceRef: { file: 'app.ts', line: 1 },
      },
    ],
  }
  const snapshot = buildSnapshot(
    'explain-test-lock',
    compileContracts([{ file: 'live.feature', text: feature }]),
    source,
  )
  assert.ok(snapshot.ancestry['app.ts#startup']?.length)
  assert.deepEqual(
    explain(snapshot, 'app.ts#startup')[0]!.contractPaths.map((path) => path.components),
    [['app.ts#actions', 'app.ts#bridge', 'app.ts#middle', 'app.ts#startup']],
  )
})
