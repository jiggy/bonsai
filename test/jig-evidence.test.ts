import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  jigEvidenceProblems,
  jigPackageDigest,
  validJigRouteFacts,
  validJigRouteReceipts,
  verifyJigRoutes,
  type JigRouteFact,
  type JigRouteReceipt,
} from '../src/jig-evidence.ts'
import { buildSnapshot } from '../src/retention.ts'
import { evaluate, validEvidence } from '../src/policy.ts'
import { parseSnapshot, validSnapshot } from '../src/snapshot-schema.ts'
import type { Contracts, Snapshot, Source } from '../src/model.ts'
import { assumedIdentity } from './identity-fixture.ts'

function fixture(extra: Record<string, string> = {}) {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/jig-evidence-'))
  const contents = {
    'flows/pilot/method.ts': 'export const x = 1\n',
    'flows/pilot/package.json': '{}\n',
    ...extra,
  }
  for (const [file, content] of Object.entries(contents)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), content)
  }
  const files = Object.keys(contents).filter((file) => !file.split('/').includes('node_modules'))
  const fact = (): JigRouteFact => ({
    adapter: 'jig-binding-v1',
    from: 'handler.ts#pilot',
    file: 'handler.ts',
    line: 3,
    route: 'binding:pilot',
    packagePath: 'flows/pilot',
    digest: jigPackageDigest(root, files, 'flows/pilot'),
    settings: { locale: 'en', copies: 2 },
  })
  return { root, files, fact, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

const revision = `sha256:${'1'.repeat(64)}`
const approval = `sha256:${'2'.repeat(64)}`
const inspected = (fact: JigRouteFact) => ({
  state: 'environment-matches',
  revision,
  approval,
  target: fact.route,
  availability: { state: 'ready' },
  package: fact.packagePath,
  digest: fact.digest,
  settings: fact.settings,
  slots: {},
  attachments: {},
  artifactResults: [],
  boundReadAttachments: [],
})

function command(project: ReturnType<typeof fixture>, script?: string) {
  const bin = join(project.root, 'bin')
  mkdirSync(bin)
  const interpreter = isAbsolute(process.execPath)
    ? process.execPath
    : `/usr/bin/env ${process.execPath}`
  writeFileSync(
    join(bin, 'jig'),
    `#!${interpreter}\n` +
      (script ??
        `
import { appendFileSync, readFileSync } from 'node:fs'
appendFileSync('inspected', JSON.stringify(process.argv.slice(2)) + '\\n')
process.stdout.write(readFileSync('inspection.json'))
`),
  )
  chmodSync(join(bin, 'jig'), 0o755)
  const previous = process.env.PATH
  process.env.PATH = `${bin}:${previous ?? ''}`
  return () => {
    process.env.PATH = previous
  }
}

test('Jig package digest matches FLOW-Package/0 framing and ignores only node_modules', () => {
  const project = fixture({ 'flows/pilot/node_modules/unmeasured/index.js': 'ignored' })
  try {
    assert.equal(
      jigPackageDigest(project.root, project.files, 'flows/pilot'),
      'sha256:711c224387ca3d27c78b32bc1a6f76893fa18b4a65fc892f0c9671a72d1f2271',
    )
    assert.equal(
      jigPackageDigest(project.root, [...project.files].reverse(), 'flows/pilot'),
      project.fact().digest,
    )
    writeFileSync(join(project.root, 'flows/pilot/method.ts'), 'export const x = 2\n')
    assert.notEqual(
      project.fact().digest,
      'sha256:711c224387ca3d27c78b32bc1a6f76893fa18b4a65fc892f0c9671a72d1f2271',
    )
    writeFileSync(join(project.root, 'flows/pilot/data.json'), '{}')
    assert.throws(() => project.fact(), /outside maintained inventory: flows\/pilot\/data.json/)
    project.files.push('flows/pilot/data.json')
    assert.doesNotThrow(() => project.fact())
  } finally {
    project.dispose()
  }
})

test('Jig package digest rejects symlinks, unsupported paths and case collisions', () => {
  for (const name of ['Method.ts', 'caf\u00e9.txt']) {
    const project = fixture({ [`flows/pilot/${name}`]: 'extra' })
    try {
      assert.throws(() => project.fact(), /Case-colliding|ASCII slash path/)
    } finally {
      project.dispose()
    }
  }
  const project = fixture()
  try {
    symlinkSync('method.ts', join(project.root, 'flows/pilot/link.ts'))
    project.files.push('flows/pilot/link.ts')
    assert.throws(() => project.fact(), /Symlinked/)
    assert.throws(
      () => jigPackageDigest(project.root, project.files, '../pilot'),
      /Invalid selected/,
    )
  } finally {
    project.dispose()
  }
})

test('Jig evidence requires the exact complete selection and one stable approved revision', () => {
  const project = fixture()
  try {
    const fact = project.fact()
    const receipt: JigRouteReceipt = { ...fact, revision, approval }
    assert.equal(validJigRouteFacts([fact]), true)
    assert.equal(validJigRouteReceipts([receipt]), true)
    assert.deepEqual(jigEvidenceProblems([fact], [receipt]), [])
    assert.deepEqual(jigEvidenceProblems(undefined, undefined), [])
    for (const malformed of [
      { ...fact, digest: 'old' },
      { ...fact, line: 0 },
      { ...fact, packagePath: '../flow' },
      { ...fact, route: 'flow:flows/pilot' },
      { ...fact, settings: { copies: Infinity } },
      { ...fact, extra: true },
      { ...fact, settings: JSON.parse('{"__proto__":{}}') },
    ])
      assert.equal(validJigRouteFacts([malformed]), false)
    assert.equal(validJigRouteReceipts([{ ...receipt, approval: '' }]), false)
    assert.equal(validJigRouteReceipts([receipt, { ...receipt, revision: approval }]), false)
    for (const changed of [
      { ...receipt, digest: approval },
      { ...receipt, line: 4 },
      { ...receipt, from: 'handler.ts#other' },
      { ...receipt, settings: { locale: 'fr', copies: 2 } },
    ])
      assert.ok(jigEvidenceProblems([fact], [changed]).some((problem) => /Missing/.test(problem)))
    assert.ok(jigEvidenceProblems([fact], []).some((problem) => /Missing/.test(problem)))
    assert.deepEqual(jigEvidenceProblems([], [receipt]), ['Unexpected Jig approval evidence'])
    assert.deepEqual(jigEvidenceProblems([fact], [receipt, receipt]), [
      'Unexpected Jig approval evidence',
    ])
  } finally {
    project.dispose()
  }
})

test('Jig verification reads approval without running or reviewing the application and preserves it after evidence', async () => {
  const project = fixture()
  const restore = command(project)
  try {
    const fact = project.fact()
    writeFileSync(join(project.root, 'inspection.json'), JSON.stringify(inspected(fact)))
    const facts = [fact, { ...fact, line: 9 }]
    const before = await verifyJigRoutes(project.root, project.files, facts, { timeoutMs: 5000 })
    assert.deepEqual(
      before,
      facts.map((entry) => ({ ...entry, revision, approval })),
    )
    const after = await verifyJigRoutes(
      project.root,
      project.files,
      facts,
      { timeoutMs: 5000 },
      before,
    )
    assert.deepEqual(after, before)
    assert.deepEqual(
      readFileSync(join(project.root, 'inspected'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
      [
        ['inspect', 'binding:pilot', '--json'],
        ['inspect', 'binding:pilot', '--json'],
      ],
    )
    assert.deepEqual(
      await verifyJigRoutes(project.root, project.files, [], { timeoutMs: 5000 }),
      [],
    )
  } finally {
    restore()
    project.dispose()
  }
})

const policy = {
  bootstrap: 1000,
  bootstrapSurface: 1,
  perDoubling: 0,
  hardLimit: 1000,
  maxFeedbackMs: 15000,
}
const required: JigRouteFact = {
  adapter: 'jig-binding-v1',
  from: 'handler.ts#pilot',
  file: 'handler.ts',
  line: 3,
  route: 'binding:pilot',
  packagePath: 'flows/pilot',
  digest: revision,
  settings: {},
}
const contracts: Contracts = {
  checks: [
    {
      id: 'pilot.feature:3',
      file: 'pilot.feature',
      line: 3,
      action: 'pilot',
      selector: 'status',
      expected: 'ready',
    },
  ],
  pairs: ['pilot:status'],
  cases: [],
  problems: [],
}

function candidate(): Snapshot {
  const source: Source = {
    files: [
      { file: 'handler.ts', tokens: 1 },
      { file: 'flows/pilot/FLOW.ts', tokens: 1 },
    ],
    components: [
      {
        id: 'handler.ts#pilot',
        file: 'handler.ts',
        line: 1,
        name: 'pilot',
        kind: 'production',
        tokens: 1,
      },
      {
        id: 'flows/pilot/FLOW.ts#entry',
        file: 'flows/pilot/FLOW.ts',
        line: 1,
        name: 'entry',
        kind: 'production',
        tokens: 1,
      },
    ],
    relationships: [
      {
        from: 'handler.ts#pilot',
        to: 'flows/pilot/FLOW.ts#entry',
        kind: 'entry-point',
        origin: 'static',
        sourceRef: { file: 'handler.ts', line: 3 },
      },
    ],
    actions: { pilot: 'handler.ts#pilot' },
    jigRoutes: [structuredClone(required)],
    problems: [],
  }
  const snapshot = buildSnapshot('fixture', contracts, source)
  snapshot.identity = structuredClone(assumedIdentity)
  snapshot.evidence = {
    schema: 'bonsai-evidence-v2',
    identity: structuredClone(assumedIdentity),
    fingerprint: 'fixture',
    profile: 'isolated-scenarios-v1',
    complete: true,
    elapsedMs: 1,
    checks: contracts.checks.map(({ id }) => ({ id, status: 'passed' })),
    jigRoutes: [{ ...structuredClone(required), revision, approval }],
  }
  return snapshot
}

test('Jig policy rejects missing or mismatched route receipts and omitted required selections', () => {
  const baseline = evaluate(undefined, candidate(), policy)
  assert.equal(baseline.status, 'pass')
  for (const change of [
    (snapshot: Snapshot) => {
      delete snapshot.evidence!.jigRoutes
    },
    (snapshot: Snapshot) => {
      snapshot.evidence!.jigRoutes = []
    },
    (snapshot: Snapshot) => {
      snapshot.evidence!.jigRoutes![0]!.digest = approval
    },
    (snapshot: Snapshot) => {
      snapshot.evidence!.jigRoutes![0]!.settings = { copies: 2 }
    },
    (snapshot: Snapshot) => {
      snapshot.evidence!.jigRoutes!.push(snapshot.evidence!.jigRoutes![0]!)
    },
    (snapshot: Snapshot) => {
      delete snapshot.jigRouteRequirements
    },
    (snapshot: Snapshot) => {
      snapshot.jigRouteRequirements = []
      delete snapshot.evidence!.jigRoutes
    },
    (snapshot: Snapshot) => {
      snapshot.jigRouteRequirements![0] = {
        ...snapshot.jigRouteRequirements![0]!,
        digest: approval,
      }
      snapshot.evidence!.jigRoutes![0]!.digest = approval
    },
  ]) {
    const snapshot = candidate()
    change(snapshot)
    const decision = evaluate(undefined, snapshot, policy)
    assert.equal(decision.status, 'incomplete', String(change))
    assert.equal(decision.surface, baseline.surface)
    assert.equal(decision.retained, baseline.retained)
    assert.equal(decision.ceiling, baseline.ceiling)
  }
})

test('Jig schema validates source selections and evidence without requiring runtime evidence for explain', () => {
  const snapshot = candidate()
  assert.equal(validSnapshot(snapshot), true)
  assert.deepEqual(parseSnapshot(JSON.stringify(snapshot)), JSON.parse(JSON.stringify(snapshot)))
  delete snapshot.evidence
  assert.equal(validSnapshot(snapshot), true)
  for (const change of [
    (snapshot: Snapshot) => {
      snapshot.source.jigRoutes![0]!.digest = 'invalid'
    },
    (snapshot: Snapshot) => {
      snapshot.jigRouteRequirements![0]!.line = 0
    },
    (snapshot: Snapshot) => {
      snapshot.evidence!.jigRoutes![0]!.approval = 'invalid'
    },
  ]) {
    const value = candidate()
    change(value)
    assert.equal(validSnapshot(value), false)
    assert.throws(() => parseSnapshot(JSON.stringify(value)), /snapshot schema/)
  }
  const evidence = candidate().evidence!
  evidence.jigRoutes![0]!.revision = 'unsupported'
  assert.equal(validEvidence(evidence), false)
})

test('Jig requirements follow runtime production routes without type-only or supporting-test activation', () => {
  for (const kind of [
    'dormant',
    'type-only',
    'supporting-test',
    'runtime',
    'registry-initialization',
  ] as const) {
    const snapshot = candidate()
    const source = snapshot.source
    source.actions.pilot = 'handler.ts#active'
    source.components.push({
      id: 'handler.ts#active',
      file: 'handler.ts',
      line: 8,
      name: 'active',
      kind: 'production',
      tokens: 1,
    })
    if (kind !== 'dormant') {
      const reference = {
        from: 'handler.ts#active',
        to: required.from,
        kind: 'reference' as const,
        origin: 'static' as const,
        sourceRef: { file: 'handler.ts', line: 8 },
      }
      if (kind === 'type-only') source.relationships.push({ ...reference, runtime: false })
      else if (kind === 'supporting-test') {
        source.components.push({
          id: 'helper.test.ts#support',
          file: 'helper.test.ts',
          line: 1,
          name: 'support',
          kind: 'test',
          tokens: 1,
        })
        source.relationships.push(
          { ...reference, to: 'helper.test.ts#support' },
          { ...reference, from: 'helper.test.ts#support' },
        )
      } else if (kind === 'registry-initialization') {
        source.registry = 'bindings.ts#actions'
        source.components.push({
          id: source.registry,
          file: 'bindings.ts',
          line: 1,
          name: 'actions',
          kind: 'binding',
          tokens: 1,
        })
        source.relationships.push({
          ...reference,
          from: source.registry,
          kind: 'module-initialization',
        })
      } else source.relationships.push(reference)
    }
    const rebuilt = buildSnapshot('fixture', contracts, source)
    const active = kind === 'runtime' || kind === 'registry-initialization'
    assert.deepEqual(rebuilt.jigRouteRequirements, active ? [required] : [], kind)
    if (kind === 'type-only') {
      assert.equal(rebuilt.ancestry[required.from]?.length, 1)
      assert.equal(rebuilt.ancestry['flows/pilot/FLOW.ts#entry'], undefined)
      source.relationships.push({
        from: 'handler.ts#active',
        to: required.from,
        kind: 'reference',
        origin: 'static',
        sourceRef: { file: 'handler.ts', line: 9 },
      })
      assert.deepEqual(buildSnapshot('fixture', contracts, source).jigRouteRequirements, [required])
    }
  }
})

test('Jig verification blocks stale approvals, changed source and unverified or redirected selections', async () => {
  const project = fixture()
  const restore = command(project)
  try {
    const fact = project.fact()
    const original = inspected(fact)
    for (const replacement of [
      { ...original, digest: approval },
      { ...original, package: 'flows/other' },
      { ...original, target: 'binding:other' },
      { ...original, settings: { copies: 3, locale: 'en' } },
      { ...original, slots: { child: 'binding:other' } },
      { ...original, attachments: { file: 'read' } },
      { ...original, artifactResults: ['file'] },
      { ...original, boundReadAttachments: ['file'] },
      { ...original, entrypoint: 'binding:other' },
      { ...original, agentOverride: {} },
      { ...original, state: 'unchecked' },
      { ...original, state: 'review-required' },
      { ...original, availability: { state: 'unavailable' } },
      { state: 'unreviewed', targets: [] },
    ]) {
      writeFileSync(join(project.root, 'inspection.json'), JSON.stringify(replacement))
      await assert.rejects(
        verifyJigRoutes(project.root, project.files, [fact], { timeoutMs: 5000 }),
        /Jig (approval does not match|route .* needs)/,
      )
    }
    writeFileSync(join(project.root, 'inspection.json'), JSON.stringify(original))
    writeFileSync(join(project.root, 'flows/pilot/method.ts'), 'export const x = 2\n')
    await assert.rejects(
      verifyJigRoutes(project.root, project.files, [fact], { timeoutMs: 5000 }),
      /changed after analysis/,
    )
    await assert.rejects(
      verifyJigRoutes(project.root, project.files, [project.fact()], { timeoutMs: 5000 }),
      /does not match current source/,
    )
  } finally {
    restore()
    project.dispose()
  }
})

test('Jig verification rejects approval changes between preflight and completed evidence', async () => {
  const project = fixture()
  const restore = command(project)
  try {
    const fact = project.fact()
    writeFileSync(join(project.root, 'inspection.json'), JSON.stringify(inspected(fact)))
    const prior = await verifyJigRoutes(project.root, project.files, [fact], { timeoutMs: 5000 })
    for (const update of [{ revision: approval }, { approval: revision }]) {
      writeFileSync(
        join(project.root, 'inspection.json'),
        JSON.stringify({ ...inspected(fact), ...update }),
      )
      await assert.rejects(
        verifyJigRoutes(project.root, project.files, [fact], { timeoutMs: 5000 }, prior),
        /changed during application verification/,
      )
    }
    await assert.rejects(
      verifyJigRoutes(project.root, project.files, [fact], { timeoutMs: 5000 }, []),
      /Missing/,
    )
  } finally {
    restore()
    project.dispose()
  }
})

test('Jig inspection rejects malformed, failing and excessive command output', async () => {
  for (const [script, expected] of [
    ['process.stdout.write("not JSON")', /Invalid Jig inspection JSON/],
    ['process.stderr.write("failure\\u001b"); process.exit(2)', /Jig inspection failed/],
    ['process.stdout.write("x".repeat(17 * 1024 * 1024))', /16 MiB/],
  ] as const) {
    const project = fixture()
    const restore = command(project, script)
    try {
      await assert.rejects(
        verifyJigRoutes(project.root, project.files, [project.fact()], { timeoutMs: 5000 }),
        expected,
      )
    } finally {
      restore()
      project.dispose()
    }
  }
})

test('Jig inspection shares its deadline and cancels descendants without waiting for inherited output', async () => {
  const project = fixture()
  const restore = command(
    project,
    `
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: ['ignore', 'inherit', 'inherit'] })
writeFileSync('started', 'yes')
setTimeout(() => {}, 60000)
`,
  )
  try {
    const began = performance.now()
    await assert.rejects(
      verifyJigRoutes(project.root, project.files, [project.fact()], { timeoutMs: 350 }),
      /deadline expired/,
    )
    assert.ok(performance.now() - began < 3000)
    assert.equal(existsSync(join(project.root, 'started')), true)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      verifyJigRoutes(project.root, project.files, [project.fact()], {
        timeoutMs: 5000,
        signal: controller.signal,
      }),
      /cancelled/,
    )
    await assert.rejects(
      verifyJigRoutes(project.root, project.files, [project.fact()], { timeoutMs: 0 }),
      /deadline expired/,
    )
  } finally {
    restore()
    project.dispose()
  }
})
