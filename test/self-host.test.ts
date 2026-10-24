import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileContracts } from '../src/contracts.ts'
import { readConfig } from '../src/project.ts'
import { inventory } from '../src/source.ts'
import type { Config, Decision, Snapshot } from '../src/model.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))

function contracts() {
  return compileContracts(
    readdirSync(new URL('../features/', import.meta.url))
      .filter((file) => file.endsWith('.feature'))
      .sort()
      .map((file) => ({
        file: `features/${file}`,
        text: readFileSync(new URL(`../features/${file}`, import.meta.url), 'utf8'),
      })),
  )
}

function check(root: string, config?: Config, engine: 'typescript' | 'rust' = 'typescript') {
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, 'src/cli.ts'),
      'check',
      '--root',
      root,
      ...(config ? ['--policy', '-'] : []),
      '--json',
      '--engine',
      engine,
    ],
    {
      cwd: root,
      input: config ? JSON.stringify(config) : undefined,
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
  return { ...result, ...report }
}

function recognizedBindings(candidate: Snapshot, bindings: string) {
  assert.equal(candidate.source.bindingImports?.length, 1)
  assert.equal(candidate.source.bindingImports[0]!.from, 'src/evidence.ts#collectEvidence')
  assert.equal(candidate.source.bindingImports[0]!.file, 'src/evidence.ts')
  assert.equal(candidate.source.bindingImports[0]!.bindings, bindings)
}

test('the native root gate verifies its full committed inventory within the saved feedback policy', {
  timeout: 30000,
}, () => {
  const config = readConfig(repository)
  const files = inventory(repository, config.maintained, config.exclude)
  assert.ok(
    !files.some((file) => file.endsWith('.rs')),
    'The obsolete collector must be removed, not excluded',
  )
  const report = check(repository, undefined, 'rust')
  assert.equal(report.status, 1, report.stderr)
  assert.equal(report.decision.status, 'reject')
  assert.deepEqual(
    report.snapshot.source.files.map((file) => file.file),
    files,
  )
  assert.deepEqual(report.snapshot.source.problems, [], report.stderr)
  recognizedBindings(report.snapshot, config.bindings)
  assert.deepEqual(report.snapshot.contracts, contracts())
  assert.equal(report.snapshot.analysis?.backend, 'tsrs')
  assert.equal(report.snapshot.analysis?.status, 'complete')
  const evidence = report.snapshot.evidence
  assert.ok(evidence, report.stderr)
  assert.equal(evidence.complete, true)
  assert.deepEqual(
    evidence.checks.filter((check) => check.status !== 'passed'),
    [],
  )
  assert.equal(evidence.checks.length, contracts().checks.length)
  assert.equal(report.snapshot.timing?.feedback?.limitMs, config.policy.maxFeedbackMs)
  assert.ok(evidence.elapsedMs <= config.policy.maxFeedbackMs)
  assert.ok(
    report.decision.requiredReduction > 0,
    'Passing behavior must not erase the retained-size overage',
  )
})

test('the reference TypeScript implementation fulfills every feature through the real CLI', {
  timeout: 90000,
}, () => {
  const required = contracts()
  assert.deepEqual(required.problems, [])
  assert.ok(required.cases.length >= 10)
  assert.ok(required.checks.length > required.pairs.length)
  const config = readConfig(repository)
  // The reference uses the same complete inventory, copied for archive/loader coverage.
  const files = inventory(repository, config.maintained, config.exclude)
  const work = resolve(repository, 'work')
  mkdirSync(work, { recursive: true })
  const root = mkdtempSync(resolve(work, 'typescript-self-host-'))
  try {
    for (const file of files) {
      const target = resolve(root, file)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(resolve(repository, file), target)
    }
    const scoped = { ...config, maintained: files }
    writeFileSync(resolve(root, 'bonsai.json'), JSON.stringify(scoped))
    // Only the fixture's execution window changes; budget rules stay committed values.
    const executionConfig = { ...scoped, policy: { ...scoped.policy, maxFeedbackMs: 60000 } }
    const report = check(root, executionConfig)
    assert.deepEqual(report.snapshot.source.problems, [], report.stderr)
    recognizedBindings(report.snapshot, config.bindings)
    assert.deepEqual(report.snapshot.contracts, required)
    assert.deepEqual(
      report.snapshot.source.files.map((file) => file.file),
      files,
      'The reference fixture must analyze the complete committed scope',
    )
    const evidence = report.snapshot.evidence
    assert.ok(evidence, report.stderr)
    assert.equal(evidence.complete, true)
    assert.equal(evidence.fingerprint, report.snapshot.fingerprint)
    assert.deepEqual(evidence.bindingImport, {
      adapter: 'project-bindings-v1',
      file: config.bindings,
      fingerprint: report.snapshot.fingerprint,
    })
    assert.deepEqual(
      evidence.checks.map((check) => check.id).sort(),
      required.checks.map((check) => check.id).sort(),
      'Every declared observation must have exactly one execution result',
    )
    assert.deepEqual(
      evidence.checks.filter((check) => check.status !== 'passed'),
      [],
    )
    assert.equal(report.status, 1, report.stderr)
    assert.equal(report.decision.status, 'reject')
    assert.ok(report.decision.requiredReduction > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
