import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { compileContracts } from './contracts.ts'
import { inventory, fingerprint, analyzeSource } from './source.ts'
import { buildSnapshot } from './retention.ts'
import { runEvidence } from './evidence.ts'
import { validatePolicy } from './policy.ts'
import type { Config, Snapshot } from './model.ts'

export function readConfig(
  root: string,
  file = resolve(root, 'bonsai.json'),
  input?: string,
): Config {
  const text = input ?? readFileSync(file, 'utf8')
  const parsed = ts.parseConfigFileTextToJson(file, text)
  if (parsed.error) {
    const location =
      parsed.error.file && parsed.error.start !== undefined
        ? parsed.error.file.getLineAndCharacterOfPosition(parsed.error.start)
        : undefined
    throw new Error(
      `Syntax error${location ? ` at line ${location.line + 1}, column ${location.character + 1}` : ''}: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`,
    )
  }
  const config = parsed.config as Config
  if (
    !config ||
    typeof config !== 'object' ||
    !Array.isArray(config.maintained) ||
    !config.maintained.length ||
    !config.maintained.every((path) => typeof path === 'string' && path.length) ||
    typeof config.bindings !== 'string'
  ) {
    throw new Error('Configuration needs maintained paths and a bindings file')
  }
  if (!config.policy || typeof config.policy !== 'object')
    throw new Error('Configuration needs a policy object')
  validatePolicy(config.policy)
  return config
}

export async function snapshot(
  root: string,
  config: Config,
  execute = true,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const started = performance.now()
  const files = inventory(root, config.maintained)
  if (!files.includes(config.bindings))
    throw new Error('The binding file must be in maintained inventory')
  const hash = fingerprint(root, files, config)
  const contracts = compileContracts(
    files
      .filter((file) => file.endsWith('.feature'))
      .map((file) => ({ file, text: readFileSync(resolve(root, file), 'utf8') })),
  )
  const source = analyzeSource(root, files, config.bindings)
  const result = buildSnapshot(hash, contracts, source)
  if (execute && !contracts.problems.length && !source.problems.length) {
    try {
      result.evidence = await runEvidence(
        root,
        config.bindings,
        contracts,
        hash,
        config.policy.maxFeedbackMs - (performance.now() - started),
        signal,
      )
    } catch (error) {
      source.problems.push(`Evidence collection interrupted: ${String(error)}`)
    }
    if (result.evidence) result.evidence.elapsedMs = performance.now() - started
    if (fingerprint(root, inventory(root, config.maintained), config) !== hash) {
      source.problems.push('Maintained files changed during verification')
    }
  }
  return result
}
