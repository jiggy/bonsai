import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileContracts } from '../src/contracts.ts'
import { readConfig } from '../src/project.ts'
import { inventory } from '../src/source.ts'
import type { Decision, Snapshot } from '../src/model.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))

test('Bonsai checks its own source and fulfills every executable feature contract', {
  timeout: 90000,
}, async () => {
  const contracts = compileContracts(
    readdirSync(new URL('../features/', import.meta.url))
      .filter((file) => file.endsWith('.feature'))
      .sort()
      .map((file) => ({
        file: `features/${file}`,
        text: readFileSync(new URL(`../features/${file}`, import.meta.url), 'utf8'),
      })),
  )
  assert.deepEqual(contracts.problems, [])
  assert.ok(contracts.cases.length >= 10)
  assert.ok(contracts.checks.length > contracts.pairs.length)
  const config = readConfig(repository)
  // Allow nested CLI verification to finish in CI without changing root admission policy.
  const executionConfig = { ...config, policy: { ...config.policy, maxFeedbackMs: 60000 } }
  const result = spawnSync(
    process.execPath,
    ['src/cli.ts', 'check', '--root', repository, '--policy', '-', '--json'],
    {
      cwd: repository,
      input: JSON.stringify(executionConfig),
      encoding: 'utf8',
      timeout: 75000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        BONSAI_ROOT: undefined,
        BONSAI_BASE: undefined,
        BONSAI_POLICY: undefined,
        FORCE_COLOR: undefined,
        NO_COLOR: '1',
        CI: '1',
      },
    },
  )
  assert.equal(result.error, undefined, String(result.error))
  assert.equal(result.signal, null, result.stderr)
  const report = JSON.parse(result.stdout) as { snapshot: Snapshot; decision: Decision }
  assert.deepEqual(report.snapshot.source.problems, [], result.stderr)
  assert.equal(report.snapshot.source.bindingImports?.length, 1)
  assert.equal(report.snapshot.source.bindingImports[0]!.from, 'src/evidence.ts#collectEvidence')
  assert.equal(report.snapshot.source.bindingImports[0]!.file, 'src/evidence.ts')
  assert.equal(report.snapshot.source.bindingImports[0]!.bindings, config.bindings)
  assert.deepEqual(report.snapshot.contracts, contracts)
  assert.deepEqual(
    report.snapshot.source.files.map((file) => file.file),
    inventory(repository, config.maintained, config.exclude),
    'Self-check must analyze the entire committed maintained scope',
  )
  const evidence = report.snapshot.evidence
  assert.ok(evidence, result.stderr)
  assert.equal(evidence.complete, true)
  assert.equal(evidence.fingerprint, report.snapshot.fingerprint)
  assert.deepEqual(evidence.bindingImport, {
    adapter: 'project-bindings-v1',
    file: config.bindings,
    fingerprint: report.snapshot.fingerprint,
  })
  assert.deepEqual(
    evidence.checks.map((check) => check.id).sort(),
    contracts.checks.map((check) => check.id).sort(),
    'Every declared observation must have exactly one execution result',
  )
  assert.deepEqual(
    evidence.checks.filter((check) => check.status !== 'passed'),
    [],
  )
  // Behavior success cannot erase the repository's measured budget and ancestry violations.
  assert.equal(result.status, 1, result.stderr)
  assert.equal(report.decision.status, 'reject')
  assert.ok(report.decision.requiredReduction > 0)
})
