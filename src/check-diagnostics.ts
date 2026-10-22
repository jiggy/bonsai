import type { Snapshot } from './model.ts'
import { docsUrl } from './cli-interface.ts'

export type CheckDiagnostic = {
  title: string
  detail: string[]
  fix: string
}

/** Explain root causes without changing the evaluator's complete machine facts. */
export function checkDiagnostics(
  candidate: Snapshot,
  bindings: string,
  blockers: string[],
  verbose = false,
): CheckDiagnostic[] {
  const diagnostics: CheckDiagnostic[] = []
  const handled = new Set<string>()
  const featureFiles = candidate.source.files
    .map(({ file }) => file)
    .filter((file) => file.endsWith('.feature'))
  const examples = (items: string[]) => {
    const shown = verbose ? items : items.slice(0, 3)
    return [
      ...shown,
      ...(shown.length < items.length
        ? [`${items.length - shown.length} more locations. Use --verbose to show all`]
        : []),
    ]
  }
  const empty = blockers.find((message) => message === 'No executable contract cases found')
  if (empty) {
    handled.add(empty)
    diagnostics.push({
      title: featureFiles.length
        ? `No executable scenarios in ${featureFiles.length} .feature ${featureFiles.length === 1 ? 'file' : 'files'}`
        : 'No .feature files in the maintained inventory',
      detail: [
        ...examples(featureFiles),
        ...(featureFiles.length ? ["Commented starter scenarios don't run"] : []),
        ...(Object.keys(candidate.source.actions).length === 0
          ? [`No action handlers are registered in ${bindings}`]
          : []),
        'Bonsai needs runnable scenarios to check behavior and establish contract ancestry',
      ],
      fix: featureFiles.length
        ? candidate.contracts.problems.some((problem) => problem !== empty)
          ? `Fix the listed .feature errors so at least one complete scenario can run, with its action bound in ${bindings}`
          : `Add an uncommented Scenario with When I invoke and Then response steps, and bind its action in ${bindings}`
        : `Add a .feature file under a maintained path, write a runnable Scenario, and bind its action in ${bindings}`,
    })
  }
  const dynamic = blockers.filter(
    (message) =>
      message.startsWith('Dynamic import requires an adapter:') ||
      message.startsWith('Unsupported dynamic import selection:'),
  )
  if (dynamic.length) {
    dynamic.forEach((message) => handled.add(message))
    diagnostics.push({
      title: `Can't trace ${dynamic.length} runtime ${dynamic.length === 1 ? 'import' : 'imports'}`,
      detail: [
        ...examples(
          dynamic.map((message) =>
            message.replace(
              /^(?:Dynamic import requires an adapter|Unsupported dynamic import selection): /,
              '',
            ),
          ),
        ),
        "Bonsai can't determine which source components these imports retain, so behavior checks can't run",
      ],
      fix: `Use a static import for a fixed target, or a literal import with a named export. Runtime-selected targets need tracing support; see ${docsUrl.replace('/cli.md', '/roadmap.md')}`,
    })
  }
  const unbound = blockers.filter((message) => message.startsWith('Unbound action: '))
  if (unbound.length) {
    unbound.forEach((message) => handled.add(message))
    const actions = [...new Set(unbound.map((message) => message.slice('Unbound action: '.length)))]
    diagnostics.push({
      title: `${actions.length} ${actions.length === 1 ? 'action has' : 'actions have'} no executable binding`,
      detail: examples(
        actions.map((action) => {
          const check = candidate.contracts.checks.find((check) => check.action === action)
          return `${JSON.stringify(action)}${check ? ` required by ${check.file}:${check.line}` : ''}`
        }),
      ),
      fix: `Export each action from ${bindings} in the literal actions registry, mapped to a named application handler`,
    })
  }
  for (const message of blockers) {
    if (handled.has(message)) continue
    diagnostics.push({
      title: message,
      detail: [],
      fix: message.startsWith('Evidence collection interrupted:')
        ? 'Fix the interrupted verification or its feedback deadline, then rerun the check to collect complete evidence'
        : message === 'Maintained files changed during verification'
          ? 'Keep maintained files unchanged during verification and rerun the check'
          : 'Fix this analysis or verification issue, then rerun the check',
    })
  }
  return diagnostics
}
