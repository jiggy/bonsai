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
import type { CheckTiming, Config, Decision, Snapshot } from '../src/model.ts'

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

function check(root: string) {
  const result = spawnSync(
    process.execPath,
    [resolve(root, 'src/cli.ts'), 'check', '--root', root, '--json'],
    {
      cwd: root,
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
  const report = JSON.parse(result.stdout) as {
    snapshot: Snapshot
    decision: Decision
    timing: CheckTiming
  }
  return { ...result, ...report }
}

function fulfilled(
  report: ReturnType<typeof check>,
  config: Config,
  files: string[],
  required: ReturnType<typeof contracts>,
) {
  const candidate = report.snapshot
  assert.equal(report.status, 1, report.stderr)
  assert.equal(report.decision.status, 'reject')
  assert.deepEqual(
    candidate.source.files.map((file) => file.file),
    files,
  )
  assert.deepEqual(candidate.source.problems, [], report.stderr)
  assert.deepEqual(
    candidate.unrooted.filter((id) => id.startsWith('src/')),
    [],
    'Every implementation component needs contract ancestry',
  )
  assert.deepEqual(candidate.contracts, required)
  assert.equal(candidate.source.bindingImports?.length, 1)
  assert.equal(candidate.source.bindingImports[0]!.from, 'src/evidence.ts#collectEvidence')
  assert.equal(candidate.source.bindingImports[0]!.file, 'src/evidence.ts')
  assert.equal(candidate.source.bindingImports[0]!.bindings, config.bindings)
  for (const [from, file] of [
    ['src/self-host.ts#invoke', 'src/cli.ts'],
    ['src/evidence.ts#forkEvidence', 'src/worker.ts'],
    ['src/native-session.ts#spawnNativeWorker', 'src/tsrs-worker.ts'],
  ] as const) {
    const entry = candidate.source.components
      .filter((component) => component.file === file && component.name.startsWith('<top-level:'))
      .at(-1)
    assert.ok(entry, `Missing executable entry point: ${file}`)
    assert.ok(
      candidate.source.relationships.some(
        (edge) =>
          edge.from === from &&
          edge.to === entry.id &&
          edge.kind === 'entry-point' &&
          edge.origin === 'static' &&
          edge.sourceRef.file === from.split('#')[0],
      ),
      `Missing subprocess ancestry: ${from} → ${entry.id}`,
    )
    assert.ok(candidate.ancestry[entry.id]?.length, `Unrooted executable entry point: ${entry.id}`)
  }
  const evidence = candidate.evidence
  assert.ok(evidence, report.stderr)
  assert.deepEqual(candidate.verification, config.verification)
  assert.equal(evidence.profile, config.verification?.profile ?? 'in-process-v1')
  assert.equal(evidence.complete, true)
  assert.equal(evidence.fingerprint, candidate.fingerprint)
  assert.deepEqual(evidence.bindingImport, {
    adapter: 'project-bindings-v1',
    file: config.bindings,
    fingerprint: candidate.fingerprint,
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
  assert.equal(candidate.timing?.feedback?.limitMs, config.policy.maxFeedbackMs)
  assert.ok(evidence.elapsedMs <= config.policy.maxFeedbackMs)
  assert.ok(
    report.decision.requiredReduction > 0,
    'Passing behavior must not erase the retained-size overage',
  )
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
  const report = check(repository)
  const reportPath = process.env.BONSAI_SELF_CHECK_REPORT
  if (reportPath)
    writeFileSync(
      reportPath,
      JSON.stringify(
        { decision: report.decision, snapshot: report.snapshot, timing: report.timing },
        null,
        2,
      ) + '\n',
    )
  fulfilled(report, config, files, contracts())
  assert.equal(report.snapshot.analysis?.backend, 'tsrs')
  assert.equal(report.snapshot.analysis?.status, 'complete')
})

test('the native checker fulfills every feature from a complete archived project', {
  timeout: 30000,
}, () => {
  const required = contracts()
  assert.deepEqual(required.problems, [])
  assert.ok(required.cases.length >= 10)
  assert.ok(required.checks.length > required.pairs.length)
  const config = readConfig(repository)
  // Copy the same complete inventory for archive and loader coverage.
  const files = inventory(repository, config.maintained, config.exclude)
  const work = resolve(repository, 'work')
  mkdirSync(work, { recursive: true })
  const root = mkdtempSync(resolve(work, 'native-self-host-'))
  try {
    for (const file of files) {
      const target = resolve(root, file)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(resolve(repository, file), target)
    }
    const scoped = { ...config, maintained: files }
    writeFileSync(resolve(root, 'bonsai.json'), JSON.stringify(scoped))
    const report = check(root)
    fulfilled(report, scoped, files, required)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
