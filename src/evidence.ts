import type { RustProgram, RustTools } from './rust-process.ts'
import { deepStrictEqual } from 'node:assert'
import { availableParallelism } from 'node:os'
import { projectBindingTarget } from './binding-target.ts'
import { runActionPlan } from './action-process.ts'
import { validateVerification, validEvidence } from './policy.ts'
import {
  applicationIdentity,
  identityForBindings,
  sameExecutionIdentity,
  type ExecutionIdentity,
} from './identity.ts'
import type {
  Config,
  Contracts,
  Evidence,
  Verification,
  ActionSelection,
  ActionResult,
  ActionRequest,
} from './model.ts'

/** Use runtime CPU capacity, bounded by the number of scenarios that can execute. */
export function verificationPlan(contracts: Contracts, serial = false): Verification {
  return serial
    ? { profile: 'in-process-v1', workers: 1 }
    : {
        profile: 'isolated-scenarios-v1',
        workers: Math.min(availableParallelism(), Math.max(1, contracts.cases.length)),
      }
}

type Execution = {
  timeoutMs?: number
  signal?: AbortSignal
  session?: string
  isolated?: boolean
  rustProgram?: RustProgram
  pythonSources?: Record<string, string>
}

/** Only this verifier process evaluates observations or constructs evidence. */
export async function collectEvidence(
  root: string,
  config: Config,
  contracts: Contracts,
  fingerprint: string,
  identity?: ExecutionIdentity,
  execution: Execution = {},
): Promise<Evidence> {
  const started = performance.now()
  identity = applicationIdentity(
    identity ??
      (await identityForBindings(config.bindings, execution.signal, execution.timeoutMs, root)),
  )
  const target = projectBindingTarget(root, config, fingerprint)
  const evidence: Evidence = {
    schema: 'bonsai-evidence-v2',
    identity,
    fingerprint,
    profile: 'in-process-v1',
    complete: false,
    elapsedMs: 0,
    bindingImport: { adapter: target.adapter, file: target.file, fingerprint: target.fingerprint },
    checks: contracts.checks.map((check) => ({ id: check.id, status: 'missing' })),
  }
  const requests: ActionRequest[] = []
  for (const scenario of contracts.cases) {
    for (let index = 0; index < scenario.steps.length; index++) {
      const step = scenario.steps[index]!
      if (step.kind !== 'action') continue
      const selections: ActionSelection[] = []
      for (let next = index + 1; next < scenario.steps.length; next++) {
        const observation = scenario.steps[next]!
        if (observation.kind === 'action') break
        selections.push({
          selector: observation.check.selector,
          keys: observation.check.selector.replace(/\[(\d+)\]/g, '.$1').split('.'),
        })
      }
      requests.push({
        kind: 'invoke',
        id: requests.length + 1,
        action: step.action,
        input: structuredClone(step.input),
        selections,
      })
    }
  }
  const results = await runActionPlan(
    root,
    config,
    fingerprint,
    requests,
    (execution.timeoutMs ?? config.policy.maxFeedbackMs) - (performance.now() - started),
    execution.signal,
    execution.session,
    execution.isolated,
    identity.compiler,
    execution.rustProgram,
    execution.pythonSources,
  )
  let next = 0
  try {
    for (const scenario of contracts.cases) {
      let result: ActionResult | undefined
      let observed = 0
      for (let index = 0; index < scenario.steps.length; index++) {
        const step = scenario.steps[index]!
        if (step.kind === 'action') {
          result = results[next]!
          validateActionResult(result, requests[next++]!)
          observed = 0
        } else {
          const record = evidence.checks.find((check) => check.id === step.check.id)!
          const observation = result?.observations?.[observed++]
          try {
            if (result?.error !== undefined) throw new Error(result.error)
            if (!observation) throw new Error(`Missing response field: ${step.check.selector}`)
            if (observation.error !== undefined) throw observation.error
            deepStrictEqual(observation.value, step.check.expected)
            record.status = 'passed'
          } catch (error) {
            record.status = 'failed'
            record.error = String(error)
            if (result?.error === undefined && result?.preview !== undefined)
              record.response = result.preview
          }
        }
      }
    }
    evidence.complete = true
    return evidence
  } finally {
    evidence.elapsedMs = performance.now() - started
  }
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
  identity?: ExecutionIdentity,
  pythonSources?: Record<string, string>,
  rustContext?: RustTools,
): Promise<Evidence> {
  const began = performance.now()
  validateVerification(verification)
  if (timeoutMs <= 0) throw new Error('Verification feedback deadline expired')
  if (signal?.aborted) throw new Error('Verification interrupted')
  const currentIdentity = identity
    ? applicationIdentity(identity)
    : await identityForBindings(config.bindings, signal, timeoutMs, root)
  if (identity !== undefined && !sameExecutionIdentity(identity, currentIdentity))
    throw new Error('Verification checker or toolchain identity changed')
  identity = currentIdentity
  if (config.bindings.endsWith('.py') && !pythonSources) {
    const { collectPythonSource } = await import('./python.ts')
    const { inventory } = await import('./inventory.ts')
    const collected = await collectPythonSource(
      root,
      inventory(root, config.maintained, config.exclude),
      config.bindings,
      signal,
      timeoutMs - (performance.now() - began),
    )
    if (collected.source.problems.length || !collected.pythonSources)
      throw new Error('Python source analysis is incomplete')
    pythonSources = collected.pythonSources
  }
  const prepared = config.bindings.endsWith('.rs')
    ? await (await import('./rust-process.ts')).prepareRustProgram(
        root,
        config,
        fingerprint,
        identity.compiler,
        timeoutMs - (performance.now() - began),
        signal,
        rustContext,
      )
    : undefined
  try {
    timeoutMs -= performance.now() - began
    if (timeoutMs <= 0) throw new Error('Verification feedback deadline expired')
    if (verification.profile === 'isolated-scenarios-v1')
      return await isolatedEvidence(
        root,
        config,
        contracts,
        fingerprint,
        verification.workers,
        timeoutMs,
        signal,
        identity,
        prepared?.program,
        pythonSources,
      )
    const serialBegan = performance.now()
    const { openNativeSession } = await import('./native-session.ts')
    const session = /\.(?:py|rs)$/.test(config.bindings) ? undefined : await openNativeSession()
    try {
      return await collectEvidence(root, config, contracts, fingerprint, identity, {
        timeoutMs: timeoutMs - (performance.now() - serialBegan),
        signal,
        session: session?.value,
        isolated: false,
        rustProgram: prepared?.program,
        pythonSources,
      })
    } finally {
      await session?.close()
    }
  } finally {
    await prepared?.close()
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
  identity?: ExecutionIdentity,
  rustProgram?: RustProgram,
  pythonSources?: Record<string, string>,
  rustContext?: RustTools,
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
  // Start larger independent journeys first so a long tail does not idle lanes.
  const queue = shards
    .map((shard, index) => ({
      index,
      actions: shard.cases[0]?.steps.filter((step) => step.kind === 'action').length ?? 0,
    }))
    .sort((left, right) => right.actions - left.actions || left.index - right.index)
    .map(({ index }) => index)
  const results: Evidence[] = []
  let next = 0
  try {
    if (signal?.aborted) abort()
    const { openNativeSession } = await import('./native-session.ts')
    const lanes = Array.from({ length: Math.min(workers, shards.length) }, async () => {
      let session: Awaited<ReturnType<typeof openNativeSession>> | undefined
      try {
        remaining()
        if (!/\.(?:py|rs)$/.test(config.bindings))
          session = await openNativeSession({ inherit: false })
        while (next < shards.length) {
          remaining()
          const index = queue[next++]!
          const shard = shards[index]!
          const evidence = await collectEvidence(root, config, shard, fingerprint, identity, {
            timeoutMs: remaining(),
            signal: cancellation.signal,
            session: session?.value,
            isolated: true,
            rustProgram,
            pythonSources,
          })
          validateScenarioEvidence(evidence, shard, config, fingerprint, identity)
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
      schema: 'bonsai-evidence-v2',
      identity: identity!,
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
  identity?: ExecutionIdentity,
): void {
  if (
    !validEvidence(evidence) ||
    evidence.complete !== true ||
    evidence.profile !== 'in-process-v1' ||
    evidence.fingerprint !== fingerprint ||
    !sameExecutionIdentity(evidence.identity, identity) ||
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
      (check.error !== undefined && typeof check.error !== 'string') ||
      (check.response !== undefined &&
        (check.status !== 'failed' ||
          typeof check.response !== 'string' ||
          Buffer.byteLength(check.response) > 2048))
    )
      throw new Error('Invalid or duplicate isolated scenario check')
    seen.add(check.id)
  }
  if (seen.size !== expected.size) throw new Error('Missing isolated scenario checks')
}

/** Authenticate transport separately from validating each requested action and selector. */
function validateActionResult(result: ActionResult, request: ActionRequest): void {
  if (result.kind !== 'result' || result.id !== request.id || result.action !== request.action)
    throw new Error('Invalid worker report: unsolicited or mismatched action response')
  if (result.error !== undefined) {
    if (
      typeof result.error !== 'string' ||
      result.observations !== undefined ||
      result.preview !== undefined
    )
      throw new Error('Invalid worker report: malformed action error')
  } else {
    if (
      !Array.isArray(result.observations) ||
      result.observations.length !== request.selections.length ||
      typeof result.preview !== 'string' ||
      Buffer.byteLength(result.preview) > 2048
    )
      throw new Error('Invalid worker report: incomplete action observations')
    for (let index = 0; index < result.observations.length; index++) {
      const observation = result.observations[index]!
      if (
        !observation ||
        observation.selector !== request.selections[index]!.selector ||
        (observation.error !== undefined
          ? typeof observation.error !== 'string' || observation.value !== undefined
          : !Object.hasOwn(observation, 'value'))
      )
        throw new Error('Invalid worker report: malformed observed value')
    }
  }
}
