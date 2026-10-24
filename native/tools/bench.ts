import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { arch, cpus, platform, release } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { CheckTiming, Decision, Snapshot } from '../../src/model.ts'
import { canonicalSource } from './client.ts'

type Engine = 'typescript' | 'rust'
type Report = { decision: Decision; snapshot: Snapshot; timing: CheckTiming }
type Sample = {
  wallMs: number
  timing: CheckTiming
  decision: Decision['status']
  requiredChecks: number
  passedChecks: number
  verificationComplete: boolean
}
type ParityMismatch = { engine: Engine; sampleIndex: number; details: string }

const executable = fileURLToPath(new URL('../../src/cli.ts', import.meta.url))

function comparable(report: Report) {
  const candidate = report.snapshot
  return {
    decision: report.decision,
    fingerprint: candidate.fingerprint,
    contracts: candidate.contracts,
    source: canonicalSource(candidate.source),
    ancestry: Object.fromEntries(
      Object.entries(candidate.ancestry)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, checks]) => [id, [...checks].sort()]),
    ),
    unrooted: [...candidate.unrooted].sort(),
    evidence: candidate.evidence ? { ...candidate.evidence, elapsedMs: 0 } : undefined,
  }
}

function check(root: string, engine: Engine) {
  const began = performance.now()
  const result = spawnSync(
    process.execPath,
    [executable, 'check', '--root', root, '--engine', engine, '--json', '--timeout', '90'],
    {
      encoding: 'utf8',
      timeout: 95000,
      maxBuffer: 64 * 1024 * 1024,
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
  const wallMs = performance.now() - began
  if (result.error) throw result.error
  if (!result.stdout.trim()) throw new Error(result.stderr || 'Check returned no gate report')
  const report = JSON.parse(result.stdout) as Report
  const expectedExit = { pass: 0, reject: 1, incomplete: 2 }[report.decision?.status]
  assert.equal(result.status, expectedExit, result.stderr)
  assert.ok(report.snapshot && report.timing, 'Check must return source facts and timing')
  const sample: Sample = {
    wallMs,
    timing: report.timing,
    decision: report.decision.status,
    requiredChecks: report.snapshot.contracts.checks.length,
    passedChecks:
      report.snapshot.evidence?.checks.filter((check) => check.status === 'passed').length ?? 0,
    verificationComplete: report.snapshot.evidence?.complete === true,
  }
  return { report, sample }
}

function summarize(samples: Sample[]) {
  const values = samples.map((sample) => sample.wallMs).sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return {
    min: values[0]!,
    median: values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2,
    max: values[values.length - 1]!,
    samples,
  }
}

/** Fresh complete CLI invocations, including verification whenever analysis permits it. */
export async function benchmark(runs = 3, root = resolve('examples/checkout')) {
  const samples: Record<Engine, Sample[]> = { typescript: [], rust: [] }
  const parityMismatches: ParityMismatch[] = []
  let reference: ReturnType<typeof comparable> | undefined
  const started = performance.now()
  for (let index = 0; index < runs; index++) {
    const engines: Engine[] = index % 2 ? ['rust', 'typescript'] : ['typescript', 'rust']
    for (const engine of engines) {
      const result = check(root, engine)
      samples[engine].push(result.sample)
      const facts = comparable(result.report)
      if (reference) {
        try {
          assert.deepEqual(facts, reference, 'Timed checks must report the same facts')
        } catch (error) {
          parityMismatches.push({
            engine,
            sampleIndex: index,
            details: error instanceof Error ? error.message : String(error),
          })
        }
      } else reference = facts
    }
  }
  const typescript = summarize(samples.typescript)
  const rust = summarize(samples.rust)
  const completedVerification = [...samples.typescript, ...samples.rust].every(
    (sample) => sample.verificationComplete,
  )
  return {
    protocol: 2,
    recordedAt: new Date().toISOString(),
    elapsedMs: performance.now() - started,
    root,
    runs,
    unit: 'milliseconds',
    scope: 'fresh CLI check, including source diagnostics and required verification when eligible',
    sourceAndDecisionParity: parityMismatches.length ? 'mismatch' : 'matched',
    parityMismatches,
    completedVerification,
    completedCheckSpeedup:
      completedVerification && !parityMismatches.length ? typescript.median / rust.median : null,
    limitations: [
      'Cold means a fresh process, without flushing operating-system filesystem caches.',
      'Engines alternate on the same root and saved policy; no policy limit is increased.',
      'External wall time includes startup, serialization, output delivery, and cleanup.',
      'Reported command and feedback timings retain their own published boundaries.',
      'Incomplete runs retain measurements but do not establish a completed-check speedup.',
      'Matching timed inputs do not establish universal TypeScript compatibility.',
    ],
    environment: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      runtime: { executable: process.execPath, bun: process.versions.bun ?? null },
    },
    measurements: { typescript, rust },
  }
}

async function main() {
  const { values } = parseArgs({
    options: { runs: { type: 'string' }, root: { type: 'string' }, output: { type: 'string' } },
    strict: true,
  })
  const runs = Number(values.runs ?? 3)
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('Use --runs 1..20')
  const report = await benchmark(runs, resolve(values.root ?? 'examples/checkout'))
  const output = JSON.stringify(report, null, 2) + '\n'
  if (values.output) writeFileSync(resolve(values.output), output)
  process.stdout.write(output)
  if (report.parityMismatches.length) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n',
    )
    process.exitCode = 1
  })
}
