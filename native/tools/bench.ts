import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release } from 'node:os'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import ts from 'typescript'
import type { Source } from '../../src/model.ts'
import { binaryPath, canonicalSource } from './client.ts'
import { compareCases } from './compare.ts'
import { cases, materializeFixture, type FixtureCase } from './fixtures.ts'
import type { ReferenceRequest } from './reference.ts'

type Request = Omit<ReferenceRequest, 'mode'> & { mode?: 'full' | 'diagnostics' }
type Response = {
  protocol: number
  source?: Source
  problems?: string[]
  structuralComplete?: boolean
  typescriptDiagnostics: string
  elapsedMs: number
  error?: string
}
type Sample = { roundTripMs: number; workerMs: number }
const reference = fileURLToPath(new URL('./reference.ts', import.meta.url))

function response(text: string): Response {
  const result = JSON.parse(text) as Response
  if (result.error) throw new Error(result.error)
  if (result.protocol !== 1 || !Number.isFinite(result.elapsedMs) || result.elapsedMs < 0)
    throw new Error('Invalid benchmark worker response')
  return result
}

function cold(command: string[], request: Request) {
  const started = performance.now()
  const result = spawnSync(command[0]!, command.slice(1), {
    input: JSON.stringify(request) + '\n',
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || 'Benchmark worker failed')
  const value = response(result.stdout)
  return { value, sample: { roundTripMs: performance.now() - started, workerMs: value.elapsedMs } }
}

/** Sequential requests reuse a process, but every request reads and analyzes its files again. */
class Session {
  private readonly child
  private readonly reader
  private readonly lines
  private readonly closed: Promise<void>
  private stderr = ''
  private failure?: Error

  constructor(command: string[]) {
    this.child = spawn(command[0]!, command.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] })
    this.reader = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    this.lines = this.reader[Symbol.asyncIterator]()
    this.closed = new Promise((done) => this.child.once('close', () => done()))
    this.child.once('error', (error) => {
      this.failure = error
    })
    this.child.stdin.on('error', (error) => {
      this.failure = error
    })
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString()
    })
  }

  async request(request: Request) {
    const started = performance.now()
    const timeout = setTimeout(() => this.child.kill('SIGKILL'), 30000)
    try {
      this.child.stdin.write(JSON.stringify(request) + '\n')
      const line = await this.lines.next()
      if (line.done) throw this.failure ?? new Error(this.stderr || 'Benchmark worker closed early')
      const value = response(line.value)
      return {
        value,
        sample: { roundTripMs: performance.now() - started, workerMs: value.elapsedMs },
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async close() {
    this.child.stdin.end()
    const timeout = setTimeout(() => this.child.kill('SIGKILL'), 1000)
    try {
      await this.closed
    } finally {
      clearTimeout(timeout)
      this.reader.close()
    }
  }
}

function stats(samples: Sample[]) {
  const summarize = (values: number[]) => {
    const sorted = [...values].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    return {
      min: sorted[0],
      median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2,
      max: sorted.at(-1),
    }
  }
  return {
    count: samples.length,
    roundTripMs: summarize(samples.map((sample) => sample.roundTripMs)),
    workerMs: summarize(samples.map((sample) => sample.workerMs)),
    samples,
  }
}

function scaled(size: number): FixtureCase {
  const base = cases.find((fixture) => fixture.name === 'checkout')!
  const files: Record<string, string> = { ...base.files }
  for (let index = 0; index < size; index++) {
    files[`modules/value${index}.ts`] =
      `export function value${index}() { return ${index} }\nexport function unused${index}() { return 0 }\n`
  }
  files['handler.ts'] = [
    ...Array.from(
      { length: size },
      (_, index) => `import { value${index} } from './modules/value${index}.ts'`,
    ),
    `export function handle() { return { status: ${Array.from({ length: size }, (_, index) => `value${index}()`).join(' + ')} >= 0 ? 'ok' : 'rejected' } }`,
    '',
  ].join('\n')
  return { ...base, name: `scaled-${size}-modules`, files }
}

function validate(value: Response, expected: Source | undefined, diagnosticOnly = false) {
  if (diagnosticOnly) {
    assert.equal(value.typescriptDiagnostics, 'run')
    assert.deepEqual(value.problems, [], 'Benchmark fixtures must have no type errors')
  } else {
    assert.ok(value.source, 'Source facts missing')
    assert.deepEqual(value.source.problems, [])
    if (value.typescriptDiagnostics === 'not-run') assert.equal(value.structuralComplete, true)
    if (expected) assert.deepEqual(canonicalSource(value.source), canonicalSource(expected))
  }
}

async function measure(fixture: FixtureCase, runs: number) {
  const project = materializeFixture(fixture)
  try {
    const request: Request = {
      protocol: 1,
      root: project.root,
      files: project.files,
      bindings: fixture.bindings,
    }
    const preparation = performance.now()
    const initial = cold([process.execPath, reference], request).value
    validate(initial, undefined)
    const expected = initial.source!
    validate(cold([binaryPath()], request).value, expected)
    const parityPreparationMs = performance.now() - preparation
    const engines = [
      {
        name: 'typescriptFullCollector',
        command: [process.execPath, reference],
        request,
        diagnosticOnly: false,
      },
      {
        name: 'nativeStructuralCollector',
        command: [binaryPath()],
        request,
        diagnosticOnly: false,
      },
      {
        name: 'typescriptDiagnosticsOnly',
        command: [process.execPath, reference],
        request: { ...request, mode: 'diagnostics' as const },
        diagnosticOnly: true,
      },
    ]
    const measurements: Record<string, unknown> = {}
    for (const engine of engines) {
      const coldSamples: Sample[] = []
      for (let index = 0; index < Math.min(3, runs); index++) {
        const result = cold(engine.command, engine.request)
        validate(result.value, expected, engine.diagnosticOnly)
        coldSamples.push(result.sample)
      }
      const worker = new Session(engine.command)
      const warmSamples: Sample[] = []
      try {
        // Deliberate unrecorded warmup: startup/module loading are measured by cold runs.
        validate((await worker.request(engine.request)).value, expected, engine.diagnosticOnly)
        for (let index = 0; index < runs; index++) {
          const result = await worker.request(engine.request)
          validate(result.value, expected, engine.diagnosticOnly)
          warmSamples.push(result.sample)
        }
      } finally {
        await worker.close()
      }
      measurements[engine.name] = { cold: stats(coldSamples), warm: stats(warmSamples) }
    }
    return {
      name: fixture.name,
      files: project.files.length,
      components: expected.components.length,
      structuralParity: 'matched',
      parityPreparationMs,
      measurements,
    }
  } finally {
    project.dispose()
  }
}

function hash(files: string[]) {
  const digest = createHash('sha256')
  for (const file of [...files].sort())
    digest
      .update(file + '\0')
      .update(readFileSync(file))
      .update('\0')
  return digest.digest('hex')
}

export async function benchmark(runs = 5, size = 64) {
  const started = performance.now()
  if (!existsSync(binaryPath()))
    throw new Error(`Native prototype isn't built: ${binaryPath()}. Run bun run native:build`)
  const comparison = compareCases()
  assert.equal(comparison.mismatches, 0, JSON.stringify(comparison))
  const measured = []
  for (const fixture of [cases.find((fixture) => fixture.name === 'checkout')!, scaled(size)])
    measured.push(await measure(fixture, runs))
  const binary = binaryPath()
  return {
    protocol: 1,
    recordedAt: new Date().toISOString(),
    elapsedMs: performance.now() - started,
    unit: 'milliseconds',
    scope: 'source collection; no application handlers or gate acceptance',
    equivalentFullGateSpeedup: null,
    limitations: [
      'Native collection supplies structural facts and does not run TypeScript diagnostics.',
      'The three engine timings have different responsibilities and are not equivalent full-gate timings.',
      'Cold means fresh process, not a flushed operating-system filesystem cache.',
      'Warm means a persistent process after one unrecorded warmup; every request rereads and analyzes files without source-result caching.',
      'Request round trips include serialization, protocol transport, file I/O, response parsing, and process startup for cold runs.',
      'Worker timings exclude request-line transport and process startup.',
      'The default Bonsai CLI remains on the TypeScript collector.',
    ],
    environment: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      runtime: {
        executable: process.execPath,
        bun: process.versions.bun ?? null,
        nodeCompatibility: process.versions.node,
      },
      typescript: ts.version,
    },
    identity: {
      rustToolchain: readFileSync('rust-toolchain.toml', 'utf8').trim(),
      cargoManifest: readFileSync('native/Cargo.toml', 'utf8').trim(),
      cargoLockSha256: createHash('sha256').update(readFileSync('native/Cargo.lock')).digest('hex'),
      nativeSourcesSha256: hash(
        readdirSync('native/src')
          .filter((file) => file.endsWith('.rs'))
          .map((file) => `native/src/${file}`),
      ),
      referenceSourcesSha256: hash(['src/source.ts', 'src/model.ts', 'native/tools/reference.ts']),
      harnessSourcesSha256: hash([
        'native/tools/bench.ts',
        'native/tools/client.ts',
        'native/tools/compare.ts',
        'native/tools/fixtures.ts',
      ]),
      binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
    },
    comparison,
    cases: measured,
  }
}

async function main() {
  const { values } = parseArgs({
    options: { runs: { type: 'string' }, size: { type: 'string' }, output: { type: 'string' } },
    strict: true,
  })
  const runs = Number(values.runs ?? 5)
  const size = Number(values.size ?? 64)
  if (
    !Number.isInteger(runs) ||
    runs < 1 ||
    runs > 20 ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > 512
  )
    throw new Error('Use --runs 1..20 and --size 1..512')
  const report = await benchmark(runs, size)
  const output = JSON.stringify(report, null, 2) + '\n'
  if (values.output) writeFileSync(resolve(values.output), output)
  process.stdout.write(output)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n',
    )
    process.exitCode = 1
  })
}
