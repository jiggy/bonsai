import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createConnection, createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const checker = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const entry = fileURLToPath(new URL('./tsrs-worker.ts', import.meta.url))
const outputLimit = 64 * 1024 * 1024
const requestLimit = 4 * 1024 * 1024
const errorLimit = 64 * 1024
const contextExclusions = new Set([
  'BONSAI_NATIVE_SESSION',
  'BONSAI_ROOT',
  'BONSAI_BASE',
  'BONSAI_POLICY',
  'BONSAI_NATIVE_BINARY',
  'TSRS_BINARY',
  'NODE_TEST_CONTEXT',
  'CI',
  'NO_COLOR',
  'FORCE_COLOR',
])
const environmentKey = (environment: NodeJS.ProcessEnv = process.env) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(environment)
          .filter(([key, value]) => value !== undefined && !contextExclusions.has(key))
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
      ),
    )
    .digest('hex')
const binary = () =>
  process.env.BONSAI_NATIVE_BINARY === undefined
    ? undefined
    : resolve(process.env.BONSAI_NATIVE_BINARY)

type Descriptor = {
  protocol: 1
  checker: string
  binary?: string
  environment: string
  path: string
  token: string
}
type NativeWorker = ReturnType<typeof spawnNativeWorker>

export class SessionError extends Error {}
export class SessionInterrupted extends Error {}

function inherited(): Descriptor | undefined {
  try {
    const value = JSON.parse(process.env.BONSAI_NATIVE_SESSION ?? 'null') as Descriptor | null
    if (
      value?.protocol === 1 &&
      value.checker === checker &&
      value.binary === binary() &&
      value.environment === environmentKey() &&
      typeof value.path === 'string' &&
      isAbsolute(value.path) &&
      typeof value.token === 'string' &&
      /^[a-f0-9]{64}$/.test(value.token)
    )
      return value
  } catch {
    /* An unrelated invocation cannot supply this check's private session. */
  }
  return undefined
}

/** Resolve worker dependencies from the checker and preserve caller-relative overrides. */
export function spawnNativeWorker(
  args: string[] = [],
  context?: { binary?: string; environment?: NodeJS.ProcessEnv },
) {
  const {
    TSRS_BINARY: _upstream,
    NODE_TEST_CONTEXT: _testContext,
    BONSAI_NATIVE_SESSION: _session,
    BONSAI_NATIVE_BINARY: _binary,
    ...environment
  } = context?.environment ?? process.env
  const selected = context === undefined ? binary() : context.binary
  return spawn(process.execPath, [entry, ...args], {
    cwd: checker,
    env: { ...environment, ...(selected !== undefined && { BONSAI_NATIVE_BINARY: selected }) },
    detached: process.platform !== 'win32',
    stdio: 'pipe',
  })
}

/** Undefined means no matching session or an explicitly busy worker, never a failed request. */
export async function requestNativeSession(
  request: string,
  signal?: AbortSignal,
  timeoutMs?: number,
  validate?: (response: string) => void,
): Promise<string | undefined> {
  const session = inherited()
  if (!session) return undefined
  if (signal?.aborted) throw new SessionInterrupted('Command interrupted')
  if (timeoutMs !== undefined && timeoutMs <= 0)
    throw new SessionInterrupted('Feedback deadline expired before Rust analysis')
  const frame = `{"token":${JSON.stringify(session.token)},"request":${request}}\n`
  if (Buffer.byteLength(frame) > requestLimit)
    throw new SessionError('Rust session request exceeded its 4 MiB input limit')
  return new Promise((resolveResult, reject) => {
    const socket = createConnection({ path: session.path })
    const chunks: Buffer[] = []
    let size = 0
    let accepted: string | undefined
    let settled = false
    const finish = (error?: unknown, result?: string) => {
      if (settled) return
      settled = true
      if (deadline) clearTimeout(deadline)
      signal?.removeEventListener('abort', abort)
      socket.destroy()
      if (error) reject(error)
      else resolveResult(result)
    }
    const abort = () => finish(new SessionInterrupted('Command interrupted'))
    const deadline =
      timeoutMs === undefined
        ? undefined
        : setTimeout(
            () => finish(new SessionInterrupted('Feedback deadline expired during Rust analysis')),
            timeoutMs,
          )
    signal?.addEventListener('abort', abort, { once: true })
    socket.once('connect', () => socket.write(frame))
    socket.on('error', (error) =>
      finish(new SessionError(`Rust session connection failed: ${error.message}`)),
    )
    socket.on('data', (chunk: Buffer) => {
      if (settled) return
      if (accepted !== undefined) {
        finish(new SessionError('Rust session returned unexpected trailing output'))
        return
      }
      size += chunk.length
      if (size > outputLimit) {
        finish(new SessionError('Rust session exceeded its 64 MiB output limit'))
        return
      }
      chunks.push(chunk)
      if (!chunk.includes(10)) return
      const output = Buffer.concat(chunks).toString('utf8')
      const end = output.indexOf('\n')
      if (output.slice(end + 1).trim()) {
        finish(new SessionError('Rust session returned multiple responses'))
        return
      }
      const raw = output.slice(0, end)
      try {
        let control: {
          session?: string
          error?: string
          response?: unknown
        } | null
        try {
          control = JSON.parse(raw)
        } catch {
          throw new SessionError('Rust session returned malformed framing')
        }
        if (!control || typeof control !== 'object')
          throw new SessionError('Rust session returned invalid framing')
        if (control.session === 'busy') {
          finish()
          return
        }
        if (control.session === 'error')
          throw new SessionError(control.error ?? 'Rust session request failed')
        if (control.session !== 'result' || control.response === undefined)
          throw new SessionError('Rust session returned invalid framing')
        const result = JSON.stringify(control.response)
        validate?.(result)
        accepted = result
        socket.end('accepted\n')
      } catch (error) {
        // In particular, preserve the collector's existing strict DTO error.
        finish(error)
      }
    })
    socket.once('end', () =>
      accepted === undefined
        ? finish(new SessionError('Rust session ended without a response'))
        : finish(undefined, accepted),
    )
    socket.once('close', () => {
      if (!settled) finish(new SessionError('Rust session closed before completing its request'))
    })
    if (signal?.aborted) abort()
  })
}

/** One verification owns a lean broker; the semantic process starts only when needed. */
export async function openNativeSession(
  options: { inherit?: boolean } = {},
): Promise<{ value: string; close(): Promise<void> }> {
  const borrowed = options.inherit === false ? undefined : inherited()
  if (borrowed) return { value: JSON.stringify(borrowed), close: async () => {} }
  const environment = { ...process.env }

  let directory = mkdtempSync(join(tmpdir(), 'bonsai-'))
  // Darwin and Unix domain sockets have a much smaller path limit than files.
  if (Buffer.byteLength(join(directory, 'n.sock')) > 96) {
    rmSync(directory, { recursive: true, force: true })
    directory = mkdtempSync('/tmp/bonsai-')
  }
  const descriptor: Descriptor = {
    protocol: 1,
    checker,
    binary: binary(),
    environment: environmentKey(environment),
    path: join(directory, 'n.sock'),
    token: randomBytes(32).toString('hex'),
  }
  const sockets = new Set<Socket>()
  let warm: NativeWorker | undefined
  let warmClosed: Promise<void> | undefined
  let retiring: Promise<void> | undefined
  let closing: Promise<void> | undefined
  let stopped = false
  let busy = false
  let id = 0
  let exchange:
    | {
        id: number
        chunks: Buffer[]
        size: number
        resolve(raw: string): void
        reject(error: Error): void
      }
    | undefined
  let diagnostics: Buffer[] = []
  let diagnosticBytes = 0
  let activeFailure: ((error: Error) => void) | undefined

  const force = (child: NativeWorker) => {
    if (child.pid && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* Already stopped. */
      }
    }
    child.kill('SIGKILL')
  }
  const retire = (error = new SessionError('Rust session worker stopped')): Promise<void> => {
    if (retiring) return retiring
    const child = warm
    if (!child) return Promise.resolve()
    const closed = warmClosed!
    warm = undefined
    exchange?.reject(error)
    exchange = undefined
    retiring = (async () => {
      child.kill('SIGTERM')
      const forced = setTimeout(() => force(child), 250)
      try {
        await closed
      } finally {
        force(child)
        clearTimeout(forced)
        retiring = undefined
      }
    })()
    return retiring
  }
  const failWorker = (child: NativeWorker, message: string) => {
    if (child !== warm) return
    const detail = Buffer.concat(diagnostics).toString('utf8').trim()
    const error = new SessionError(message + (detail ? `\n${detail}` : ''))
    void retire(error)
    activeFailure?.(error)
  }
  const ensureWorker = async () => {
    await retiring
    if (stopped) throw new SessionError('Rust session is closed')
    if (warm) return warm
    const child = spawnNativeWorker(['--session', directory], {
      binary: descriptor.binary,
      environment,
    })
    warm = child
    diagnostics = []
    diagnosticBytes = 0
    warmClosed = new Promise((done) => child.once('close', () => done()))
    child.once('error', (error) =>
      failWorker(child, `Cannot start Rust session worker: ${error.message}`),
    )
    child.once('exit', (code, signal) =>
      failWorker(
        child,
        `Rust session worker exited ${signal ? `after ${signal}` : `with status ${code}`}`,
      ),
    )
    child.once('close', (code, signal) =>
      failWorker(
        child,
        `Rust session worker exited ${signal ? `after ${signal}` : `with status ${code}`}`,
      ),
    )
    child.stdin.on('error', (error) =>
      failWorker(child, `Cannot write Rust session request: ${error.message}`),
    )
    child.stderr.on('data', (chunk: Buffer) => {
      if (child !== warm) return
      diagnosticBytes += chunk.length
      if (diagnosticBytes > errorLimit)
        failWorker(child, 'Rust session worker exceeded its diagnostic output limit')
      else diagnostics.push(chunk)
    })
    child.stdout.on('data', (chunk: Buffer) => {
      if (child !== warm) return
      const pending = exchange
      if (!pending) {
        failWorker(child, 'Rust session worker returned unrequested output')
        return
      }
      pending.size += chunk.length
      if (pending.size > outputLimit) {
        failWorker(child, 'Rust session worker exceeded its 64 MiB output limit')
        return
      }
      pending.chunks.push(chunk)
      if (!chunk.includes(10)) return
      const output = Buffer.concat(pending.chunks).toString('utf8')
      const end = output.indexOf('\n')
      try {
        if (output.slice(end + 1).trim()) throw new Error('multiple response records')
        const value = JSON.parse(output.slice(0, end)) as { id: number; response: unknown }
        if (value.id !== pending.id || value.response === undefined)
          throw new Error('wrong request identity')
        const raw = JSON.stringify(value.response)
        exchange = undefined
        pending.resolve(raw)
      } catch (error) {
        failWorker(child, `Rust session worker returned invalid framing: ${String(error)}`)
      }
    })
    return child
  }

  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket)
    let bytes = 0
    const chunks: Buffer[] = []
    let phase: 'request' | 'waiting' | 'ack' | 'complete' = 'request'
    let owns = false
    let expectedWorker: NativeWorker | undefined
    let acknowledgement = ''
    let ending: Promise<void> | undefined
    const problem = (error: unknown) =>
      (ending ??= (async () => {
        phase = 'complete'
        if (owns) await retire(error instanceof Error ? error : new SessionError(String(error)))
        if (activeFailure === failed) activeFailure = undefined
        if (owns) busy = false
        owns = false
        if (!socket.destroyed)
          socket.end(JSON.stringify({ session: 'error', error: String(error) }) + '\n')
      })())
    const failed = (error: Error) => void problem(error)
    socket.on('error', () => socket.destroy())
    socket.once('close', () => {
      sockets.delete(socket)
      if (owns) void problem(new SessionError('Rust session client disconnected'))
    })
    socket.once('end', () => {
      if (phase !== 'complete')
        void problem(new SessionError('Rust session client ended before accepting its response'))
    })
    socket.on('data', (chunk: Buffer) => {
      if (phase === 'ack') {
        acknowledgement += chunk.toString('utf8')
        if (acknowledgement.length > 9) {
          void problem(new SessionError('Rust session response was not accepted'))
          return
        }
        if (!acknowledgement.includes('\n')) return
        if (acknowledgement !== 'accepted\n') {
          void problem(new SessionError('Rust session response was not accepted'))
          return
        }
        if (
          !expectedWorker ||
          expectedWorker !== warm ||
          expectedWorker.exitCode !== null ||
          expectedWorker.signalCode !== null ||
          retiring
        ) {
          void problem(new SessionError('Rust session worker stopped before response acceptance'))
          return
        }
        phase = 'complete'
        owns = false
        if (activeFailure === failed) activeFailure = undefined
        busy = false
        socket.end()
        return
      }
      if (phase !== 'request') {
        void problem(new SessionError('Rust session received unexpected input'))
        return
      }
      bytes += chunk.length
      if (bytes > requestLimit) {
        void problem(new SessionError('Rust session request exceeded its 4 MiB input limit'))
        return
      }
      chunks.push(chunk)
      if (!chunk.includes(10)) return
      phase = 'waiting'
      void (async () => {
        try {
          const input = Buffer.concat(chunks).toString('utf8')
          const end = input.indexOf('\n')
          if (input.slice(end + 1).trim())
            throw new SessionError('Rust session received multiple requests')
          const value = JSON.parse(input.slice(0, end)) as { token: string; request: unknown }
          if (value.token !== descriptor.token)
            throw new SessionError('Rust session authentication failed')
          if (busy) {
            phase = 'complete'
            socket.end(JSON.stringify({ session: 'busy' }) + '\n')
            return
          }
          busy = true
          owns = true
          activeFailure = failed
          const child = await ensureWorker()
          if (socket.destroyed) throw new SessionError('Rust session client disconnected')
          if (child !== warm || child.exitCode !== null || child.signalCode !== null)
            throw new SessionError('Rust session worker stopped before accepting its request')
          expectedWorker = child
          const requestId = ++id
          const raw = await new Promise<string>((resolveResult, reject) => {
            diagnostics = []
            diagnosticBytes = 0
            exchange = { id: requestId, chunks: [], size: 0, resolve: resolveResult, reject }
            child.stdin.write(JSON.stringify({ id: requestId, request: value.request }) + '\n')
          })
          if (socket.destroyed) throw new SessionError('Rust session client disconnected')
          if (
            ending ||
            child !== warm ||
            child.exitCode !== null ||
            child.signalCode !== null ||
            retiring
          )
            throw new SessionError('Rust session worker stopped before response acceptance')
          phase = 'ack'
          socket.write('{"session":"result","response":' + raw + '}\n')
        } catch (error) {
          await problem(error)
        }
      })()
    })
  })
  const exit = () => {
    warm?.stdin.destroy()
    warm?.kill('SIGTERM')
    rmSync(directory, { recursive: true, force: true })
  }
  process.once('exit', exit)
  const close = () =>
    (closing ??= (async () => {
      stopped = true
      const listener = new Promise<void>((done) => {
        try {
          server.close(() => done())
        } catch {
          done()
        }
      })
      for (const socket of sockets) socket.destroy()
      await retire()
      await listener
      process.removeListener('exit', exit)
      rmSync(directory, { recursive: true, force: true })
    })())
  try {
    await new Promise<void>((done, reject) => {
      server.once('error', reject)
      server.listen(descriptor.path, () => {
        server.removeListener('error', reject)
        done()
      })
    })
    server.on('error', () => void close())
    return { value: JSON.stringify(descriptor), close }
  } catch (error) {
    await close()
    throw new SessionError(`Cannot start Rust session: ${String(error)}`)
  }
}
