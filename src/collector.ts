import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import type { Snapshot, Source, Timing, TimingStage } from './model.ts'
import type { Timer } from './timing.ts'
import { requestNativeSession, SessionInterrupted, spawnNativeWorker } from './native-session.ts'

export type SourceEngine = 'typescript' | 'rust'
type Collection = {
  source: Source
  analysis: NonNullable<Snapshot['analysis']>
  interrupted?: boolean
}
type NativeResponse = {
  protocol: 2
  source: Source
  diagnostics: 'run'
  diagnosticCategories: string[]
  backend: 'tsrs'
  version: string
  elapsedMs: number
  timing: Timing
}

const checkout = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const version: string = require('../package.json').dependencies.tsrs
const categories = ['config', 'options', 'syntactic', 'bind', 'global', 'semantic']
const shellWord = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
const install = `cd ${shellWord(checkout)} && bun install --frozen-lockfile`
const repair = () =>
  process.env.BONSAI_NATIVE_BINARY === undefined
    ? install
    : `unset BONSAI_NATIVE_BINARY && ${install}`

export class CollectorError extends Error {
  readonly code = 'RUST_COLLECTOR'
  readonly exitCode = 1

  constructor(
    message: string,
    readonly run = repair(),
  ) {
    super(message)
    this.name = 'CollectorError'
  }
}

class CollectorInterrupted extends Error {}

function workerError(message: string, details?: string): CollectorError {
  const error = new CollectorError(message)
  if (details) error.stack += `\nRust checker diagnostics:\n${details}`
  return error
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, minimum = 0) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
const knownKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key))
const reference = (value: unknown) =>
  record(value) && typeof value.file === 'string' && integer(value.line, 1)

function validSource(value: unknown): value is Source {
  if (!record(value)) return false
  const keys = [
    'files',
    'components',
    'relationships',
    'actions',
    'registry',
    'bindingImports',
    'problems',
  ]
  return (
    knownKeys(value, keys) &&
    Array.isArray(value.files) &&
    value.files.every(
      (file) =>
        record(file) &&
        knownKeys(file, ['file', 'tokens']) &&
        typeof file.file === 'string' &&
        integer(file.tokens),
    ) &&
    Array.isArray(value.components) &&
    value.components.every(
      (component) =>
        record(component) &&
        knownKeys(component, ['file', 'line', 'id', 'name', 'kind', 'tokens']) &&
        reference(component) &&
        typeof component.id === 'string' &&
        typeof component.name === 'string' &&
        ['production', 'test', 'binding'].includes(component.kind as string) &&
        integer(component.tokens),
    ) &&
    Array.isArray(value.relationships) &&
    value.relationships.every(
      (edge) =>
        record(edge) &&
        knownKeys(edge, ['from', 'to', 'kind', 'origin', 'sourceRef']) &&
        typeof edge.from === 'string' &&
        typeof edge.to === 'string' &&
        edge.kind === 'reference' &&
        edge.origin === 'static' &&
        reference(edge.sourceRef) &&
        knownKeys(edge.sourceRef as Record<string, unknown>, ['file', 'line']),
    ) &&
    record(value.actions) &&
    Object.values(value.actions).every((target) => typeof target === 'string') &&
    (value.registry === undefined || typeof value.registry === 'string') &&
    (value.bindingImports === undefined ||
      (Array.isArray(value.bindingImports) &&
        value.bindingImports.every(
          (boundary) =>
            record(boundary) &&
            knownKeys(boundary, ['file', 'line', 'from', 'adapter', 'bindings']) &&
            reference(boundary) &&
            typeof boundary.from === 'string' &&
            boundary.adapter === 'project-bindings-v1' &&
            typeof boundary.bindings === 'string',
        ))) &&
    Array.isArray(value.problems) &&
    value.problems.every((problem) => typeof problem === 'string')
  )
}

function validStage(stage: unknown): stage is TimingStage {
  return (
    record(stage) &&
    typeof stage.name === 'string' &&
    ['completed', 'interrupted', 'skipped'].includes(String(stage.status)) &&
    (stage.status === 'skipped'
      ? stage.elapsedMs === null
      : typeof stage.elapsedMs === 'number' &&
        Number.isFinite(stage.elapsedMs) &&
        stage.elapsedMs >= 0) &&
    (stage.stages === undefined || (Array.isArray(stage.stages) && stage.stages.every(validStage)))
  )
}

function consistentSource(source: Source, files: string[], bindings: string): boolean {
  // Incomplete graphs may contain duplicate overloads; they already block evidence.
  if (source.problems.length) return true
  const measured = new Set(files)
  const components = new Map(source.components.map((component) => [component.id, component]))
  if (components.size !== source.components.length) return false
  for (const component of components.values()) {
    const kind =
      component.file === bindings
        ? 'binding'
        : /(?:^|\/)(?:test|tests)\/|\.(?:test|spec)\./.test(component.file)
          ? 'test'
          : 'production'
    if (
      !measured.has(component.file) ||
      component.id !== `${component.file}#${component.name}` ||
      component.kind !== kind
    )
      return false
  }
  const registry = source.registry && components.get(source.registry)
  if (!registry || registry.kind !== 'binding' || registry.name !== 'actions') return false
  if (!Object.values(source.actions).every((id) => components.get(id)?.kind === 'production'))
    return false
  if (
    !source.relationships.every(
      (edge) =>
        components.has(edge.from) &&
        components.has(edge.to) &&
        components.get(edge.from)?.file === edge.sourceRef.file,
    )
  )
    return false
  return (source.bindingImports ?? []).every(
    (boundary) =>
      components.get(boundary.from)?.file === boundary.file && boundary.bindings === bindings,
  )
}

function response(output: string, files: string[], bindings: string): NativeResponse {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new CollectorError('Rust checker returned malformed JSON')
  }
  if (record(value) && value.protocol === 2 && typeof value.error === 'string')
    throw new CollectorError(`Rust checker failed: ${value.error}`)
  if (
    !record(value) ||
    value.protocol !== 2 ||
    value.backend !== 'tsrs' ||
    value.version !== version ||
    value.diagnostics !== 'run' ||
    !Array.isArray(value.diagnosticCategories) ||
    JSON.stringify(value.diagnosticCategories) !== JSON.stringify(categories) ||
    !validSource(value.source) ||
    !consistentSource(value.source, files, bindings) ||
    JSON.stringify(value.source.files.map((file) => file.file)) !== JSON.stringify(files) ||
    typeof value.elapsedMs !== 'number' ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0 ||
    !record(value.timing) ||
    typeof value.timing.elapsedMs !== 'number' ||
    !Number.isFinite(value.timing.elapsedMs) ||
    value.timing.elapsedMs < 0 ||
    !Array.isArray(value.timing.stages) ||
    !value.timing.stages.every(validStage)
  )
    throw new CollectorError('Rust checker returned an invalid protocol response')
  return value as NativeResponse
}

async function nativeSource(
  root: string,
  files: string[],
  bindings: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<NativeResponse> {
  const began = performance.now()
  if (signal?.aborted) throw new CollectorInterrupted('Command interrupted')
  if (timeoutMs !== undefined && timeoutMs <= 0)
    throw new CollectorInterrupted('Feedback deadline expired before Rust analysis')
  const binary = process.env.BONSAI_NATIVE_BINARY
  if (binary !== undefined && (!binary.trim() || !existsSync(resolve(binary))))
    throw new CollectorError(`Rust checker executable is unavailable: ${binary || '(empty path)'}`)
  const request = JSON.stringify({ protocol: 2, root, files, bindings, cwd: process.cwd() })
  try {
    const shared = await requestNativeSession(request, signal, timeoutMs, (output) => {
      response(output, files, bindings)
    })
    if (shared !== undefined) return response(shared, files, bindings)
  } catch (error) {
    if (error instanceof CollectorError) throw error
    if (error instanceof SessionInterrupted) throw new CollectorInterrupted(error.message)
    throw workerError('Rust checker session failed', String(error))
  }
  // A busy shared worker leaves concurrent callers on the original fresh path.
  if (timeoutMs !== undefined) {
    timeoutMs -= performance.now() - began
    if (timeoutMs <= 0)
      throw new CollectorInterrupted('Feedback deadline expired during Rust analysis')
  }
  if (signal?.aborted) throw new CollectorInterrupted('Command interrupted')
  return new Promise((resolveResult, reject) => {
    const child = spawnNativeWorker()
    let failure: Error | undefined
    let closed = false
    let settled = false
    const output: Buffer[] = []
    const errors: Buffer[] = []
    let outputBytes = 0
    let errorBytes = 0
    let forcedStop: ReturnType<typeof setTimeout> | undefined
    const forceStop = () => {
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          /* Already stopped. */
        }
      }
      child.kill('SIGKILL')
    }
    // Let the worker kill and reap its native child before terminating itself.
    const stopWorker = () => child.kill('SIGTERM')
    const fail = (error: Error) => {
      if (settled || failure) return
      failure = error
      stopWorker()
      forcedStop = setTimeout(forceStop, 250)
      if (closed) finish()
    }
    const abort = () => fail(new CollectorInterrupted('Command interrupted'))
    const deadline =
      timeoutMs === undefined
        ? undefined
        : setTimeout(
            () => fail(new CollectorInterrupted('Feedback deadline expired during Rust analysis')),
            timeoutMs,
          )
    const finish = () => {
      if (settled) return
      settled = true
      if (deadline) clearTimeout(deadline)
      if (forcedStop) clearTimeout(forcedStop)
      process.removeListener('exit', stopWorker)
      signal?.removeEventListener('abort', abort)
      child.stdin?.destroy()
      if (failure && child.exitCode === null && child.signalCode === null) forceStop()
      if (failure) reject(failure)
      else {
        try {
          resolveResult(response(Buffer.concat(output).toString('utf8'), files, bindings))
        } catch (error) {
          reject(error)
        }
      }
    }
    process.once('exit', stopWorker)
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) =>
      fail(workerError('Cannot start the Rust checker worker', error.stack)),
    )
    child.once('close', (code, stoppedBy) => {
      closed = true
      if (!failure && code !== 0)
        failure = workerError(
          `Rust checker worker exited ${stoppedBy ? `after ${stoppedBy}` : `with status ${code}`}`,
          Buffer.concat(errors).toString('utf8').trim(),
        )
      finish()
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      if (failure) return
      outputBytes += chunk.length
      if (outputBytes > 64 * 1024 * 1024)
        fail(new CollectorError('Rust checker exceeded its 64 MiB output limit'))
      else output.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (failure) return
      errorBytes += chunk.length
      if (errorBytes > 64 * 1024)
        fail(new CollectorError('Rust checker exceeded its diagnostic output limit'))
      else errors.push(chunk)
    })
    child.stdin?.once('error', (error) =>
      fail(workerError('Cannot send input to the Rust checker worker', error.stack)),
    )
    child.stdin?.end(request + '\n')
    if (signal?.aborted) abort()
  })
}

/** The selected native checker supplies diagnostics and facts; no reference compiler runs here. */
export async function collectRustSource(
  root: string,
  files: string[],
  bindings: string,
  signal?: AbortSignal,
  timeoutMs?: number,
  timer?: Timer,
): Promise<Collection> {
  let timing: Timing = { elapsedMs: 0, stages: [] }
  timer?.start('native', { report: () => timing })
  try {
    const native = await nativeSource(root, files, bindings, signal, timeoutMs)
    timing = native.timing
    timer?.finishWith(timing.stages)
    return {
      source: native.source,
      analysis: {
        engine: 'rust',
        backend: 'tsrs',
        validation: 'native-diagnostics',
        status: native.source.problems.length ? 'unsupported' : 'complete',
        version: native.version,
      },
    }
  } catch (error) {
    timer?.finish('interrupted')
    if (!(error instanceof CollectorInterrupted)) throw error
    const { measureSource } = await import('./source.ts')
    const source = measureSource(root, files)
    source.problems.push(`Rust checker interrupted: ${error.message}`)
    return {
      source,
      analysis: {
        engine: 'rust',
        backend: 'tsrs',
        validation: 'native-diagnostics',
        status: 'unsupported',
        version,
      },
      interrupted: true,
    }
  }
}
