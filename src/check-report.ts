import type { CheckTiming, Decision, Snapshot, TimingStage } from './model.ts'
import type { HumanLine } from './cli-interface.ts'
import { checkDiagnostics, type CheckDiagnostic } from './check-diagnostics.ts'

type Options = {
  bindings: string
  verbose: boolean
  limit: number
  invocation: (words: string[]) => string
}
const line = (text: string, role: Exclude<HumanLine, string>['role'] = 'text'): HumanLine => ({
  text,
  role,
})
const bounded = <T>(items: T[], limit: number) => (limit ? items.slice(0, limit) : items)
const tree = (
  items: string[],
  role: Exclude<HumanLine, string>['role'] = 'text',
  depth = 1,
): HumanLine[] =>
  items.map((text, index) =>
    line(`${'  '.repeat(depth)}${index === items.length - 1 ? '└─' : '├─'} ${text}`, role),
  )

export const duration = (milliseconds: number) =>
  milliseconds < 1000 ? `${Math.round(milliseconds)}ms` : `${(milliseconds / 1000).toFixed(1)}s`

/** Presentation only: the caller supplies measured facts, including partial failures. */
export function timingLines(timing: CheckTiming): HumanLine[] {
  const labels: Record<string, string> = {
    setup: 'Command setup',
    'base-archive': 'Base archive',
    configuration: 'Configuration',
    base: 'Base analysis',
    candidate: 'Candidate check',
    inventory: 'Inventory',
    fingerprint: 'Snapshot fingerprint',
    contracts: 'Contract compilation',
    source: 'Source analysis',
    retention: 'Contract ancestry',
    verification: 'Verification',
    integrity: 'Final integrity check',
    evaluation: 'Policy evaluation',
    report: 'Report preparation',
    output: 'Report delivery',
  }
  const stages = (items: TimingStage[], depth = 1): HumanLine[] =>
    items.flatMap((stage, index) => [
      line(
        `${'  '.repeat(depth)}${index === items.length - 1 ? '└─' : '├─'} ${labels[stage.name] ?? stage.name}: ${stage.elapsedMs === null ? 'not run' : duration(stage.elapsedMs)}${stage.status === 'interrupted' ? ' (interrupted)' : stage.status === 'running' ? ' (in progress)' : ''}`,
        stage.status === 'interrupted' ? 'warning' : 'text',
      ),
      ...(stage.stages ? stages(stage.stages, depth + 1) : []),
    ])
  return [
    line('Timing', 'heading'),
    ...stages(timing.stages),
    ...(timing.feedback
      ? [
          line(
            `Feedback window: ${duration(timing.feedback.elapsedMs)} / ${duration(timing.feedback.limitMs)}`,
          ),
        ]
      : []),
  ]
}

export function withTiming(lines: HumanLine[], timing: CheckTiming, verbose: boolean): HumanLine[] {
  const output = [...lines]
  let summary = output.findIndex((item) => typeof item !== 'string' && item.role === 'summary')
  if (summary < 0) {
    output.push('', line(`${duration(timing.elapsedMs)} elapsed`, 'summary'))
    summary = output.length - 1
  } else {
    const item = output[summary] as Exclude<HumanLine, string>
    output[summary] = { ...item, text: `${item.text} · ${duration(timing.elapsedMs)} elapsed` }
  }
  if (verbose) output.splice(summary, 0, ...timingLines(timing), '')
  return output
}

/** A human report groups causes; the evaluator's full JSON facts remain independent. */
export function checkReport(candidate: Snapshot, decision: Decision, options: Options) {
  const { verbose, limit, invocation } = options
  const passed = candidate.evidence?.checks.filter((check) => check.status === 'passed').length ?? 0
  const expected = candidate.contracts.checks.length
  const incomplete = decision.status === 'incomplete'
  const unbound = candidate.contracts.checks.filter(
    (check) => !Object.hasOwn(candidate.source.actions, check.action),
  )
  const secondary = new Set([
    ...candidate.unrooted.map((id) => `No contract ancestry: ${id}`),
    `Retained size exceeds ceiling by ${decision.requiredReduction} tokens`,
    ...(candidate.contracts.problems.length || candidate.source.problems.length
      ? ['Required evidence is missing, incomplete, or belongs to another candidate']
      : []),
    ...unbound.flatMap((check) => {
      const result = candidate.evidence?.checks.find((result) => result.id === check.id)
      return [
        `Missing required check: ${check.id}`,
        ...(result && result.status !== 'passed'
          ? [`Failed check: ${check.id}: ${result.error ?? 'assertion failed'}`]
          : []),
      ]
    }),
  ])
  const blockers = [
    ...new Set(decision.violations.filter((message) => !incomplete || !secondary.has(message))),
  ]
  const diagnostics: CheckDiagnostic[] = incomplete
    ? checkDiagnostics(candidate, options.bindings, blockers, verbose, limit)
    : []
  const accounted = new Set<string>()
  if (!incomplete) {
    if (decision.requiredReduction) {
      diagnostics.push({
        title: `Retained code exceeds the ceiling by ${decision.requiredReduction} tokens`,
        detail: [],
        fix: `Reclaim at least ${decision.requiredReduction} tokens while preserving required behavior`,
      })
      accounted.add(`Retained size exceeds ceiling by ${decision.requiredReduction} tokens`)
    }
    const failed = candidate.evidence?.checks.filter((check) => check.status === 'failed') ?? []
    if (failed.length) {
      diagnostics.push({
        title: `${failed.length} required ${failed.length === 1 ? 'observation failed' : 'observations failed'}`,
        detail: bounded(failed, limit).flatMap((result) => {
          const check = candidate.contracts.checks.find((check) => check.id === result.id)!
          return [
            `${check.file}:${check.line} — ${check.action} → response.${check.selector} — expected ${JSON.stringify(check.expected)}`,
            ...(verbose && result.error ? result.error.split('\n').filter(Boolean) : []),
          ]
        }),
        fix: 'Restore the required handler behavior at the listed contract observations',
      })
      failed.forEach((result) =>
        accounted.add(`Failed check: ${result.id}: ${result.error ?? 'assertion failed'}`),
      )
    }
    if (candidate.unrooted.length) {
      diagnostics.push({
        title: `${candidate.unrooted.length} components have no contract ancestry`,
        detail: [],
        fix: 'Remove unsupported code or connect it to required behavior through an executable contract',
      })
      candidate.unrooted.forEach((id) => accounted.add(`No contract ancestry: ${id}`))
    }
    for (const message of blockers.filter((message) => !accounted.has(message)))
      diagnostics.push({
        title: message,
        detail: [],
        fix: message.startsWith('Feedback time')
          ? 'Shorten verification while preserving required checks. Treat any policy change as a separate decision'
          : 'Inspect the reported requirement and restore its required verification',
      })
  }
  const problems: HumanLine[] = bounded(diagnostics, limit).flatMap((diagnostic) => [
    line(`✗ ${diagnostic.title}`, 'error'),
    ...diagnostic.detail.map((detail) => line(`  ├─ ${detail}`, 'detail')),
    line(`  └─ Fix: ${diagnostic.fix}`),
  ])
  if (limit && diagnostics.length > limit)
    problems.push(
      line(`${diagnostics.length - limit} more blockers. Use --limit 0 to show all`, 'detail'),
    )
  const interrupted = candidate.source.problems.some((problem) =>
    problem.startsWith('Evidence collection interrupted:'),
  )
  const results = candidate.evidence
    ? incomplete
      ? (['passed', 'failed', 'missing'] as const)
          .flatMap((status) => {
            const count = candidate.evidence!.checks.filter(
              (check) => check.status === status,
            ).length
            return count ? [`${count} ${status}`] : []
          })
          .join(' · ') + ` (${expected} expected)`
      : `${passed} / ${expected} passed`
    : interrupted
      ? `not completed (${expected} expected)`
      : `not run (${expected} expected)`
  const lines: HumanLine[] = [
    line(
      decision.status === 'pass' ? '✓ Pass' : incomplete ? '△ Incomplete' : '✗ Rejected',
      decision.status === 'pass' ? 'success' : incomplete ? 'warning' : 'error',
    ),
    line(`  ├─ Required checks: ${results}`),
    line(`  └─ Contract surface: ${decision.surface} ${decision.surface === 1 ? 'pair' : 'pairs'}`),
  ]
  if (problems.length) lines.push('', line('Blocking issues', 'heading'), ...problems)
  lines.push(
    '',
    line('Inventory measurements', 'heading'),
    ...tree([
      `Retained: ${decision.retained} tokens`,
      `Configured ceiling: ${decision.ceiling} tokens`,
      ...(decision.base
        ? [
            `Retained change: ${decision.base.retainedChange}`,
            `Additional capacity: ${decision.base.additionalCapacity}`,
          ]
        : []),
    ]),
  )
  if (incomplete && (candidate.unrooted.length || decision.requiredReduction)) {
    lines.push('', line('△ Budget and ancestry findings are provisional', 'warning'))
    if (decision.requiredReduction)
      lines.push(line(`  ├─ Potential overage: ${decision.requiredReduction} tokens (provisional)`))
    lines.push(line(`  └─ ${candidate.unrooted.length} components without traced contracts`))
  }
  if ((verbose || !incomplete) && candidate.unrooted.length) {
    const groups = new Map<string, string[]>()
    for (const id of candidate.unrooted) {
      const component = candidate.source.components.find((component) => component.id === id)
      const separator = id.lastIndexOf('#')
      const file = component?.file ?? id.slice(0, separator)
      const name = component?.name ?? id.slice(separator + 1)
      groups.set(file, [...(groups.get(file) ?? []), name])
    }
    lines.push(
      '',
      line(incomplete ? 'Additional findings (provisional)' : 'Contract ancestry', 'heading'),
    )
    let remaining = limit || Infinity
    for (const [groupIndex, [file, names]] of [...groups].entries()) {
      if (!remaining) break
      const shown = names.slice(0, remaining)
      remaining -= shown.length
      lines.push(
        line(
          `  ${groupIndex < groups.size - 1 || (limit && candidate.unrooted.length > limit) ? '├─' : '└─'} No contract ancestry: ${file} (${names.length} components)`,
        ),
        ...tree(shown, 'detail', 2),
      )
    }
    if (limit && candidate.unrooted.length > limit)
      lines.push(
        line(
          `  └─ ${candidate.unrooted.length - limit} more components. Use --limit 0 to show all`,
          'detail',
        ),
      )
  }
  if (verbose && candidate.evidence) {
    lines.push('', line('Check results', 'heading'))
    const shown = bounded(candidate.evidence.checks, limit)
    lines.push(
      ...shown.map((result) =>
        line(
          `  ${result === shown.at(-1) && shown.length === candidate.evidence!.checks.length ? '└─' : '├─'} ${result.id}: ${result.status}`,
          result.status === 'failed' ? 'error' : 'detail',
        ),
      ),
    )
    if (shown.length < candidate.evidence.checks.length)
      lines.push(
        line(
          `  └─ ${candidate.evidence.checks.length - shown.length} more results. Use --limit 0 to show all`,
          'detail',
        ),
      )
  }
  const summary = [
    ...(diagnostics.length
      ? [`${diagnostics.length} ${diagnostics.length === 1 ? 'blocker' : 'blockers'}`]
      : []),
    ...(candidate.evidence && passed
      ? [`${passed} checks passed`]
      : !candidate.evidence && expected
        ? [`${expected} checks ${interrupted ? 'not completed' : 'not run'}`]
        : []),
  ]
  if (summary.length) lines.push('', line(summary.join(' · '), 'summary'))
  if (decision.status !== 'pass') {
    const onlyAncestry =
      !incomplete &&
      !decision.requiredReduction &&
      blockers.every((message) => message.startsWith('No contract ancestry:'))
    const recovery = invocation(
      onlyAncestry && candidate.unrooted[0]
        ? ['explain', candidate.unrooted[0]]
        : !verbose &&
            candidate.source.problems.some((problem) =>
              problem.includes('feedback deadline expired'),
            )
          ? ['check', '--verbose']
          : ['check'],
    )
    lines.push('', line(`Next → ${recovery}`, 'command'))
  }
  return { lines, problems }
}
