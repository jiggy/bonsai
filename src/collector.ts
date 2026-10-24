import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Snapshot, Source } from './model.ts'

export type SourceEngine = 'typescript' | 'rust'
type Analysis = NonNullable<Snapshot['analysis']>
type Collection = { source: Source; analysis: Analysis; interrupted?: boolean }
type NativeResponse = {
  protocol: 1
  structuralComplete: boolean
  typescriptDiagnostics: 'not-run'
  source: Source
  elapsedMs: number
}

const checkout = fileURLToPath(new URL('../', import.meta.url))
const shellWord = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
const build = `cd ${shellWord(checkout)} && bun run native:build`
const repair = () =>
  process.env.BONSAI_NATIVE_BINARY === undefined ? build : `unset BONSAI_NATIVE_BINARY && ${build}`

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
  if (details) error.stack += `\nRust collector diagnostics:\n${details}`
  return error
}

function binaryPath(): string {
  const override = process.env.BONSAI_NATIVE_BINARY
  if (override !== undefined) {
    if (!override.trim())
      throw new CollectorError('BONSAI_NATIVE_BINARY needs an executable Rust collector path')
    return resolve(override)
  }
  const name = `bonsai-collector-prototype${process.platform === 'win32' ? '.exe' : ''}`
  return resolve(
    process.env.CARGO_TARGET_DIR ?? resolve(checkout, 'native/target'),
    'release',
    name,
  )
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

function response(output: string): NativeResponse {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new CollectorError('Rust collector returned malformed JSON')
  }
  if (record(value) && value.protocol === 1 && typeof value.error === 'string')
    throw new CollectorError(`Rust collector failed: ${value.error}`)
  if (
    !record(value) ||
    value.protocol !== 1 ||
    value.typescriptDiagnostics !== 'not-run' ||
    typeof value.structuralComplete !== 'boolean' ||
    !validSource(value.source) ||
    value.structuralComplete !== (value.source.problems.length === 0) ||
    typeof value.elapsedMs !== 'number' ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0
  )
    throw new CollectorError('Rust collector returned an invalid protocol response')
  return value as NativeResponse
}

async function nativeSource(
  root: string,
  files: string[],
  bindings: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<NativeResponse> {
  if (signal?.aborted) throw new CollectorInterrupted('Command interrupted')
  if (timeoutMs !== undefined && timeoutMs <= 0)
    throw new CollectorInterrupted('Feedback deadline expired before Rust collection')
  const binary = binaryPath()
  if (!existsSync(binary)) throw new CollectorError(`Rust collector is not built: ${binary}`)
  return new Promise((resolveResult, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      reject(workerError(`Can't start Rust collector: ${binary}`, String(error)))
      return
    }
    let failure: Error | undefined
    let closed = false
    let settled = false
    const output: Buffer[] = []
    const errors: Buffer[] = []
    let outputBytes = 0
    let errorBytes = 0
    const stopWorker = () => child.kill('SIGKILL')
    const fail = (error: Error) => {
      if (settled || failure) return
      failure = error
      stopWorker()
      if (closed) finish()
    }
    const abort = () => fail(new CollectorInterrupted('Command interrupted'))
    const deadline =
      timeoutMs === undefined
        ? undefined
        : setTimeout(
            () =>
              fail(new CollectorInterrupted('Feedback deadline expired during Rust collection')),
            timeoutMs,
          )
    const finish = () => {
      if (settled) return
      settled = true
      if (deadline) clearTimeout(deadline)
      process.removeListener('exit', stopWorker)
      signal?.removeEventListener('abort', abort)
      child.stdin?.destroy()
      if (failure) reject(failure)
      else {
        try {
          resolveResult(response(Buffer.concat(output).toString('utf8')))
        } catch (error) {
          reject(error)
        }
      }
    }
    process.once('exit', stopWorker)
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) =>
      fail(workerError(`Can't run Rust collector: ${binary}`, error.stack ?? error.message)),
    )
    child.once('close', (code, stoppedBy) => {
      closed = true
      if (!failure && code !== 0) {
        const detail = Buffer.concat(errors).toString('utf8').trim()
        failure = workerError(
          `Rust collector ${binary} exited ${stoppedBy ? `after ${stoppedBy}` : `with status ${code}`}`,
          detail,
        )
      }
      finish()
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      if (failure) return
      outputBytes += chunk.length
      if (outputBytes > 64 * 1024 * 1024)
        fail(new CollectorError('Rust collector exceeded its 64 MiB output limit'))
      else output.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (failure) return
      errorBytes += chunk.length
      if (errorBytes > 64 * 1024)
        fail(new CollectorError('Rust collector exceeded its diagnostic output limit'))
      else errors.push(chunk)
    })
    child.stdin?.once('error', (error) =>
      fail(
        workerError(`Can't send input to Rust collector: ${binary}`, error.stack ?? error.message),
      ),
    )
    child.stdin?.end(JSON.stringify({ protocol: 1, root, files, bindings }) + '\n')
    if (signal?.aborted) abort()
  })
}

function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted)
    if (record(item))
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, sorted(item[key])]),
      )
    return item
  }
  return JSON.stringify(sorted(value))
}

function facts(source: Source) {
  const sort = <T>(items: T[]) =>
    [...items].sort((left, right) => canonical(left).localeCompare(canonical(right)))
  return {
    files: sort(source.files),
    components: sort(source.components),
    relationships: sort(source.relationships),
    actions: source.actions,
    registry: source.registry,
    bindingImports: source.bindingImports && sort(source.bindingImports),
  }
}

/** Match complete facts first, then preserve the reference's established display order. */
function ordered<T>(items: T[], reference: T[]): T[] {
  const available = new Map<string, T[]>()
  for (const item of items) {
    const key = canonical(item)
    if (!available.has(key)) available.set(key, [])
    available.get(key)!.push(item)
  }
  return reference.map((item) => available.get(canonical(item))!.shift()!)
}

export async function collectRustSource(
  root: string,
  files: string[],
  bindings: string,
  reference: Source,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<Collection> {
  const blocked = (
    status: 'unsupported' | 'mismatch',
    problems: string[],
    interrupted = false,
  ): Collection => ({
    source: { ...reference, problems: [...reference.problems, ...problems] },
    analysis: { engine: 'rust', validation: 'typescript-reference', status },
    ...(interrupted && { interrupted: true }),
  })
  let native: NativeResponse
  try {
    native = await nativeSource(root, files, bindings, signal, timeoutMs)
  } catch (error) {
    if (error instanceof CollectorInterrupted)
      return blocked('unsupported', [`Rust collector interrupted: ${error.message}`], true)
    throw error
  }
  if (!native.structuralComplete)
    return blocked(
      'unsupported',
      native.source.problems.map((problem) => `Rust collector unsupported: ${problem}`),
    )
  const expected = facts(reference)
  const actual = facts(native.source)
  const different = (Object.keys(expected) as (keyof typeof expected)[]).filter(
    (key) => canonical(actual[key]) !== canonical(expected[key]),
  )
  if (different.length)
    return blocked('mismatch', [
      `Rust collector mismatch: ${different.join(', ')} differ from TypeScript`,
    ])
  return {
    source: {
      ...native.source,
      files: ordered(native.source.files, reference.files),
      components: ordered(native.source.components, reference.components),
      relationships: ordered(native.source.relationships, reference.relationships),
      actions: Object.fromEntries(
        Object.keys(reference.actions).map((key) => [key, native.source.actions[key]!]),
      ),
      ...(native.source.bindingImports && {
        bindingImports: ordered(native.source.bindingImports, reference.bindingImports!),
      }),
      // Native collection intentionally does not supply TypeScript diagnostics.
      problems: [...reference.problems],
    },
    analysis: { engine: 'rust', validation: 'typescript-reference', status: 'matched' },
  }
}
