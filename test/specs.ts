import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { compileContracts } from '../src/contracts.ts'
import { runEvidence } from '../src/evidence.ts'
import { fingerprint, inventory } from '../src/inventory.ts'
import { readConfig } from '../src/project.ts'
import type { ContractCase, Contracts } from '../src/model.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))
type Selection = string | ((scenario: ContractCase) => boolean)

/** Load the authored product contracts without replacing their bindings or outcomes. */
export function loadSpecifications(root = repository) {
  const location = realpathSync(resolve(root))
  const config = readConfig(location)
  const files = inventory(location, config.maintained, config.exclude)
  const contracts = compileContracts(
    files
      .filter((file) => file.endsWith('.feature'))
      .map((file) => ({ file, text: readFileSync(resolve(location, file), 'utf8') })),
  )
  if (contracts.problems.length) throw new Error(contracts.problems.join('\n'))
  return { root: location, config, contracts, fingerprint: fingerprint(location, files, config) }
}

/** Selection narrows development execution, never the inventory or full gate's allowance. */
export function selectSpecifications(contracts: Contracts, selection?: Selection): Contracts {
  if (typeof selection === 'string' && !selection.trim())
    throw new Error('Scenario selection must not be empty')
  const exact =
    typeof selection === 'string'
      ? contracts.cases.filter(
          (scenario) => scenario.id === selection || scenario.name === selection,
        )
      : []
  const cases = exact.length
    ? exact
    : contracts.cases.filter((scenario) => {
        if (typeof selection === 'function') return selection(scenario)
        return !selection || scenario.id.includes(selection) || scenario.name.includes(selection)
      })
  if (!cases.length) throw new Error(`No authored scenarios match ${JSON.stringify(selection)}`)
  const ids = new Set(
    cases.flatMap((scenario) =>
      scenario.steps.flatMap((step) => (step.kind === 'observation' ? [step.check.id] : [])),
    ),
  )
  return { ...contracts, cases, checks: contracts.checks.filter((check) => ids.has(check.id)) }
}

export async function verifySpecifications(
  root = repository,
  options: {
    scenario?: string
    select?: (scenario: ContractCase) => boolean
    signal?: AbortSignal
  } = {},
) {
  if (options.scenario !== undefined && options.select !== undefined)
    throw new Error('Choose one scenario selection')
  const loaded = loadSpecifications(root)
  const contracts = selectSpecifications(loaded.contracts, options.select ?? options.scenario)
  const evidence = await runEvidence(
    loaded.root,
    loaded.config,
    contracts,
    loaded.fingerprint,
    loaded.config.policy.maxFeedbackMs,
    options.signal,
  )
  return { ...loaded, contracts, evidence }
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--') args.shift()
  const { values } = parseArgs({
    args,
    options: {
      list: { type: 'boolean' },
      scenario: { type: 'string' },
      root: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  })
  if (values.help) {
    process.stdout.write(
      'Usage: bun run test:specs -- [--list] [--scenario NAME_OR_ID] [--root DIRECTORY]\n' +
        'Runs authored specification bindings for development feedback.\n' +
        'Run bonsai check separately for complete source, ancestry, and budget admission.\n' +
        '\nExamples:\n' +
        '  bun run test:specs -- --list\n' +
        '  bun run test:specs -- --scenario "Missing contracts"\n' +
        '  bun run test:specs -- --scenario features/check.feature:0\n' +
        '\nWorkflow: docs/bdd.md\n',
    )
    return
  }
  const root = values.root ?? repository
  if (values.list) {
    const contracts = selectSpecifications(loadSpecifications(root).contracts, values.scenario)
    process.stdout.write(
      contracts.cases.map((scenario) => `${scenario.id}\t${scenario.name}`).join('\n') + '\n',
    )
    return
  }
  const cancellation = new AbortController()
  const stop = () => cancellation.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    const { contracts, evidence } = await verifySpecifications(root, {
      scenario: values.scenario,
      signal: cancellation.signal,
    })
    const results = new Map(evidence.checks.map((check) => [check.id, check]))
    let passed = 0
    for (const scenario of contracts.cases) {
      const checks = scenario.steps.flatMap((step) =>
        step.kind === 'observation' ? [results.get(step.check.id)] : [],
      )
      const success = checks.every((check) => check?.status === 'passed')
      if (success) passed++
      process.stdout.write(`${success ? 'PASS' : 'FAIL'} ${scenario.id} ${scenario.name}\n`)
      for (const check of checks)
        if (!check || check.status !== 'passed')
          process.stderr.write(
            `  ${check?.id ?? 'missing observation'}: ${check?.error ?? check?.status ?? 'missing'}\n`,
          )
    }
    process.stdout.write(
      `${passed}/${contracts.cases.length} scenarios; ${evidence.checks.length} observations\n`,
    )
    process.stdout.write('Focused verification only; no source, ancestry, or budget verdict.\n')
    if (!evidence.complete || passed !== contracts.cases.length) process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
  }
}

if (import.meta.main)
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(
      `Can't run focused specifications: ${message}\nRun bun run test:specs -- --help\n`,
    )
    process.exitCode = 2
  })
