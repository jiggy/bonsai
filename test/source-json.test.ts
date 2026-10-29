import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config, Snapshot } from '../src/model.ts'
import { evaluate } from '../src/policy.ts'
import { snapshot } from '../src/project.ts'
import { countTokens } from '../src/source.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-source-json-'))
  const manifest = JSON.stringify({ type: 'module', version: '1.2.3' })
  writeFileSync(join(root, 'package.json'), manifest)
  writeFileSync(
    join(root, 'metadata.ts'),
    "import manifest from './package.json' with { type: 'json' }\nexport function readVersion() { return { value: manifest.version } }\n",
  )
  writeFileSync(
    join(root, 'bindings.ts'),
    "import { readVersion } from './metadata.ts'\nexport const actions = { 'read-version': readVersion }\n",
  )
  writeFileSync(
    join(root, 'metadata.feature'),
    'Feature: Metadata\nScenario: Read version\n When I invoke "read-version" with {}\n Then response "value" equals "1.2.3"\n',
  )
  const config: Config = {
    maintained: ['bindings.ts', 'metadata.ts', 'metadata.feature', 'package.json'],
    bindings: 'bindings.ts',
    policy: {
      bootstrap: 1000,
      bootstrapSurface: 1,
      perDoubling: 0,
      hardLimit: 1000,
      maxFeedbackMs: 15000,
    },
  }
  return { root, config, manifest, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

// Supply complete evidence as policy facts so missing execution cannot mask a source error.
function complete(candidate: Snapshot): Snapshot {
  return {
    ...candidate,
    evidence: {
      schema: 'bonsai-evidence-v2',
      identity: candidate.identity!,
      fingerprint: candidate.fingerprint,
      profile: 'isolated-scenarios-v1',
      complete: true,
      elapsedMs: 1,
      checks: candidate.contracts.checks.map((check) => ({ id: check.id, status: 'passed' })),
    },
  }
}

test('maintained JSON modules are measured data and participate in snapshot identity', async () => {
  const { root, config, manifest, dispose } = fixture()
  try {
    const before = await snapshot(root, config, false)
    assert.deepEqual(before.source.problems, [])
    assert.equal(before.evidence, undefined)
    assert.equal(
      before.source.files.find((file) => file.file === 'package.json')?.tokens,
      countTokens(manifest),
    )
    assert.ok(before.ancestry['metadata.ts#readVersion'].length)
    assert.equal(evaluate(undefined, complete(before), config.policy).status, 'pass')
    writeFileSync(join(root, 'package.json'), manifest.replace('1.2.3', '1.2.4'))
    const after = await snapshot(root, config, false)
    assert.deepEqual(after.source.problems, [])
    assert.notEqual(after.fingerprint, before.fingerprint)
    assert.equal(
      after.source.files.find((file) => file.file === 'package.json')?.tokens,
      countTokens(manifest),
    )
  } finally {
    dispose()
  }
})

test('unmaintained JSON imports still block an otherwise complete candidate', async () => {
  const { root, config, dispose } = fixture()
  try {
    config.maintained = config.maintained.filter((file) => file !== 'package.json')
    const candidate = await snapshot(root, config, false)
    assert.equal(
      candidate.source.files.some((file) => file.file === 'package.json'),
      false,
    )
    const decision = evaluate(undefined, complete(candidate), config.policy)
    assert.equal(decision.status, 'incomplete')
    assert.deepEqual(decision.violations, [
      'Local dependency outside maintained inventory: package.json',
    ])
  } finally {
    dispose()
  }
})

test('literal dynamic JSON imports resolve while remaining measured data', async () => {
  const { root, config, dispose } = fixture()
  try {
    writeFileSync(
      join(root, 'metadata.ts'),
      "export async function readVersion() { const manifest = await import('./package.json', { with: { type: 'json' } }); return { value: manifest.default.version } }\n",
    )
    const candidate = await snapshot(root, config, false)
    assert.deepEqual(candidate.source.problems, [])
    assert.equal(evaluate(undefined, complete(candidate), config.policy).status, 'pass')
  } finally {
    dispose()
  }
})
