import type { RustTools } from './rust-process.ts'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { inventory, fingerprint } from './inventory.ts'
import { buildSnapshot } from './retention.ts'
import { runEvidence, verificationPlan } from './evidence.ts'
import { validatePolicy } from './policy.ts'
import { Timer } from './timing.ts'
import type { Config, Snapshot } from './model.ts'
import { collectRustSource, CollectorError } from './collector.ts'
import { NativeInstallError } from './native-install.ts'
import {
  applicationIdentity,
  analysisIdentity,
  identityForBindings,
  executionIdentity,
  sameExecutionIdentity,
  type ExecutionIdentity,
} from './identity.ts'
import { runSupportingVerification, validateRunnerRequirements } from './runners.ts'
import { parseSnapshot } from './snapshot-schema.ts'

export { CollectorError } from './collector.ts'

const require = createRequire(import.meta.url)

export function readConfig(
  root: string,
  file = resolve(root, 'bonsai.json'),
  input?: string,
): Config {
  const text = input ?? readFileSync(file, 'utf8')
  let config: Config
  try {
    config = JSON.parse(text, (key, value) => {
      // Preserve the reference parser's plain-object assignments and leading
      // underscore handling for unusual keys, including escaped __proto__.
      if (key.startsWith('__')) throw new Error('Reference configuration parser required')
      return value
    }) as Config
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error('Reference configuration parser required')
  } catch {
    // JSONC and malformed inputs retain the exact established parser and errors.
    const ts = require('typescript') as typeof import('typescript')
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
    config = parsed.config as Config
  }
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
  if (
    config.exclude !== undefined &&
    (!Array.isArray(config.exclude) ||
      !config.exclude.every((pattern) => typeof pattern === 'string' && pattern.length > 0))
  )
    throw new Error('Configuration exclude must be an array of non-empty ignore patterns')
  validatePolicy(config.policy)
  validateRunnerRequirements(config.runners)
  if (Object.hasOwn(config, 'verification'))
    throw new Error(
      'Remove verification from bonsai.json; checks now run concurrently by default. Use --serial for sequential verification',
    )
  return config
}

export async function snapshot(
  root: string,
  config: Config,
  execute = true,
  signal?: AbortSignal,
  timer = new Timer(),
  options: { serial?: boolean } = {},
): Promise<Snapshot> {
  const started = performance.now()
  try {
    timer.start('inventory')
    const files = inventory(root, config.maintained, config.exclude)
    if (!files.includes(config.bindings))
      throw new Error('The binding file must be in maintained inventory')
    const maintained = config.runners?.length
      ? new Set(files.map((file) => realpathSync(resolve(root, file))))
      : undefined
    for (const runner of config.runners ?? []) {
      for (const output of [runner.report, runner.coverage?.report]) {
        if (
          output !== undefined &&
          (files.includes(output) ||
            (existsSync(resolve(root, output)) &&
              maintained!.has(realpathSync(resolve(root, output)))))
        )
          throw new Error(`Runner report overlaps maintained input: ${output}`)
      }
    }
    timer.start('fingerprint')
    const hash = fingerprint(root, files, config)
    timer.start('contracts')
    const { compileContracts } = await import('./contracts.ts')
    const contracts = compileContracts(
      files
        .filter((file) => file.endsWith('.feature'))
        .map((file) => ({ file, text: readFileSync(resolve(root, file), 'utf8') })),
    )
    timer.start('identity')
    const python = config.bindings.endsWith('.py')
    const standaloneRust = config.bindings.endsWith('.rs')
    let identity: ExecutionIdentity | undefined
    try {
      if (!python && !standaloneRust) identity = executionIdentity()
    } catch (error) {
      if (error instanceof NativeInstallError) throw new CollectorError(error.message, error.run)
      throw error
    }
    const sourceTimer = new Timer()
    timer.start('source', sourceTimer)
    const collectSource = standaloneRust
      ? (await import('./standalone-rust.ts')).collectStandaloneRust
      : python
        ? (await import('./python.ts')).collectPythonSource
        : collectRustSource
    const collected = await collectSource(
      root,
      files,
      config.bindings,
      signal,
      execute ? config.policy.maxFeedbackMs - (performance.now() - started) : undefined,
      sourceTimer,
    )
    const source = collected.source
    if ('identity' in collected) identity = collected.identity
    if (!identity && !collected.interrupted) throw new Error('Missing source analysis identity')
    if ((python || standaloneRust) && Object.hasOwn(config.policy, 'structural'))
      source.problems.push(
        'control-depth-v1 measurements are unavailable for these bindings; this structural policy cannot be verified',
      )
    if (collected.interrupted) timer.finish('interrupted')
    timer.start('analysis-integrity')
    let rustContext: RustTools | undefined
    try {
      if (identity) {
        if (standaloneRust)
          rustContext = await (await import('./rust-process.ts')).rustTools(
            signal,
            execute ? config.policy.maxFeedbackMs - (performance.now() - started) : undefined,
            root,
          )
        const current = standaloneRust
          ? analysisIdentity(rustContext!.compiler)
          : python ? applicationIdentity(identity) : executionIdentity()
        if (!sameExecutionIdentity(identity, current))
          source.problems.push('Checker or toolchain changed during source analysis')
      }
    } catch (error) {
      if (!standaloneRust) throw error
      timer.finish('interrupted')
      source.problems.push(`Checker or toolchain identity recheck interrupted: ${String(error)}`)
      if (collected.analysis) collected.analysis.status = 'unsupported'
    }
    timer.start('retention')
    const result = buildSnapshot(hash, contracts, source)
    result.identity = identity
    if (config.runners?.length) result.runners = config.runners
    if (execute) result.verification = verificationPlan(contracts, options.serial)
    result.analysis = collected.analysis
    let feedbackElapsed = execute ? performance.now() - started : undefined
    if (execute && !contracts.problems.length && !source.problems.length) {
      timer.start('verification')
      try {
        result.evidence = await runEvidence(
          root,
          config,
          contracts,
          hash,
          config.policy.maxFeedbackMs - (performance.now() - started),
          signal,
          result.verification,
          result.identity,
          'pythonSources' in collected ? collected.pythonSources : undefined,
          rustContext,
        )
        if (config.runners?.length) {
          result.runnerEvidence = await runSupportingVerification(
            root,
            config.runners,
            hash,
            config.policy.maxFeedbackMs - (performance.now() - started),
            signal,
            source,
          )
          for (const evidence of result.runnerEvidence) evidence.identity = result.identity
        }
        timer.finish()
      } catch (error) {
        timer.finish('interrupted')
        source.problems.push(`Evidence collection interrupted: ${String(error)}`)
      }
      feedbackElapsed = performance.now() - started
      if (result.evidence) result.evidence.elapsedMs = feedbackElapsed
      timer.start('integrity')
      if (fingerprint(root, inventory(root, config.maintained, config.exclude), config) !== hash) {
        source.problems.push('Maintained files changed during verification')
      }
      try {
        if (
          !sameExecutionIdentity(
            result.identity,
            await identityForBindings(config.bindings, signal, undefined, root),
          )
        )
          source.problems.push('Checker or toolchain changed during verification')
      } catch (error) {
        if (!standaloneRust) throw error
        timer.finish('interrupted')
        source.problems.push(`Checker or toolchain identity recheck interrupted: ${String(error)}`)
      }
      timer.finish()
    } else {
      timer.skip('verification')
      timer.skip('integrity')
    }
    result.timing = {
      ...timer.report(),
      ...(feedbackElapsed !== undefined && {
        feedback: { elapsedMs: feedbackElapsed, limitMs: config.policy.maxFeedbackMs },
      }),
    }
    parseSnapshot(JSON.stringify(result))
    return result
  } catch (error) {
    timer.finish('interrupted')
    throw error
  }
}
