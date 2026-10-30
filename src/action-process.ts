import { spawn } from 'node:child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serialize, deserialize } from 'node:v8'
import type { ActionRequest, ActionResult, Config } from './model.ts'

/** No verifier descriptor is open while the application's runtime can execute. */
export async function runActionPlan(
  root: string,
  config: Config,
  fingerprint: string,
  requests: ActionRequest[],
  timeoutMs: number,
  signal?: AbortSignal,
  session?: string,
  isolated = false,
): Promise<ActionResult[]> {
  if (timeoutMs <= 0) throw new Error('Verification feedback deadline expired')
  if (signal?.aborted) throw new Error('Verification interrupted')
  const directory = mkdtempSync(join(tmpdir(), 'bonsai-actions-'))
  const path = join(directory, 'result')
  const key = randomBytes(32)
  const { NODE_TEST_CONTEXT: _testContext, ...workerEnv } = process.env
  const child = spawn(process.execPath, [fileURLToPath(new URL('./worker.ts', import.meta.url))], {
    env: { ...workerEnv, ...(session !== undefined && { BONSAI_NATIVE_SESSION: session }) },
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'ignore', 'ignore'],
  })
  const closed = new Promise<void>((done) => child.once('close', () => done()))
  let timer: ReturnType<typeof setTimeout> | undefined
  let failure: Error | undefined
  let fail!: (error: Error) => void
  const abort = () => fail(new Error('Verification interrupted'))
  const signalWorker = (kind: 'SIGTERM' | 'SIGKILL') => {
    if (child.pid && process.platform !== 'win32') {
      try {
        process.kill(-child.pid, kind)
      } catch {
        /* Already stopped. */
      }
    }
    child.kill(kind)
  }
  const stopWorker = () => signalWorker('SIGKILL')
  process.once('exit', stopWorker)
  try {
    await new Promise<void>((resolve, reject) => {
      fail = (error) => {
        failure ??= error
        reject(failure)
      }
      timer = setTimeout(() => fail(new Error('Verification feedback deadline expired')), timeoutMs)
      signal?.addEventListener('abort', abort, { once: true })
      child.once('error', fail)
      child.once('exit', (code) => {
        if (code !== 0)
          fail(
            new Error(
              'Invalid worker report: verification worker exited without a complete report',
            ),
          )
        else resolve()
      })
      child.stdin!.on('error', fail)
      // The bootstrap pipe is drained and closed before any binding import.
      child.stdin!.end(serialize({ root, config, fingerprint, requests, path, key }))
      if (signal?.aborted) abort()
    })
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024)
      throw new Error('Invalid worker report: invalid result file or transport limit')
    const frame = readFileSync(path)
    const payload = frame.subarray(32)
    const signature = createHmac('sha256', key)
      .update('bonsai-action-plan-v1:')
      .update(payload)
      .digest()
    if (frame.length < 32 || !timingSafeEqual(frame.subarray(0, 32), signature))
      throw new Error('Invalid worker report: unauthenticated action response')
    const report = deserialize(payload) as { results?: ActionResult[]; error?: string }
    if (typeof report.error === 'string') throw new Error(report.error)
    if (!Array.isArray(report.results) || report.results.length !== requests.length)
      throw new Error('Invalid worker report: incomplete action plan')
    return report.results
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    if (failure && isolated) {
      signalWorker('SIGTERM')
      await new Promise<void>((done) => setTimeout(done, 250))
    }
    stopWorker()
    await closed
    process.removeListener('exit', stopWorker)
    rmSync(directory, { recursive: true, force: true })
  }
}
