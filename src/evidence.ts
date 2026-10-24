import { deepStrictEqual } from 'node:assert'
import { projectBindingTarget } from './binding-target.ts'
import type { Config, Contracts, Evidence } from './model.ts'

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
  engine: 'typescript' | 'rust' = 'typescript',
): Promise<Evidence> {
  const { fork } = await import('node:child_process')
  return new Promise((resolveResult, reject) => {
    if (timeoutMs <= 0) {
      reject(new Error('Verification feedback deadline expired'))
      return
    }
    const { NODE_TEST_CONTEXT: _testContext, ...workerEnv } = process.env
    const child = fork(new URL('./worker.ts', import.meta.url), [], {
      env: workerEnv,
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    const stopWorker = () => child.kill('SIGKILL')
    process.once('exit', stopWorker)
    let settled = false
    const finish = (error?: Error, evidence?: Evidence) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      process.removeListener('exit', stopWorker)
      signal?.removeEventListener('abort', abort)
      const done = () => {
        if (error) reject(error)
        else resolveResult(evidence!)
      }
      if (child.exitCode !== null || child.signalCode !== null) done()
      else child.once('close', done)
      child.kill('SIGKILL')
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
    child.send({ root, config, contracts, fingerprint, engine })
    if (signal?.aborted) abort()
  })
}
