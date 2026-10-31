import { CliError } from './cli-interface.ts'
import { spawn } from 'node:child_process'
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inventory } from './inventory.ts'
import { analysisIdentity, sameExecutionIdentity, type ExecutionIdentity } from './identity.ts'
import { pythonProgram } from './python-program.ts'
import { parseSnapshot } from './snapshot-schema.ts'
import type { ActionRequest, ActionResult, Config, Source, Snapshot } from './model.ts'
import type { Timer } from './timing.ts'

type Compiler = ExecutionIdentity['compiler']
class PythonInterrupted extends Error {}
const validCompiler = (value: unknown): value is Compiler => {
  const compiler = value as Compiler | undefined
  return (
    compiler?.name === 'python' &&
    /^3\.1[0-5]\.\d+$/.test(compiler.version) &&
    /^[a-f0-9]{64}$/.test(compiler.digest)
  )
}

/** The analyzer owns no candidate imports; the runtime shares its caller's process group. */
function pythonProcess(request: unknown, timeoutMs: number, signal?: AbortSignal, detached = true) {
  if (timeoutMs <= 0) throw new PythonInterrupted('Python feedback deadline expired')
  if (signal?.aborted) throw new PythonInterrupted('Python analysis interrupted')
  const executable = process.env.BONSAI_PYTHON_BINARY ?? 'python3'
  if (!executable)
    throw new CliError(
      'BONSAI_PYTHON_BINARY is empty',
      'PYTHON_RUNTIME',
      'Set BONSAI_PYTHON_BINARY to an installed CPython 3.10–3.15 interpreter',
      1,
    )
  const child = spawn(executable, ['-I', '-S', '-B', '-X', 'utf8', '-c', pythonProgram], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: detached && process.platform !== 'win32',
  })
  let buffer = ''
  let size = 0
  let diagnostics = ''
  let failure: Error | undefined
  let stopped = false
  let waiting: { resolve: (frame: any) => void; reject: (error: Error) => void } | undefined
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  const kill = () => {
    if (detached && child.pid && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* Already reaped. */
      }
    }
    child.kill('SIGKILL')
  }
  const fail = (error: Error) => {
    failure ??= error
    waiting?.reject(failure)
    waiting = undefined
    kill()
  }
  const abort = () => fail(new PythonInterrupted('Python execution interrupted'))
  const timer = setTimeout(
    () => fail(new PythonInterrupted('Python feedback deadline expired')),
    timeoutMs,
  )
  signal?.addEventListener('abort', abort, { once: true })
  process.once('exit', kill)
  child.once('error', (error) =>
    fail(
      new CliError(
        `Can't start installed CPython: ${executable} (${error.message})`,
        'PYTHON_RUNTIME',
        'Install CPython 3.10–3.15 or set BONSAI_PYTHON_BINARY to its interpreter path',
        1,
      ),
    ),
  )
  child.stdin.on('error', (error) => {
    if (!stopped) fail(error)
  })
  child.stderr.setEncoding('utf8')
  child.stdout.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    diagnostics += chunk.toString()
    if (Buffer.byteLength(diagnostics) > 65536)
      fail(new Error('Python diagnostics exceeded 64 KiB'))
  })
  child.stdout.on('data', (chunk: string) => {
    size += Buffer.byteLength(chunk)
    if (size > 64 * 1024 * 1024) return fail(new Error('Python responses exceeded 64 MiB'))
    buffer += chunk.toString()
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n')
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      try {
        const frame: unknown = JSON.parse(line)
        if (!waiting) throw new Error('Unsolicited Python response')
        const receiver = waiting
        waiting = undefined
        receiver.resolve(frame)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    }
  })
  child.once('close', (code) => {
    if (!stopped && (waiting || code !== 0))
      fail(
        new Error(
          'Python process stopped before its response: ' +
            (diagnostics.trim().split('\n').at(-1) || 'no response'),
        ),
      )
  })
  const next = () => {
    if (failure) return Promise.reject(failure)
    if (waiting) return Promise.reject(new Error('Concurrent Python requests are unsupported'))
    return new Promise<any>((resolve, reject) => {
      waiting = { resolve, reject }
    })
  }
  const send = (message: unknown) => child.stdin.write(JSON.stringify(message) + '\n')
  const ready = next()
  send(request)
  return {
    ready,
    async invoke(message: unknown) {
      const response = next()
      send(message)
      return response
    },
    async close() {
      stopped = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      kill()
      await closed
      process.removeListener('exit', kill)
    },
  }
}

export async function pythonIdentity(
  signal?: AbortSignal,
  timeoutMs = 5000,
): Promise<ExecutionIdentity> {
  const process = pythonProcess({ mode: 'identity' }, timeoutMs, signal)
  try {
    const frame = await process.ready
    if (!validCompiler(frame?.compiler)) throw new Error('Unsupported Python interpreter identity')
    return analysisIdentity(frame.compiler)
  } finally {
    await process.close()
  }
}

export async function collectPythonSource(
  root: string,
  files: string[],
  bindings: string,
  signal?: AbortSignal,
  timeoutMs = 30000,
  timer?: Timer,
): Promise<{
  source: Source
  identity?: ExecutionIdentity
  pythonSources?: Record<string, string>
  analysis: Snapshot['analysis']
  interrupted: boolean
}> {
  timer?.start('python-ast')
  let process: ReturnType<typeof pythonProcess> | undefined
  try {
    process = pythonProcess({ mode: 'analyze', root, files, bindings }, timeoutMs, signal)
    const frame = await process.ready
    if (!validCompiler(frame?.compiler)) throw new Error('Unsupported Python interpreter identity')
    const source: Source = frame.source
    if (
      !frame.digests ||
      typeof frame.digests !== 'object' ||
      Array.isArray(frame.digests) ||
      JSON.stringify(Object.keys(frame.digests)) !==
        JSON.stringify(files.filter((file) => file.endsWith('.py'))) ||
      !Object.values(frame.digests).every(
        (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
      )
    )
      throw new Error('Invalid Python source digests')
    parseSnapshot(
      JSON.stringify({
        schema: 'bonsai-snapshot-v1',
        fingerprint: 'source-validation',
        contracts: { pairs: [], checks: [], cases: [], problems: [] },
        source,
        ancestry: {},
        unrooted: [],
      }),
    )
    const measured = source.files.map((file) => file.file)
    const ids = new Set(source.components.map((component) => component.id))
    if (
      JSON.stringify(measured) !== JSON.stringify(files) ||
      ids.size !== source.components.length ||
      source.components.some(
        (component) =>
          !files.includes(component.file) || component.id !== component.file + '#' + component.name,
      ) ||
      source.relationships.some(
        (edge) =>
          !ids.has(edge.from) ||
          !ids.has(edge.to) ||
          source.components.find((component) => component.id === edge.from)?.file !==
            edge.sourceRef.file,
      ) ||
      Object.values(source.actions).some(
        (id) => source.components.find((component) => component.id === id)?.kind !== 'production',
      )
    )
      throw new Error('Invalid Python source inventory or graph')
    return {
      source,
      pythonSources: frame.digests,
      identity: analysisIdentity(frame.compiler),
      interrupted: false,
      analysis: {
        engine: 'python',
        backend: 'python-ast',
        validation: 'python-ast',
        status: source.problems.length ? 'unsupported' : 'complete',
        version: 'python-stdlib-v1/' + frame.compiler.version,
      },
    }
  } catch (error) {
    if (!(error instanceof PythonInterrupted)) throw error
    timer?.finish('interrupted')
    const { measureSource } = await import('./source.ts')
    const source = measureSource(root, files)
    source.problems.push(`Python analysis interrupted: ${error.message}`)
    return {
      source,
      interrupted: true,
      analysis: {
        engine: 'python',
        backend: 'python-ast',
        validation: 'python-ast',
        status: 'unsupported',
        version: 'python-stdlib-v1',
      },
    }
  } finally {
    await process?.close()
    timer?.finish()
  }
}

/** Receive a completed plan only after Python exits; stdout is never a result channel. */
export async function pythonActionPlan(
  root: string,
  config: Config,
  operations: ActionRequest[],
  compiler?: Compiler,
  digests?: Record<string, string>,
): Promise<ActionResult[]> {
  if (!compiler || compiler.name !== 'python') throw new Error('Missing Python analysis identity')
  if (!digests) throw new Error('Missing analyzed Python source digests')
  const directory = mkdtempSync(join(tmpdir(), 'bonsai-python-actions-'))
  const path = join(directory, 'result')
  const executable = process.env.BONSAI_PYTHON_BINARY ?? 'python3'
  const child = spawn(executable, ['-I', '-S', '-B', '-X', 'utf8', '-c', pythonProgram], {
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  const closed = new Promise<void>((done) => child.once('close', () => done()))
  const kill = () => {
    child.kill('SIGKILL')
  }
  process.once('exit', kill)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => {
        kill()
        reject(new Error('Python feedback deadline expired'))
      }, config.policy.maxFeedbackMs)
      child.once('error', reject)
      child.stdin!.on('error', reject)
      child.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(new Error('Python process exited without a completed action plan')),
      )
      child.stdin!.end(
        JSON.stringify({
          mode: 'actions',
          root,
          bindings: config.bindings,
          files: inventory(root, config.maintained, config.exclude),
          compiler,
          digests,
          operations,
          result: path,
        }) + '\n',
      )
    })
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
      throw new Error('Invalid Python completed result')
    const report = JSON.parse(readFileSync(path, 'utf8'))
    if (
      !validCompiler(report.compiler) ||
      !sameExecutionIdentity(analysisIdentity(compiler), analysisIdentity(report.compiler)) ||
      !Array.isArray(report.results) ||
      report.results.length !== operations.length
    )
      throw new Error('Invalid Python action plan or runtime context')
    return report.results
  } finally {
    clearTimeout(timer)
    kill()
    await closed
    process.removeListener('exit', kill)
    rmSync(directory, { recursive: true, force: true })
  }
}
