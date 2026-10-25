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
  limit = 20,
): CheckDiagnostic[] {
  const diagnostics: CheckDiagnostic[] = []
  const handled = new Set<string>()
  const featureFiles = candidate.source.files
    .map(({ file }) => file)
    .filter((file) => file.endsWith('.feature'))
  const examples = (items: string[]) => {
    const shown = items.slice(0, verbose ? limit || items.length : Math.min(3, limit || 3))
    return [
      ...shown,
      ...(shown.length < items.length
        ? [`${items.length - shown.length} more locations. Use --verbose --limit 0 to show all`]
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
  for (const [prefix, title, fix] of [
    [
      'Rust checker unsupported: ',
      "Rust checker doesn't support this source",
      `Use --engine typescript for this project, or add support for the reported source form. See ${docsUrl.replace('/cli.md', '/native-prototype.md')}`,
    ],
    [
      'Rust checker interrupted: ',
      'Rust source check stopped before completion',
      'Use --verbose to inspect phase timings, then shorten source collection while preserving the required checks',
    ],
  ] as const) {
    const messages = blockers.filter((message) => message.startsWith(prefix))
    if (!messages.length) continue
    messages.forEach((message) => handled.add(message))
    diagnostics.push({
      title,
      detail: [
        ...examples(messages.map((message) => message.slice(prefix.length))),
        "Rust analysis is incomplete, so behavior checks can't run",
        'Measurements and ancestry below are provisional',
      ],
      fix,
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
          dynamic.map((message) => {
            const raw = message.replace(
              /^(?:Dynamic import requires an adapter|Unsupported dynamic import selection): /,
              '',
            )
            const location = raw.match(/^(.+?)#(.+?) at (.+?:\d+(?::\d+)?) — (.+)$/)
            return location
              ? `${location[3]} — ${location[2]}${verbose ? `: ${location[4]}` : ''}`
              : raw
          }),
        ),
        "Bonsai can't determine which source components these imports retain, so behavior checks can't run",
      ],
      fix: `Use a static import for a fixed target, or a literal import with a named export. Runtime-selected targets need tracing support. See ${docsUrl.replace('/cli.md', '/roadmap.md')}`,
    })
  }
  const subprocess = blockers.filter(
    (message) =>
      message.startsWith('Subprocess entry point outside maintained inventory:') ||
      message.startsWith('Unsupported subprocess entry point:'),
  )
  if (subprocess.length) {
    subprocess.forEach((message) => handled.add(message))
    diagnostics.push({
      title: `Can't trace ${subprocess.length} local subprocess ${subprocess.length === 1 ? 'entry point' : 'entry points'}`,
      detail: [
        ...examples(subprocess),
        "Bonsai needs the selected child's maintained TypeScript source before behavior checks can run",
      ],
      fix: 'Correct the module-relative entry path and include its TypeScript source in the reviewed maintained scope. Other source languages need tracing support',
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
  const registry = blockers.filter(
    (message) =>
      message === 'Each action binding must be a literal key and named handler' ||
      message === 'No exported actions registry found' ||
      message.startsWith('Cannot resolve action handler:'),
  )
  if (registry.length) {
    registry.forEach((message) => handled.add(message))
    diagnostics.push({
      title: "Can't resolve action registrations",
      detail: [bindings, ...examples(registry)],
      fix: 'Export const actions with static keys and named imported handlers, for example: export const actions = { check: handler }. Computed keys, spreads, and inline handlers need a supported registration',
    })
  }
  const dependencies = blockers.filter((message) =>
    message.startsWith('Local dependency outside maintained inventory:'),
  )
  if (dependencies.length) {
    dependencies.forEach((message) => handled.add(message))
    diagnostics.push({
      title: `${dependencies.length} local dependencies are outside the maintained inventory`,
      detail: examples(
        dependencies.map((message) =>
          message.slice('Local dependency outside maintained inventory: '.length),
        ),
      ),
      fix: 'Include these authored dependencies in the reviewed maintained scope, or remove their imports. Keep trusted base policy changes explicit',
    })
  }
  for (const message of blockers) {
    if (handled.has(message)) continue
    diagnostics.push({
      title: message,
      detail: [],
      fix: message.startsWith('Evidence collection interrupted:')
        ? message.includes('feedback deadline expired')
          ? 'Use --verbose to inspect phase timings, then shorten verification while preserving required checks'
          : 'Fix the interrupted verification or its feedback deadline, then rerun the check to collect complete evidence'
        : message === 'Maintained files changed during verification'
          ? 'Keep maintained files unchanged during verification and rerun the check'
          : message.startsWith('Unsupported source language:')
            ? `Add source-language ancestry support before rerunning this check. These files stay measured. See ${docsUrl.replace('/cli.md', '/roadmap.md')}`
            : /\.[cm]?ts:\d+:/.test(message)
              ? 'Correct the TypeScript error at the reported source location and rerun the check'
              : message.startsWith('Required evidence') ||
                  message.startsWith('Missing required check')
                ? 'Rerun verification for this candidate and ensure every declared observation produces a result'
                : 'Resolve the reported source construct using the supported TypeScript adapter, then rerun the check',
    })
  }
  return diagnostics
}
