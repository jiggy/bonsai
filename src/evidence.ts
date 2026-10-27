import { deepStrictEqual } from 'node:assert'
import { availableParallelism } from 'node:os'
import { projectBindingTarget } from './binding-target.ts'
import { validateVerification } from './policy.ts'
import type { Config, Contracts, Evidence, Verification } from './model.ts'

/** Use runtime CPU capacity, bounded by the number of scenarios that can execute. */
export function verificationPlan(contracts: Contracts, serial = false): Verification {
  return serial
    ? { profile: 'in-process-v1', workers: 1 }
    : {
        profile: 'isolated-scenarios-v1',
        workers: Math.min(availableParallelism(), Math.max(1, contracts.cases.length)),
      }
}

function observe(response: unknown, selector: string): unknown {
  let value = response
  for (const key of selector.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw new Error(`Missing response field: ${selector}`)
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

/** Trusted local execution: assertions are owned by Bonsai, not the action binding. */
export async function collectEvidence(
  root: string,
  config: Config,
  contracts: Contracts,
  fingerprint: string,
): Promise<Evidence> {
  const started = performance.now()
  const evidence: Evidence = {
    fingerprint,
    profile: 'in-process-v1',
    complete: false,
    elapsedMs: 0,
    checks: contracts.checks.map((check) => ({ id: check.id, status: 'missing' })),
  }
  try {
    const target = projectBindingTarget(root, config, fingerprint)
    const module = (await import(target.url)) as {
      actions: Record<string, (input: unknown) => unknown>
    }
    evidence.bindingImport = {
      adapter: target.adapter,
      file: target.file,
      fingerprint: target.fingerprint,
    }
    for (const scenario of contracts.cases) {
      let response: unknown
      let actionError: string | undefined
      for (const step of scenario.steps) {
        if (step.kind === 'action') {
          actionError = undefined
          try {
            if (
              !Object.hasOwn(module.actions, step.action) ||
              typeof module.actions[step.action] !== 'function'
            )
              throw new Error(`Unbound action: ${step.action}`)
            response = await module.actions[step.action](structuredClone(step.input))
          } catch (error) {
            actionError = String(error)
          }
        } else {
          const record = evidence.checks.find((check) => check.id === step.check.id)!
          try {
            if (actionError) throw new Error(actionError)
            deepStrictEqual(observe(response, step.check.selector), step.check.expected)
            record.status = 'passed'
          } catch (error) {
            record.status = 'failed'
            record.error = String(error)
          }
        }
      }
    }
    evidence.complete = true
  } finally {
    evidence.elapsedMs = performance.now() - started
  }
  return evidence
}

/** A child process gives each run a fresh module cache and an enforceable wall-clock timeout. */
export async function runEvidence(
  root: string,
  config: Config,
  contracts: Contracts,
  fingerprint: string,
  timeoutMs: number,
  signal?: AbortSignal,
  verification = verificationPlan(contracts),
): Promise<Evidence> {
  validateVerification(verification)
  if (timeoutMs <= 0) throw new Error('Verification feedback deadline expired')
  if (signal?.aborted) throw new Error('Verification interrupted')
  if (verification.profile === 'isolated-scenarios-v1')
    return isolatedEvidence(
      root,
      config,
      contracts,
      fingerprint,
      verification.workers,
      timeoutMs,
      signal,
    )
  const began = performance.now()
  const { openNativeSession } = await import('./native-session.ts')
  const session = await openNativeSession()
  try {
    return await forkEvidence(
      root,
      config,
      contracts,
      fingerprint,
      timeoutMs - (performance.now() - began),
      signal,
      session.value,
    )
  } finally {
    await session.close()
  }
}

/** Each scenario gets fresh application modules; each lane keeps only lexical startup warm. */
async function isolatedEvidence(
  root: string,
  config: Config,
  contracts: Contracts,
  fingerprint: string,
  workers: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Evidence> {
  const began = performance.now()
  const cancellation = new AbortController()
  let failure: unknown
  const fail = (error: unknown) => {
    failure ??= error
    cancellation.abort()
  }
  const abort = () => fail(new Error('Verification interrupted'))
  signal?.addEventListener('abort', abort, { once: true })
  const deadline = setTimeout(
    () => fail(new Error('Verification feedback deadline expired')),
    timeoutMs,
  )
  const remaining = () => {
    if (cancellation.signal.aborted) throw failure
    const value = timeoutMs - (performance.now() - began)
    if (value <= 0) throw new Error('Verification feedback deadline expired')
    return value
  }
  const shards = contracts.cases.length
    ? contracts.cases.map((scenario) => {
        const ids = new Set(
          scenario.steps.flatMap((step) => (step.kind === 'observation' ? [step.check.id] : [])),
        )
        return {
          ...contracts,
          cases: [scenario],
          checks: contracts.checks.filter((check) => ids.has(check.id)),
        }
      })
    : [contracts]
  const results: Evidence[] = []
  let next = 0
  try {
    if (signal?.aborted) abort()
    const { openNativeSession } = await import('./native-session.ts')
    const lanes = Array.from({ length: Math.min(workers, shards.length) }, async () => {
      let session: Awaited<ReturnType<typeof openNativeSession>> | undefined
      try {
        remaining()
        session = await openNativeSession({ inherit: false })
        while (next < shards.length) {
          remaining()
          const index = next++
          const shard = shards[index]!
          const evidence = await forkEvidence(
            root,
            config,
            shard,
            fingerprint,
            remaining(),
            cancellation.signal,
            session.value,
            true,
          )
          validateScenarioEvidence(evidence, shard, config, fingerprint)
          results[index] = evidence
        }
      } catch (error) {
        fail(error)
      } finally {
        try {
          await session?.close()
        } catch (error) {
          fail(error)
        }
      }
    })
    await Promise.all(lanes)
    remaining()
    const reported = results.flatMap((result) => result.checks)
    const checks = new Map(reported.map((check) => [check.id, check] as const))
    if (
      reported.length !== contracts.checks.length ||
      checks.size !== contracts.checks.length ||
      contracts.checks.some((check) => !checks.has(check.id))
    )
      throw new Error('Isolated verification did not report every required check exactly once')
    remaining()
    return {
      fingerprint,
      profile: 'isolated-scenarios-v1',
      complete: true,
      elapsedMs: performance.now() - began,
      bindingImport: results[0]!.bindingImport,
      checks: contracts.checks.map((check) => checks.get(check.id)!),
    }
  } finally {
    clearTimeout(deadline)
    signal?.removeEventListener('abort', abort)
  }
}

function validateScenarioEvidence(
  evidence: Evidence,
  contracts: Contracts,
  config: Config,
  fingerprint: string,
): void {
  if (
    evidence.complete !== true ||
    evidence.profile !== 'in-process-v1' ||
    evidence.fingerprint !== fingerprint ||
    evidence.bindingImport?.adapter !== 'project-bindings-v1' ||
    evidence.bindingImport.file !== config.bindings ||
    evidence.bindingImport.fingerprint !== fingerprint ||
    !Number.isFinite(evidence.elapsedMs) ||
    evidence.elapsedMs < 0 ||
    !Array.isArray(evidence.checks)
  )
    throw new Error('Invalid isolated scenario evidence or binding import receipt')
  const expected = new Set(contracts.checks.map((check) => check.id))
  const seen = new Set<string>()
  for (const check of evidence.checks) {
    if (
      !check ||
      !expected.has(check.id) ||
      seen.has(check.id) ||
      (check.status !== 'passed' && check.status !== 'failed') ||
      (check.error !== undefined && typeof check.error !== 'string')
    )
      throw new Error('Invalid or duplicate isolated scenario check')
    seen.add(check.id)
  }
  if (seen.size !== expected.size) throw new Error('Missing isolated scenario checks')
}

async function forkEvidence(
  root: string,
  config: Config,
  contracts: Contracts,
  fingerprint: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  session?: string,
  isolated = false,
): Promise<Evidence> {
  const { fork } = await import('node:child_process')
  return new Promise((resolveResult, reject) => {
    if (timeoutMs <= 0) {
      reject(new Error('Verification feedback deadline expired'))
      return
    }
    const { NODE_TEST_CONTEXT: _testContext, ...workerEnv } = process.env
    const child = fork(new URL('./worker.ts', import.meta.url), [], {
      env: {
        ...workerEnv,
        ...(session !== undefined && { BONSAI_NATIVE_SESSION: session }),
      },
      execArgv: [],
      detached: isolated && process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    const closed = new Promise<void>((done) => child.once('close', () => done()))
    const signalWorker = (signal: 'SIGTERM' | 'SIGKILL') => {
      if (isolated && child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, signal)
        } catch {
          /* The scenario process group has already exited. */
        }
      }
      child.kill(signal)
    }
    const stopWorker = () => signalWorker('SIGKILL')
    process.once('exit', stopWorker)
    let settled = false
    const finish = (error?: Error, evidence?: Evidence) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      const done = async () => {
        // Give nested CLIs a bounded opportunity to reap their detached native
        // workers before forcibly stopping the scenario's ordinary descendants.
        if (error && isolated) {
          signalWorker('SIGTERM')
          await new Promise<void>((done) => setTimeout(done, 250))
        }
        stopWorker()
        await closed
        process.removeListener('exit', stopWorker)
        if (error) reject(error)
        else resolveResult(evidence!)
      }
      void done()
    }
    const timer = setTimeout(
      () => finish(new Error('Verification feedback deadline expired')),
      timeoutMs,
    )
    const abort = () => finish(new Error('Verification interrupted'))
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => finish(error))
    child.once('exit', () =>
      finish(new Error('Verification worker exited without a complete report')),
    )
    child.once('message', (message) => {
      const result = message as { evidence?: Evidence; error?: string }
      if (result.evidence) finish(undefined, result.evidence)
      else finish(new Error(result.error ?? 'Invalid worker report'))
    })
    child.send({ root, config, contracts, fingerprint })
    if (signal?.aborted) abort()
  })
}
