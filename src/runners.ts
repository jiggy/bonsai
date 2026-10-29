import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
} from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { validExecutionIdentity, type ExecutionIdentity } from './identity.ts'

export type RunnerAdapter = 'vitest-json' | 'cucumber-messages' | 'stryker-json'
export type CoverageMetric = 'lines' | 'branches' | 'functions' | 'statements'
export type CoverageCounts = { total: number; covered: number; skipped: number }
export type RunnerRequirement = {
  id: string
  adapter: RunnerAdapter
  command: string[]
  report: string
  minimumMutationScore?: number
  coverage?: {
    report: string
    lines: number
    branches?: number
    functions?: number
    statements?: number
  }
}
export type RunnerFacts = {
  complete: boolean
  total: number
  passed: number
  failed: number
  skipped: number
  problems: string[]
  mutation?: {
    detected: number
    undetected: number
    invalid: number
    ignored: number
    pending: number
  }
  mutationScore?: number
}
export type RunnerEvidence = RunnerFacts & {
  schema: 'bonsai-runner-evidence-v1'
  id: string
  adapter: RunnerAdapter
  fingerprint: string
  status: 'passed' | 'failed' | 'incomplete'
  elapsedMs: number
  exitCode: number | null
  reportHash?: string
  coverageReportHash?: string
  coverage?: Record<CoverageMetric, CoverageCounts>
  identity?: ExecutionIdentity
}

const adapters: RunnerAdapter[] = ['vitest-json', 'cucumber-messages', 'stryker-json']
const metrics: CoverageMetric[] = ['lines', 'branches', 'functions', 'statements']
const maxReportBytes = 16 * 1024 * 1024
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const percent = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
function requireFact(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
const emptyFacts = (): RunnerFacts => ({
  complete: false,
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  problems: [],
})

/** Concrete report readers. These facts do not establish execution authenticity. */
export function parseRunnerReport(adapter: RunnerAdapter, input: string): RunnerFacts {
  try {
    requireFact(Buffer.byteLength(input) <= maxReportBytes, 'Report exceeds 16 MiB')
    if (adapter === 'cucumber-messages') return cucumberFacts(input)
    const report: unknown = JSON.parse(input)
    requireFact(object(report), 'Report must be an object')
    if (adapter === 'vitest-json') return vitestFacts(report)
    requireFact(adapter === 'stryker-json', 'Unsupported runner adapter')
    return strykerFacts(report)
  } catch (error) {
    return { ...emptyFacts(), problems: [`Invalid ${adapter} report: ${String(error)}`] }
  }
}

function vitestFacts(report: Record<string, unknown>): RunnerFacts {
  for (const key of [
    'numTotalTests',
    'numPassedTests',
    'numFailedTests',
    'numPendingTests',
    'numTodoTests',
    'numTotalTestSuites',
    'numPassedTestSuites',
    'numFailedTestSuites',
    'numPendingTestSuites',
  ])
    requireFact(count(report[key]), `Invalid Vitest ${key}`)
  requireFact(
    typeof report.success === 'boolean' && Array.isArray(report.testResults),
    'Missing Vitest completion facts',
  )
  const result = { ...emptyFacts(), complete: true }
  let todo = 0
  let failedFiles = 0
  for (const file of report.testResults) {
    requireFact(
      object(file) &&
        text(file.name) &&
        (file.status === 'passed' || file.status === 'failed') &&
        Array.isArray(file.assertionResults),
      'Invalid Vitest file result',
    )
    if (file.status === 'failed') failedFiles++
    for (const assertion of file.assertionResults) {
      requireFact(
        object(assertion) && typeof assertion.fullName === 'string',
        'Invalid Vitest assertion result',
      )
      requireFact(
        typeof assertion.status === 'string' &&
          ['passed', 'failed', 'pending', 'skipped', 'todo', 'disabled'].includes(assertion.status),
        'Unknown Vitest assertion status',
      )
      result.total++
      if (assertion.status === 'passed') result.passed++
      else if (assertion.status === 'failed') result.failed++
      else {
        result.skipped++
        if (assertion.status === 'todo') todo++
      }
    }
  }
  requireFact(
    report.numTotalTests === result.total &&
      report.numPassedTests === result.passed &&
      report.numFailedTests === result.failed &&
      report.numTodoTests === todo &&
      report.numPendingTests === result.skipped - todo,
    'Vitest summary does not match individual results',
  )
  requireFact(
    (report.numTotalTestSuites as number) ===
      (report.numPassedTestSuites as number) +
        (report.numFailedTestSuites as number) +
        (report.numPendingTestSuites as number),
    'Vitest suite counts disagree',
  )
  requireFact(
    (report.numFailedTestSuites as number) >= failedFiles,
    'Vitest file failures are absent from its summary',
  )
  requireFact(
    !report.success || (!result.failed && !report.numFailedTestSuites),
    'Vitest success contradicts failures',
  )
  if (!report.success && !result.failed && !report.numFailedTestSuites)
    result.problems.push('Vitest did not report a successful completed run')
  if (report.numPendingTestSuites) result.problems.push('Vitest suites remain pending')
  if (!result.total) result.problems.push('Vitest reported no tests')
  result.complete = !result.problems.length
  // A failed before/after-all hook can fail a suite without failing an assertion.
  if (report.numFailedTestSuites && !result.failed)
    result.problems.push('Vitest reported a failed test suite or hook')
  return result
}

function cucumberFacts(input: string): RunnerFacts {
  const cases = new Map<string, string[]>()
  const attempts = new Map<
    string,
    { testCase: string; started: Set<string>; results: Map<string, string>; finished: boolean }
  >()
  const hooks = new Map<string, string | undefined>()
  let meta = false,
    started = false,
    finished = false,
    success = false
  const result = { ...emptyFacts(), complete: true }
  const knownStatuses = [
    'UNKNOWN',
    'PASSED',
    'SKIPPED',
    'PENDING',
    'UNDEFINED',
    'AMBIGUOUS',
    'FAILED',
  ]
  const status = (value: unknown) => {
    requireFact(
      object(value) && typeof value.status === 'string' && knownStatuses.includes(value.status),
      'Invalid Cucumber step result',
    )
    requireFact(
      object(value.duration) &&
        count(value.duration.seconds) &&
        count(value.duration.nanos) &&
        value.duration.nanos < 1e9,
      'Invalid Cucumber step duration',
    )
    return value.status as string
  }
  for (const line of input.split(/\r?\n/).filter((line) => line.trim())) {
    const envelope: unknown = JSON.parse(line)
    requireFact(object(envelope) && Object.keys(envelope).length === 1, 'Invalid Cucumber envelope')
    const [kind, raw] = Object.entries(envelope)[0]!
    requireFact(object(raw), `Invalid Cucumber ${kind}`)
    if (kind === 'meta') {
      // These are the two protocol schemas inspected for this adapter.
      requireFact(
        !meta &&
          typeof raw.protocolVersion === 'string' &&
          /^(31|34)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(raw.protocolVersion),
        'Unsupported or duplicate Cucumber protocol metadata (expected 31.x or 34.x)',
      )
      meta = true
    } else if (kind === 'parseError') {
      throw new Error('Cucumber reported a source parse error')
    } else if (kind === 'testRunStarted') {
      requireFact(!started && !finished, 'Duplicate Cucumber run start')
      started = true
    } else if (kind === 'testCase') {
      requireFact(
        text(raw.id) && !cases.has(raw.id) && Array.isArray(raw.testSteps),
        'Invalid or duplicate Cucumber test case',
      )
      const ids = raw.testSteps.map((step) => {
        requireFact(object(step) && text(step.id), 'Invalid Cucumber test step')
        return step.id
      })
      requireFact(
        ids.length > 0 && new Set(ids).size === ids.length,
        'Cucumber test case has no steps or duplicate step identities',
      )
      cases.set(raw.id, ids)
    } else if (kind === 'testCaseStarted') {
      requireFact(
        started &&
          !finished &&
          text(raw.id) &&
          !attempts.has(raw.id) &&
          text(raw.testCaseId) &&
          cases.has(raw.testCaseId) &&
          count(raw.attempt),
        'Invalid Cucumber case start',
      )
      const prior = [...attempts.values()].filter((attempt) => attempt.testCase === raw.testCaseId)
      requireFact(
        raw.attempt === prior.length && prior.every((attempt) => attempt.finished),
        'Cucumber attempt order is missing or duplicated',
      )
      attempts.set(raw.id, {
        testCase: raw.testCaseId,
        started: new Set(),
        results: new Map(),
        finished: false,
      })
    } else if (kind === 'testStepStarted' || kind === 'testStepFinished') {
      requireFact(
        !finished && text(raw.testCaseStartedId) && text(raw.testStepId),
        'Invalid Cucumber step identity',
      )
      const attempt = attempts.get(raw.testCaseStartedId)
      requireFact(
        attempt && !attempt.finished && cases.get(attempt.testCase)!.includes(raw.testStepId),
        'Cucumber result refers to an unknown or finished case/step',
      )
      if (kind === 'testStepStarted') {
        requireFact(!attempt.started.has(raw.testStepId), 'Duplicate Cucumber step start')
        attempt.started.add(raw.testStepId)
      } else {
        requireFact(
          attempt.started.has(raw.testStepId) && !attempt.results.has(raw.testStepId),
          'Missing start or duplicate Cucumber step result',
        )
        attempt.results.set(raw.testStepId, status(raw.testStepResult))
      }
    } else if (kind === 'testCaseFinished') {
      requireFact(
        !finished && text(raw.testCaseStartedId) && typeof raw.willBeRetried === 'boolean',
        'Invalid Cucumber case finish',
      )
      const attempt = attempts.get(raw.testCaseStartedId)
      requireFact(
        attempt &&
          !attempt.finished &&
          attempt.results.size === cases.get(attempt.testCase)!.length,
        'Cucumber case finished without every step result',
      )
      attempt.finished = true
      if (raw.willBeRetried) result.problems.push('Cucumber reported a retried attempt')
    } else if (kind === 'testRunHookStarted') {
      requireFact(
        started && !finished && text(raw.id) && !hooks.has(raw.id),
        'Invalid Cucumber run hook start',
      )
      hooks.set(raw.id, undefined)
    } else if (kind === 'testRunHookFinished') {
      requireFact(
        !finished &&
          text(raw.testRunHookStartedId) &&
          hooks.has(raw.testRunHookStartedId) &&
          hooks.get(raw.testRunHookStartedId) === undefined,
        'Invalid Cucumber run hook finish',
      )
      hooks.set(raw.testRunHookStartedId, status(raw.result))
    } else if (kind === 'testRunFinished') {
      requireFact(
        started && !finished && typeof raw.success === 'boolean',
        'Invalid Cucumber run finish',
      )
      finished = true
      success = raw.success
      if (raw.exception !== undefined) result.problems.push('Cucumber run reported an exception')
    }
  }
  requireFact(
    meta && started && finished && attempts.size > 0 && cases.size > 0,
    'Cucumber run lifecycle is missing or contains no test cases',
  )
  for (const attempt of attempts.values()) {
    requireFact(attempt.finished, 'Cucumber case has not finished')
    result.total++
    const statuses = [...attempt.results.values()]
    if (statuses.some((s) => ['FAILED', 'AMBIGUOUS', 'UNDEFINED'].includes(s))) result.failed++
    else if (statuses.some((s) => s !== 'PASSED')) result.skipped++
    else result.passed++
  }
  for (const id of cases.keys())
    requireFact(
      [...attempts.values()].some((attempt) => attempt.testCase === id),
      'Cucumber declared a test case that never ran',
    )
  for (const hook of hooks.values())
    requireFact(hook === 'PASSED', 'Cucumber run hook did not pass')
  requireFact(!success || !result.failed, 'Cucumber success contradicts failed steps')
  if (!success && !result.failed) result.problems.push('Cucumber did not report a successful run')
  result.complete = !result.problems.length
  return result
}

function strykerFacts(report: Record<string, unknown>): RunnerFacts {
  requireFact(
    typeof report.schemaVersion === 'string' &&
      /^[12](?:\.(?:0|[1-9]\d*)){0,2}$/.test(report.schemaVersion),
    'Unsupported Stryker report schema (expected 1.x or 2.x)',
  )
  requireFact(
    object(report.files) &&
      object(report.thresholds) &&
      percent(report.thresholds.high) &&
      percent(report.thresholds.low),
    'Missing Stryker files or thresholds',
  )
  const result = {
    ...emptyFacts(),
    complete: true,
    mutation: { detected: 0, undetected: 0, invalid: 0, ignored: 0, pending: 0 },
  }
  for (const [file, value] of Object.entries(report.files)) {
    requireFact(
      text(file) &&
        object(value) &&
        text(value.language) &&
        typeof value.source === 'string' &&
        Array.isArray(value.mutants),
      'Invalid Stryker file',
    )
    const ids = new Set<string>()
    for (const mutant of value.mutants) {
      requireFact(
        object(mutant) &&
          text(mutant.id) &&
          !ids.has(mutant.id) &&
          text(mutant.mutatorName) &&
          object(mutant.location),
        'Invalid or duplicate Stryker mutant',
      )
      ids.add(mutant.id)
      for (const position of [mutant.location.start, mutant.location.end])
        requireFact(
          object(position) &&
            count(position.line) &&
            position.line > 0 &&
            count(position.column) &&
            position.column > 0,
          'Invalid Stryker mutant location',
        )
      result.total++
      if (mutant.status === 'Killed' || mutant.status === 'Timeout') result.mutation.detected++
      else if (mutant.status === 'Survived' || mutant.status === 'NoCoverage')
        result.mutation.undetected++
      else if (mutant.status === 'CompileError' || mutant.status === 'RuntimeError')
        result.mutation.invalid++
      else if (mutant.status === 'Ignored') result.mutation.ignored++
      else if (mutant.status === 'Pending') result.mutation.pending++
      else throw new Error('Unknown Stryker mutant status')
    }
  }
  result.passed = result.mutation.detected
  result.failed = result.mutation.undetected
  result.skipped = result.mutation.invalid + result.mutation.ignored + result.mutation.pending
  const valid = result.passed + result.failed
  return { ...result, ...(valid > 0 && { mutationScore: (100 * result.passed) / valid }) }
}

export function validateRunnerRequirements(
  value: unknown,
): asserts value is RunnerRequirement[] | undefined {
  if (value === undefined) return
  requireFact(Array.isArray(value), 'runners must be an array')
  const ids = new Set<string>(),
    reports = new Set<string>()
  for (const requirement of [...value]) {
    requireFact(
      object(requirement) &&
        text(requirement.id) &&
        !ids.has(requirement.id) &&
        adapters.includes(requirement.adapter as RunnerAdapter),
      'Each runner needs a unique id and a supported adapter',
    )
    ids.add(requirement.id)
    requireFact(
      Array.isArray(requirement.command) &&
        requirement.command.length > 0 &&
        [...requirement.command].every(
          (part) => typeof part === 'string' && !part.includes('\0'),
        ) &&
        text(requirement.command[0]),
      `Runner ${requirement.id} needs a command argument array`,
    )
    const path = (value: unknown) => {
      requireFact(
        text(value) &&
          !isAbsolute(value) &&
          !value.includes('\\') &&
          !value.includes('\0') &&
          value.split('/').every((part) => part !== '..' && part !== '.' && part.length > 0),
        'Runner reports need project-relative file paths without traversal',
      )
      requireFact(!reports.has(value), `Runner report path is shared: ${value}`)
      reports.add(value)
    }
    path(requirement.report)
    if (requirement.adapter === 'stryker-json')
      requireFact(
        percent(requirement.minimumMutationScore),
        `Runner ${requirement.id} needs minimumMutationScore between 0 and 100`,
      )
    else
      requireFact(
        requirement.minimumMutationScore === undefined,
        'minimumMutationScore requires the stryker-json adapter',
      )
    if (requirement.coverage !== undefined) {
      requireFact(
        requirement.adapter === 'vitest-json' &&
          object(requirement.coverage) &&
          percent(requirement.coverage.lines),
        'Coverage requires vitest-json and a lines percentage floor',
      )
      path(requirement.coverage.report)
      for (const metric of metrics)
        requireFact(
          requirement.coverage[metric] === undefined || percent(requirement.coverage[metric]),
          `Invalid coverage floor: ${metric}`,
        )
      requireFact(
        Object.keys(requirement.coverage).every(
          (key) => key === 'report' || metrics.includes(key as CoverageMetric),
        ),
        'Unknown coverage requirement',
      )
    }
    requireFact(
      Object.keys(requirement).every((key) =>
        ['id', 'adapter', 'command', 'report', 'minimumMutationScore', 'coverage'].includes(key),
      ),
      'Unknown runner requirement',
    )
  }
}

function validCoverage(value: unknown): value is Record<CoverageMetric, CoverageCounts> {
  return (
    object(value) &&
    metrics.every((metric) => {
      const counts = value[metric]
      return (
        object(counts) &&
        count(counts.total) &&
        count(counts.covered) &&
        count(counts.skipped) &&
        counts.covered <= counts.total &&
        counts.skipped <= counts.total
      )
    })
  )
}

export function validRunnerEvidence(value: unknown): value is RunnerEvidence {
  if (
    !object(value) ||
    value.schema !== 'bonsai-runner-evidence-v1' ||
    !text(value.id) ||
    !adapters.includes(value.adapter as RunnerAdapter) ||
    !text(value.fingerprint) ||
    typeof value.status !== 'string' ||
    !['passed', 'failed', 'incomplete'].includes(value.status) ||
    typeof value.complete !== 'boolean' ||
    typeof value.elapsedMs !== 'number' ||
    !Number.isFinite(value.elapsedMs) ||
    value.elapsedMs < 0 ||
    (value.exitCode !== null && !count(value.exitCode)) ||
    !Array.isArray(value.problems) ||
    ![...value.problems].every((problem) => typeof problem === 'string')
  )
    return false
  if (
    !['total', 'passed', 'failed', 'skipped'].every((key) => count(value[key])) ||
    value.total !== (value.passed as number) + (value.failed as number) + (value.skipped as number)
  )
    return false
  if (
    value.reportHash !== undefined &&
    (typeof value.reportHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.reportHash))
  )
    return false
  if (
    value.coverageReportHash !== undefined &&
    (typeof value.coverageReportHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.coverageReportHash))
  )
    return false
  if (value.coverage !== undefined && !validCoverage(value.coverage)) return false
  if (value.identity !== undefined && !validExecutionIdentity(value.identity)) return false
  if (value.adapter === 'stryker-json' && value.complete) {
    if (
      !object(value.mutation) ||
      !['detected', 'undetected', 'invalid', 'ignored', 'pending'].every((key) =>
        count((value.mutation as Record<string, unknown>)[key]),
      )
    )
      return false
    const mutation = value.mutation as NonNullable<RunnerEvidence['mutation']>
    if (
      value.passed !== mutation.detected ||
      value.failed !== mutation.undetected ||
      value.skipped !== mutation.invalid + mutation.ignored + mutation.pending
    )
      return false
    const valid = mutation.detected + mutation.undetected
    if (
      valid > 0 &&
      (!percent(value.mutationScore) ||
        Math.abs(value.mutationScore - (100 * mutation.detected) / valid) > 1e-9)
    )
      return false
    if (valid === 0 && value.mutationScore !== undefined) return false
  } else if (value.mutationScore !== undefined && !percent(value.mutationScore)) return false
  return true
}

/** Reapply gate requirements from facts; a serialized status cannot authorize a pass. */
function assessRunnerEvidence(
  requirement: RunnerRequirement,
  evidence: unknown,
): { status: RunnerEvidence['status']; problems: string[] } {
  try {
    validateRunnerRequirements([requirement])
  } catch (error) {
    return { status: 'incomplete', problems: [String(error)] }
  }
  const problems: string[] = []
  let incomplete = false
  const missing = (problem: string) => {
    incomplete = true
    problems.push(problem)
  }
  if (
    !validRunnerEvidence(evidence) ||
    evidence.id !== requirement.id ||
    evidence.adapter !== requirement.adapter
  )
    return {
      status: 'incomplete',
      problems: [`Invalid or mismatched runner evidence: ${requirement.id}`],
    }
  if (!evidence.complete || !evidence.reportHash || !evidence.total)
    missing('Required runner report is missing, incomplete, or contains no observations')
  if (evidence.problems.length) {
    incomplete = true
    problems.push(...evidence.problems)
  }
  if (evidence.exitCode === null) missing('Runner did not exit normally')
  else if (evidence.exitCode !== 0) problems.push(`Runner exited with code ${evidence.exitCode}`)
  if (evidence.skipped)
    missing(`Runner left ${evidence.skipped} skipped, pending, ignored, or invalid observations`)
  if (requirement.adapter !== 'stryker-json' && evidence.failed)
    problems.push(`Runner reported ${evidence.failed} failed tests`)
  if (requirement.adapter === 'stryker-json') {
    if (evidence.mutationScore === undefined)
      missing('Mutation report has no valid score denominator')
    else if (evidence.mutationScore < requirement.minimumMutationScore!)
      problems.push(
        `Mutation score ${evidence.mutationScore} is below ${requirement.minimumMutationScore}`,
      )
  }
  if (requirement.coverage) {
    if (!evidence.coverage || !evidence.coverageReportHash)
      missing('Required coverage summary is missing')
    else
      for (const metric of metrics) {
        const floor = requirement.coverage[metric]
        if (floor === undefined) continue
        const counts = evidence.coverage[metric]
        if (!counts.total) missing(`Coverage ${metric} has no measured denominator`)
        else if ((100 * counts.covered) / counts.total < floor)
          problems.push(`Coverage ${metric} is below ${floor}`)
      }
  }
  return { status: incomplete ? 'incomplete' : problems.length ? 'failed' : 'passed', problems }
}

export function runnerViolations(
  requirement: RunnerRequirement,
  evidence: unknown,
): { status: RunnerEvidence['status']; problems: string[] } {
  const result = assessRunnerEvidence(requirement, evidence)
  if (validRunnerEvidence(evidence) && evidence.status !== result.status)
    return {
      status: 'incomplete',
      problems: [
        ...result.problems,
        'Runner status contradicts its reported facts and configured requirements',
      ],
    }
  return result
}

/** Reject symlinked report paths before deletion and before reading fresh output. */
function reportPath(root: string, file: string): string {
  const canonicalRoot = realpathSync(root)
  const absolute = resolve(root, file)
  requireFact(
    !isAbsolute(relative(resolve(root), absolute)) &&
      !relative(resolve(root), absolute).startsWith('..' + sep),
    'Runner report escapes project root',
  )
  let path = resolve(root)
  for (const part of file.split('/')) {
    path = resolve(path, part)
    try {
      requireFact(!lstatSync(path).isSymbolicLink(), `Runner report path is a symlink: ${file}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }
  let parent = absolute
  while (true) {
    try {
      const actual = realpathSync(parent)
      requireFact(
        actual === canonicalRoot || actual.startsWith(canonicalRoot + sep),
        'Runner report escapes project root',
      )
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const next = resolve(parent, '..')
      requireFact(next !== parent, 'Runner report has no project parent')
      parent = next
    }
  }
  return absolute
}

function clearReport(root: string, file: string): void {
  const path = reportPath(root, file)
  try {
    requireFact(lstatSync(path).isFile(), `Runner report must be a regular file: ${file}`)
    unlinkSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function readReport(root: string, file: string): { content: string; hash: string } {
  const path = reportPath(root, file)
  requireFact(lstatSync(path).isFile(), `Runner report must be a regular file: ${file}`)
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  )
  try {
    const stat = fstatSync(descriptor)
    requireFact(
      stat.isFile() && stat.size <= maxReportBytes,
      `Runner report must be a regular file of at most 16 MiB: ${file}`,
    )
    const buffer = Buffer.allocUnsafe(stat.size + 1)
    let length = 0
    while (length < buffer.length) {
      const received = readSync(descriptor, buffer, length, buffer.length - length, null)
      if (!received) break
      length += received
    }
    requireFact(
      length === stat.size && fstatSync(descriptor).size === stat.size,
      'Runner report changed while reading',
    )
    const content = buffer.subarray(0, length)
    return {
      content: new TextDecoder('utf-8', { fatal: true }).decode(content),
      hash: createHash('sha256').update(content).digest('hex'),
    }
  } finally {
    closeSync(descriptor)
  }
}

async function runCommand(
  root: string,
  command: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ code: number | null; diagnostic?: string }> {
  const began = performance.now()
  requireFact(
    timeoutMs > 0 && !signal?.aborted,
    'Supporting verification deadline expired or was cancelled',
  )
  return new Promise((resolveResult, reject) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    const closed = new Promise<void>((done) => child.once('close', () => done()))
    let output = Buffer.alloc(0)
    for (const stream of [child.stdout!, child.stderr!])
      stream.on('data', (chunk: Buffer) => {
        output = Buffer.from(Buffer.concat([output, chunk]).subarray(-4096))
      })
    let settled = false
    const kill = (kind: NodeJS.Signals) => {
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, kind)
        } catch {}
      }
      child.kill(kind)
    }
    const stop = () => kill('SIGKILL')
    process.once('exit', stop)
    const finish = (error?: Error, code: number | null = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      stop()
      void closed.then(() => {
        process.removeListener('exit', stop)
        if (error) reject(error)
        else
          resolveResult({
            code,
            ...(output.length > 0 && {
              diagnostic: JSON.stringify(output.toString('utf8')),
            }),
          })
      })
    }
    const timer = setTimeout(
      () => finish(new Error('Supporting verification feedback deadline expired')),
      Math.max(0, timeoutMs - (performance.now() - began)),
    )
    const abort = () => finish(new Error('Supporting verification cancelled'))
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => finish(undefined, code))
    if (signal?.aborted) abort()
  })
}

/** Run concrete configured runners, preserving their facts separately from product checks. */
export async function runSupportingVerification(
  root: string,
  requirements: RunnerRequirement[],
  fingerprint: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RunnerEvidence[]> {
  const began = performance.now()
  validateRunnerRequirements(requirements)
  const results: RunnerEvidence[] = []
  for (const requirement of requirements) {
    const started = performance.now()
    const evidence: RunnerEvidence = {
      ...emptyFacts(),
      schema: 'bonsai-runner-evidence-v1',
      id: requirement.id,
      adapter: requirement.adapter,
      fingerprint,
      status: 'incomplete',
      elapsedMs: 0,
      exitCode: null,
    }
    let diagnostic: string | undefined
    try {
      requireFact(
        timeoutMs - (performance.now() - began) > 0 && !signal?.aborted,
        'Supporting verification deadline expired or was cancelled',
      )
      clearReport(root, requirement.report)
      if (requirement.coverage) clearReport(root, requirement.coverage.report)
      const execution = await runCommand(
        root,
        requirement.command,
        timeoutMs - (performance.now() - began),
        signal,
      )
      evidence.exitCode = execution.code
      diagnostic = execution.diagnostic
      requireFact(
        timeoutMs - (performance.now() - began) > 0 && !signal?.aborted,
        'Supporting verification deadline expired or was cancelled',
      )
      const report = readReport(root, requirement.report)
      Object.assign(evidence, parseRunnerReport(requirement.adapter, report.content), {
        reportHash: report.hash,
      })
      if (requirement.coverage) {
        const coverage = readReport(root, requirement.coverage.report)
        const parsed: unknown = JSON.parse(coverage.content)
        requireFact(
          object(parsed) && validCoverage(parsed.total),
          'Invalid Istanbul coverage summary',
        )
        evidence.coverage = parsed.total
        evidence.coverageReportHash = coverage.hash
      }
      requireFact(
        timeoutMs - (performance.now() - began) > 0 && !signal?.aborted,
        'Supporting verification deadline expired or was cancelled',
      )
    } catch (error) {
      evidence.complete = false
      evidence.problems.push(String(error))
      if (diagnostic) evidence.problems.push(`Runner output (last 4096 bytes): ${diagnostic}`)
    }
    evidence.elapsedMs = performance.now() - started
    evidence.status = assessRunnerEvidence(requirement, evidence).status
    results.push(evidence)
  }
  return results
}
