import type { Policy, Snapshot, Decision, Verification } from './model.ts'

export function validateVerification(verification: Verification | undefined): void {
  if (verification === undefined) return
  if (
    !verification ||
    typeof verification !== 'object' ||
    Array.isArray(verification) ||
    verification.profile !== 'isolated-scenarios-v1' ||
    !Number.isInteger(verification.workers) ||
    verification.workers < 1 ||
    verification.workers > 8 ||
    Object.keys(verification).some((key) => key !== 'profile' && key !== 'workers')
  )
    throw new Error(
      'Configuration verification requires profile "isolated-scenarios-v1" and workers from 1 to 8',
    )
}

export function validatePolicy(policy: Policy): void {
  for (const key of [
    'bootstrap',
    'bootstrapSurface',
    'perDoubling',
    'hardLimit',
    'maxFeedbackMs',
  ] as const) {
    if (!Number.isFinite(policy[key]) || policy[key] < 0) throw new Error(`Invalid policy.${key}`)
  }
  if (policy.bootstrapSurface < 1 || policy.maxFeedbackMs === 0)
    throw new Error('bootstrapSurface and maxFeedbackMs must be positive')
}
export function ceiling(surface: number, policy: Policy): number {
  return Math.floor(
    Math.min(
      policy.hardLimit,
      policy.bootstrap +
        policy.perDoubling * Math.log2(Math.max(1, surface / policy.bootstrapSurface)),
    ),
  )
}
export const retained = (snapshot: Snapshot) =>
  snapshot.source.files.reduce((total, file) => total + file.tokens, 0)

/** Pure acceptance decision. Missing facts and measured violations both block. */
export function evaluate(
  base: Snapshot | undefined,
  candidate: Snapshot,
  policy: Policy,
): Decision {
  validatePolicy(policy)
  const surface = candidate.contracts.pairs.length
  const size = retained(candidate)
  const budget = ceiling(surface, policy)
  const violations: string[] = []
  let incomplete = false
  const missing = (message: string) => {
    incomplete = true
    violations.push(message)
  }
  for (const problem of [...candidate.contracts.problems, ...candidate.source.problems])
    missing(problem)
  for (const check of candidate.contracts.checks) {
    if (!Object.hasOwn(candidate.source.actions, check.action))
      missing(`Unbound action: ${check.action}`)
  }
  try {
    validateVerification(candidate.verification)
  } catch {
    missing('Verification configuration is invalid')
  }
  const evidence = candidate.evidence
  if (
    !evidence ||
    !evidence.complete ||
    evidence.fingerprint !== candidate.fingerprint ||
    evidence.profile !== (candidate.verification?.profile ?? 'in-process-v1')
  ) {
    missing('Required evidence is missing, incomplete, or belongs to another candidate')
  } else {
    for (const boundary of candidate.source.bindingImports ?? []) {
      if (
        evidence.bindingImport?.adapter !== boundary.adapter ||
        evidence.bindingImport.file !== boundary.bindings ||
        evidence.bindingImport.fingerprint !== candidate.fingerprint
      )
        missing(`Binding import evidence is missing or mismatched: ${boundary.from}`)
    }
    const expected = new Set(candidate.contracts.checks.map((c) => c.id))
    const reported = new Set<string>()
    for (const result of evidence.checks) {
      if (reported.has(result.id) || !expected.has(result.id))
        missing(`Unexpected or duplicate evidence: ${result.id}`)
      reported.add(result.id)
    }
    for (const check of candidate.contracts.checks) {
      const result = evidence.checks.find((result) => result.id === check.id)
      if (!result || result.status === 'missing') missing(`Missing required check: ${check.id}`)
      else if (result.status !== 'passed')
        violations.push(`Failed check: ${check.id}: ${result.error ?? 'assertion failed'}`)
    }
    if (!Number.isFinite(evidence.elapsedMs) || evidence.elapsedMs < 0)
      missing('Invalid feedback measurement')
    else if (evidence.elapsedMs > policy.maxFeedbackMs)
      violations.push(
        `Feedback time ${Math.ceil(evidence.elapsedMs)}ms exceeds ${policy.maxFeedbackMs}ms`,
      )
  }
  for (const id of candidate.unrooted) violations.push(`No contract ancestry: ${id}`)
  if (size > budget) violations.push(`Retained size exceeds ceiling by ${size - budget} tokens`)
  return {
    status: incomplete ? 'incomplete' : violations.length ? 'reject' : 'pass',
    retained: size,
    ceiling: budget,
    requiredReduction: Math.max(0, size - budget),
    surface,
    violations,
    ...(base && {
      base: {
        retained: retained(base),
        surface: base.contracts.pairs.length,
        additionalCapacity: budget - ceiling(base.contracts.pairs.length, policy),
        retainedChange: size - retained(base),
      },
    }),
  }
}
