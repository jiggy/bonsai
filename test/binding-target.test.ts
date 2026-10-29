import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectBindingTarget } from '../src/binding-target.ts'
import { compileContracts } from '../src/contracts.ts'
import { collectEvidence } from '../src/evidence.ts'
import type { Config, Snapshot } from '../src/model.ts'
import { evaluate } from '../src/policy.ts'
import { snapshot } from '../src/project.ts'
import { fingerprint, inventory } from '../src/source.ts'
import { analyzeSource } from './reference.ts'

function fixture() {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/binding-target-'))
  const marker = join(root, 'handler-executed')
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  writeFileSync(
    join(root, 'handler.ts'),
    `import { writeFileSync } from 'node:fs'
export function handle() {
  writeFileSync(${JSON.stringify(marker)}, 'executed')
  return { status: 'ok' }
}
`,
  )
  writeFileSync(
    join(root, 'bindings.ts'),
    "import { handle } from './handler.ts'\nexport const actions = { 'handle': handle }\n",
  )
  const text =
    'Feature: Binding\nScenario: Handle\n When I invoke "handle" with {}\n Then response "status" equals "ok"\n'
  writeFileSync(join(root, 'binding.feature'), text)
  const contracts = compileContracts([{ file: 'binding.feature', text }])
  const config: Config = {
    maintained: ['package.json', 'handler.ts', 'bindings.ts', 'binding.feature'],
    bindings: 'bindings.ts',
    policy: {
      bootstrap: 1000,
      bootstrapSurface: 1,
      perDoubling: 0,
      hardLimit: 1000,
      maxFeedbackMs: 15000,
    },
  }
  const hash = () => fingerprint(root, inventory(root, config.maintained, config.exclude), config)
  return {
    root,
    marker,
    config,
    contracts,
    hash,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('the binding target loads only its measured registry and reports its snapshot identity', async () => {
  const { root, marker, config, contracts, hash, dispose } = fixture()
  try {
    const identity = hash()
    const target = projectBindingTarget(root, config, identity)
    assert.equal(Object.isFrozen(target), true)
    assert.equal(
      target.url,
      pathToFileURL(join(root, config.bindings)).href + `?snapshot=${identity}`,
    )
    assert.equal(existsSync(marker), false, 'Resolving a target must not execute candidate code')
    const evidence = await collectEvidence(root, config, contracts, identity)
    assert.equal(existsSync(marker), true)
    assert.deepEqual(evidence.bindingImport, {
      adapter: 'project-bindings-v1',
      file: config.bindings,
      fingerprint: identity,
    })
    assert.equal(evidence.complete, true)
    assert.ok(evidence.checks.every((check) => check.status === 'passed'))
  } finally {
    dispose()
  }
})

test('unmeasured, escaped, symlinked, and stale binding targets stop before candidate execution', async () => {
  const { root, marker, config, contracts, hash, dispose } = fixture()
  try {
    const identity = hash()
    for (const invalid of [
      { ...config, maintained: config.maintained.filter((file) => file !== config.bindings) },
      { ...config, exclude: ['bindings.ts'] },
      { ...config, bindings: 'missing.ts' },
      { ...config, maintained: ['../outside.ts'], bindings: '../outside.ts' },
    ]) {
      await assert.rejects(
        collectEvidence(root, invalid, contracts, identity),
        /inventory|escapes root/,
      )
      assert.equal(existsSync(marker), false)
    }
    symlinkSync(join(root, 'bindings.ts'), join(root, 'linked.ts'))
    await assert.rejects(
      collectEvidence(
        root,
        { ...config, maintained: [...config.maintained, 'linked.ts'] },
        contracts,
        identity,
      ),
      /Symlinks are unsupported/,
    )
    writeFileSync(join(root, 'package.json'), '{"type":"module","changed":true}')
    await assert.rejects(
      collectEvidence(root, config, contracts, identity),
      /changed before binding import/,
    )
    assert.equal(existsSync(marker), false)
  } finally {
    dispose()
  }
})

test('a lookalike binding-target handle cannot admit an ordinary computed import', async () => {
  const { root, marker, config, dispose } = fixture()
  try {
    writeFileSync(
      join(root, 'handler.ts'),
      `import { writeFileSync } from 'node:fs'
function projectBindingTarget() { return Object.freeze({ url: './module.ts' }) }
export async function handle() {
  writeFileSync(${JSON.stringify(marker)}, 'executed')
  const target = projectBindingTarget()
  return (await import(target.url)).handle()
}
`,
    )
    writeFileSync(join(root, 'module.ts'), "export function handle() { return { status: 'ok' } }\n")
    config.maintained.push('module.ts')
    const candidate = await snapshot(root, config)
    assert.ok(
      candidate.source.problems.some((problem) =>
        /Dynamic import requires an adapter: handler\.ts#handle.*import\(target\.url\)/.test(
          problem,
        ),
      ),
    )
    assert.equal(candidate.source.bindingImports, undefined)
    assert.equal(candidate.evidence, undefined)
    assert.equal(existsSync(marker), false)
    assert.ok(candidate.unrooted.includes('module.ts#handle'))
    assert.equal(evaluate(undefined, candidate, config.policy).status, 'incomplete')
  } finally {
    dispose()
  }
})

test('a supported loader boundary requires the matching binding import receipt', async () => {
  const { root, config, dispose } = fixture()
  try {
    const candidate = await snapshot(root, config, false)
    assert.deepEqual(candidate.source.problems, [])
    candidate.source.bindingImports = [
      {
        from: 'src/evidence.ts#collectEvidence',
        file: 'src/evidence.ts',
        line: 32,
        adapter: 'project-bindings-v1',
        bindings: config.bindings,
      },
    ]
    candidate.evidence = {
      schema: 'bonsai-evidence-v2',
      identity: candidate.identity!,
      fingerprint: candidate.fingerprint,
      profile: 'isolated-scenarios-v1',
      complete: true,
      elapsedMs: 1,
      bindingImport: {
        adapter: 'project-bindings-v1',
        file: config.bindings,
        fingerprint: candidate.fingerprint,
      },
      checks: candidate.contracts.checks.map((check) => ({ id: check.id, status: 'passed' })),
    }
    assert.equal(evaluate(undefined, candidate, config.policy).status, 'pass')
    for (const receipt of [
      undefined,
      { ...candidate.evidence.bindingImport!, file: 'other-bindings.ts' },
      { ...candidate.evidence.bindingImport!, fingerprint: 'another-snapshot' },
    ]) {
      const invalid: Snapshot = structuredClone(candidate)
      invalid.evidence!.bindingImport = receipt
      const decision = evaluate(undefined, invalid, config.policy)
      assert.equal(decision.status, 'incomplete')
      assert.ok(
        decision.violations.some((violation) =>
          violation.startsWith('Binding import evidence is missing or mismatched:'),
        ),
      )
    }
  } finally {
    dispose()
  }
})

test('the binding adapter follows unchanged implementations into archives and rejects modified copies', () => {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/binding-archive-'))
  try {
    cpSync(resolve('src'), join(root, 'src'), { recursive: true })
    cpSync(resolve('package.json'), join(root, 'package.json'))
    // Keep loader recognition independent of the development fixture layout.
    writeFileSync(
      join(root, 'bonsai.bindings.ts'),
      "import { evaluate } from './src/policy.ts'\nexport const actions = { evaluate: evaluate }\n",
    )
    const files = inventory(root, ['src', 'package.json', 'bonsai.bindings.ts'])
    const source = analyzeSource(root, files, 'bonsai.bindings.ts')
    assert.deepEqual(source.problems, [])
    const collector = readFileSync(join(root, 'src/evidence.ts'), 'utf8')
    const line = collector.slice(0, collector.indexOf('import(target.url)')).split('\n').length
    assert.deepEqual(source.bindingImports, [
      {
        from: 'src/evidence.ts#collectEvidence',
        file: 'src/evidence.ts',
        line,
        adapter: 'project-bindings-v1',
        bindings: 'bonsai.bindings.ts',
      },
    ])
    const registryTargets = new Set([source.registry, ...Object.values(source.actions)])
    assert.equal(
      source.relationships.some(
        (edge) => edge.from === 'src/evidence.ts#collectEvidence' && registryTargets.has(edge.to),
      ),
      false,
      'Recognizing a loader boundary must not grant ancestry to registry handlers',
    )

    const targetFile = join(root, 'src/binding-target.ts')
    const implementation = readFileSync(targetFile, 'utf8')
    assert.ok(implementation.includes('Object.freeze'))
    writeFileSync(targetFile, implementation.replace('Object.freeze', 'Object.seal'))
    const changed = analyzeSource(root, files, 'bonsai.bindings.ts')
    assert.equal(changed.bindingImports, undefined)
    assert.ok(
      changed.problems.some((problem) =>
        /^Dynamic import requires an adapter: src\/evidence\.ts#collectEvidence.*import\(target\.url\)/.test(
          problem,
        ),
      ),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
