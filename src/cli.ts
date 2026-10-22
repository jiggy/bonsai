#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { resolve, join } from 'node:path'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import type { Snapshot } from './model.ts'
import {
  CliError,
  colorEnabled,
  commandFlags,
  commands,
  completion,
  flags,
  helpData,
  helpText,
  markdownHelp,
  suggest,
  version,
  wrap,
  type CommandName,
} from './cli-interface.ts'

const args = process.argv.slice(2)
const optionArgs = args.slice(0, args.indexOf('--') < 0 ? args.length : args.indexOf('--'))
let json =
  optionArgs.includes('--json') ||
  optionArgs.includes('-j') ||
  optionArgs.some(
    (arg, index) =>
      arg === '--output=json' ||
      (['--output', '-o'].includes(arg) && optionArgs[index + 1] === 'json'),
  )
let debug = optionArgs.includes('--debug') || optionArgs.includes('-d')
let noColor = optionArgs.includes('--no-color')
const cancellation = new AbortController()
let stopping = false
let temporary: string | undefined
let deadline: ReturnType<typeof setTimeout> | undefined
let started = Date.now()
let timeout = 0

const clean = () => {
  if (deadline) clearTimeout(deadline)
  if (temporary) {
    rmSync(temporary, { recursive: true, force: true })
    temporary = undefined
  }
}
const width = () => Math.max(20, Number(process.env.COLUMNS) || process.stdout.columns || 80)
const style = (text: string, code: number, stream: NodeJS.WriteStream = process.stdout) =>
  colorEnabled(stream.isTTY, noColor) ? `\x1b[${code}m${text}\x1b[0m` : text
const write = (text: string, stream: NodeJS.WriteStream = process.stdout) =>
  stream.write(text.trimEnd() + '\n')
const ascii = () =>
  process.env.TERM === 'dumb' || /^(C|POSIX)$/.test(process.env.LC_ALL || process.env.LANG || '')
const symbol = (glyph: string, fallback: string) => (ascii() ? fallback : glyph)

function reportError(error: unknown): void {
  const problem =
    error instanceof CliError
      ? error
      : new CliError(
          error instanceof Error ? error.message : String(error),
          'INCOMPLETE',
          'bonsai help check',
        )
  // Preserve the established error/status fields; new metadata is additive.
  if (json)
    write(
      JSON.stringify({
        status: 'incomplete',
        error: problem.message,
        code: problem.code,
        exit_code: problem.exitCode,
        run: problem.run,
        retryable: false,
        ...(debug && error instanceof Error ? { stack: error.stack } : {}),
      }),
      process.stderr,
    )
  else {
    write(
      `${style(symbol('✗', 'x'), 31, process.stderr)} ${problem.message}\n  Next ${symbol('→', '->')} ${problem.run}`,
      process.stderr,
    )
    if (debug && error instanceof Error) write(error.stack ?? error.message, process.stderr)
  }
  process.exitCode = problem.exitCode
}

function stop(error: CliError): void {
  if (stopping) process.exit(error.exitCode)
  stopping = true
  reportError(error)
  clean()
  cancellation.abort()
  setTimeout(() => process.exit(error.exitCode), 1000).unref()
}

for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  process.on(signal, () => {
    stop(new CliError('Command interrupted', signal, 'Rerun the command when ready', code))
  })
}
for (const stream of [process.stdout, process.stderr])
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') {
      clean()
      process.exit(0)
    }
    reportError(error)
    clean()
    process.exit(1)
  })
process.on('SIGPIPE', () => {
  clean()
  process.exit(0)
})

function git(root: string, parameters: string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...parameters], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    throw new CliError(
      `Can't read Git revision in ${root}`,
      'GIT_BASE',
      'Check --base and --root with git rev-parse --show-toplevel',
    )
  }
}

async function main(): Promise<void> {
  const wantsHelp = optionArgs.some((arg) => ['--help', '-h'].includes(arg))
  const options = Object.fromEntries(
    Object.entries(flags).map(([name, flag]) => [
      name,
      { type: flag.type, ...('short' in flag ? { short: flag.short } : {}) },
    ]),
  )
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({ args, allowPositionals: true, options, tokens: true, strict: !wantsHelp })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const unknown = message.match(/Unknown option '(.*?)'/)?.[1]
    throw new CliError(
      unknown ? `Unknown flag '${unknown}'` : message,
      'USAGE',
      unknown
        ? `${suggest(
            unknown,
            Object.keys(flags).map((name) => `--${name}`),
          )} Run bonsai --help`
        : 'bonsai --help',
    )
  }
  const { values, positionals, tokens } = parsed
  const text = (name: string) =>
    typeof values[name] === 'string' ? (values[name] as string) : undefined
  const enabled = (name: string) => values[name] === true
  json ||= enabled('json') || text('output') === 'json'
  debug ||= enabled('debug')
  noColor ||= enabled('no-color')
  let [command, ...operands] = positionals
  const helpTarget = command === 'help' ? operands[0] : command
  if (
    wantsHelp ||
    (!command && !enabled('version')) ||
    command === 'help' ||
    (command === 'config' && !operands.length)
  ) {
    if (helpTarget && !Object.hasOwn(commands, helpTarget))
      throw new CliError(
        `Unknown command '${helpTarget}'`,
        'USAGE',
        `${suggest(helpTarget, Object.keys(commands))} Run bonsai --help`,
      )
    if (
      command === 'help' &&
      operands.length > 1 &&
      !(operands.length === 2 && operands[0] === 'config' && operands[1] === 'show')
    )
      throw new CliError('Help accepts one command', 'USAGE', 'bonsai help check')
    const target = helpTarget as CommandName | undefined
    if (enabled('markdown')) write(markdownHelp())
    else if (json)
      write(
        JSON.stringify(
          helpData(target),
          null,
          process.stdout.isTTY || enabled('pretty') ? 2 : undefined,
        ),
      )
    else
      write(
        wrap(
          helpText(target, optionArgs.includes('-h') && !optionArgs.includes('--help')),
          width(),
        ),
      )
    return
  }
  if (enabled('version')) command = 'version'
  if (!Object.hasOwn(commands, command))
    throw new CliError(
      `Unknown command '${command}'`,
      'USAGE',
      `${suggest(command, Object.keys(commands))} Run bonsai --help`,
    )
  const name = command as CommandName
  const allowed = new Set(commandFlags(name).map(([flag]) => flag))
  for (const token of tokens ?? [])
    if (token.kind === 'option' && !allowed.has(token.name))
      throw new CliError(
        `--${token.name} doesn't apply to ${command}`,
        'USAGE',
        `bonsai help ${command}`,
      )
  const format = text('output') ?? (enabled('json') ? 'json' : enabled('plain') ? 'plain' : 'auto')
  if (!['auto', 'human', 'plain', 'json'].includes(format))
    throw new CliError(
      `Unknown output format '${format}'`,
      'USAGE',
      'Use --output auto, human, plain, or json',
    )
  if (
    (enabled('json') && enabled('plain')) ||
    (text('output') &&
      ((enabled('json') && format !== 'json') || (enabled('plain') && format !== 'plain')))
  )
    throw new CliError(
      'Output formats conflict',
      'USAGE',
      'Use one of --json, --plain, or --output',
    )
  json = format === 'json'
  if (enabled('pretty') && !json)
    throw new CliError('--pretty needs JSON output', 'USAGE', `bonsai ${command} --json --pretty`)
  const quiet = enabled('quiet') && !enabled('verbose')
  const human = format === 'human' || (format === 'auto' && Boolean(process.stdout.isTTY))
  const emit = (data: unknown, plain: string[], rendered: string[]) => {
    if (json)
      write(JSON.stringify(data, null, enabled('pretty') || process.stdout.isTTY ? 2 : undefined))
    else if (!quiet || enabled('plain') || format === 'plain') {
      if (human) {
        const header = process.stdout.isTTY
          ? `${style('bonsai', 1)} ${symbol('·', '.')} ${command}\n\n`
          : ''
        write(header + wrap(rendered.join('\n'), width()))
      } else if (plain.length) write(plain.join('\n'))
    }
  }
  const source = (key: string, env: string) =>
    text(key) !== undefined ? `--${key}` : process.env[env] !== undefined ? env : 'default'
  if (command === 'version') {
    if (operands.length) throw new CliError('Version takes no arguments', 'USAGE', 'bonsai version')
    if (json) write(JSON.stringify({ name: 'bonsai', version }))
    else write(`bonsai ${version}`)
    return
  }
  if (command === 'completion') {
    if (operands.length !== 1 || !['bash', 'zsh', 'fish', 'powershell'].includes(operands[0]))
      throw new CliError(
        `Unknown or missing shell '${operands.join(' ')}'`,
        'USAGE',
        'Use bonsai completion bash, zsh, fish, or powershell',
      )
    const script = completion(operands[0])
    if (json) emit({ shell: operands[0], script }, [], [])
    else write(script)
    return
  }
  if (
    command === 'explain' &&
    !operands.length &&
    process.stdin.isTTY &&
    process.stderr.isTTY &&
    !enabled('no-input') &&
    (!process.env.CI || enabled('interactive')) &&
    (!json || enabled('interactive'))
  ) {
    const prompt = createInterface({ input: process.stdin, output: process.stderr })
    try {
      operands = [
        (await prompt.question('File or component: ', { signal: cancellation.signal })).trim(),
      ]
    } finally {
      prompt.close()
    }
    if (operands[0])
      write(
        `Next ${symbol('→', '->')} bonsai explain ${JSON.stringify(operands[0])}`,
        process.stderr,
      )
  }
  if (command === 'explain' && (!operands.length || !operands[0]))
    throw new CliError(
      'Missing file or component',
      'USAGE',
      'Use bonsai explain <file-or-component> or pipe targets into bonsai explain -',
    )
  if (
    (command === 'check' && operands.length) ||
    (command === 'explain' && (operands.length !== 1 || !operands[0])) ||
    (command === 'config' && (operands.length !== 1 || operands[0] !== 'show'))
  )
    throw new CliError(`Invalid arguments for ${command}`, 'USAGE', `bonsai help ${command}`)
  const { readConfig, snapshot } = await import('./project.ts')
  const rootValue = text('root') ?? process.env.BONSAI_ROOT ?? '.'
  if (!rootValue.trim() || rootValue === '-')
    throw new CliError('--root needs a project directory', 'USAGE', 'Use --root examples/checkout')
  const root = resolve(rootValue)
  const baseValue = text('base') ?? process.env.BONSAI_BASE
  const policyValue = text('policy') ?? process.env.BONSAI_POLICY
  if (baseValue !== undefined && !baseValue.trim())
    throw new CliError(
      'Base revision is empty',
      'USAGE',
      'Set BONSAI_BASE or --base to a Git revision',
    )
  if (policyValue !== undefined && !policyValue.trim())
    throw new CliError(
      'Policy path is empty',
      'USAGE',
      'Set BONSAI_POLICY or --policy to a policy file',
    )
  if (text('timeout') !== undefined) {
    timeout = Number(text('timeout')) * 1000
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483647)
      throw new CliError(
        `Invalid timeout '${text('timeout')}'`,
        'USAGE',
        'Use --timeout with positive seconds, such as --timeout 30',
      )
    deadline = setTimeout(() => {
      stop(new CliError('Command deadline expired', 'TIMEOUT', 'Rerun with a longer --timeout', 1))
    }, timeout)
  }
  started = Date.now()
  if (!quiet && !json && (process.stderr.isTTY || enabled('verbose')))
    write(`${command === 'check' ? 'Checking' : 'Reading'} ${root}`, process.stderr)
  const stdin = () => {
    if (process.stdin.isTTY)
      throw new CliError(
        'Standard input needs piped data',
        'USAGE',
        'Pipe input into the command or provide a file path',
      )
    return readFileSync(0, 'utf8')
  }
  if (policyValue === '-' && command === 'explain' && operands[0] === '-')
    throw new CliError(
      'Policy and targets can’t both read stdin',
      'USAGE',
      'Use a policy file with --policy when piping targets',
    )
  const loadConfig = (projectRoot: string, file?: string, input?: string) => {
    try {
      return readConfig(projectRoot, file, input)
    } catch (error) {
      const path = file ?? resolve(projectRoot, 'bonsai.json')
      const errno = (error as NodeJS.ErrnoException).code
      throw new CliError(
        errno === 'ENOENT'
          ? `Configuration not found: ${path}`
          : `Can't read ${path}: ${error instanceof Error ? error.message : String(error)}`,
        'CONFIG',
        `Check ${path} or use --root and --policy to select the project`,
        errno === 'EACCES' ? 3 : 2,
      )
    }
  }
  let configFile = policyValue
    ? policyValue === '-'
      ? 'stdin'
      : resolve(policyValue)
    : resolve(root, 'bonsai.json')
  let baseSha: string | undefined
  if (baseValue) {
    const repository = git(root, ['rev-parse', '--show-toplevel'])
    if (resolve(repository) !== root)
      throw new CliError(
        '--base needs the Git repository root',
        'USAGE',
        `Use --root ${repository}`,
      )
    baseSha = git(root, ['rev-parse', '--verify', '--end-of-options', `${baseValue}^{commit}`])
    temporary = mkdtempSync(join(tmpdir(), 'bonsai-base-'))
    try {
      const archive = execFileSync('git', ['-C', root, 'archive', baseSha], {
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      execFileSync('tar', ['-x', '-C', temporary], {
        input: archive,
        stdio: ['pipe', 'ignore', 'pipe'],
      })
    } catch {
      throw new CliError(
        `Can't read base '${baseValue}'`,
        'GIT_BASE',
        'Check the base revision and that Git and tar are installed',
      )
    }
    if (!policyValue) configFile = `git:${baseSha}:bonsai.json`
  }
  const config =
    policyValue === '-'
      ? loadConfig(root, 'stdin', stdin())
      : policyValue
        ? loadConfig(root, resolve(policyValue))
        : loadConfig(temporary ?? root)
  if (command === 'config') {
    const result = {
      root,
      base: baseSha ?? null,
      file: configFile,
      origin: {
        root: source('root', 'BONSAI_ROOT'),
        base: source('base', 'BONSAI_BASE'),
        policy:
          source('policy', 'BONSAI_POLICY') === 'default'
            ? baseSha
              ? 'base'
              : 'project'
            : source('policy', 'BONSAI_POLICY'),
      },
      config,
    }
    emit(
      result,
      [
        `root\t${root}`,
        `policy\t${configFile}`,
        `bindings\t${config.bindings}`,
        ...config.maintained.map((path) => `maintained\t${path}`),
        ...Object.entries(result.origin).map(([key, value]) => `origin.${key}\t${value}`),
        ...Object.entries(config.policy).map(([key, value]) => `${key}\t${value}`),
      ],
      [
        `Policy: ${configFile}`,
        `Origin: ${result.origin.policy}`,
        `Root: ${root}`,
        `Maintained: ${config.maintained.join(', ')}`,
        `Bindings: ${config.bindings}`,
        ...Object.entries(config.policy).map(([key, value]) => `${key}: ${value}`),
      ],
    )
    return
  }
  const { evaluate } = await import('./policy.ts')
  const { explain } = await import('./retention.ts')
  let base: Snapshot | undefined
  if (temporary) {
    base = await snapshot(temporary, config, false)
    if (base.contracts.problems.length)
      throw new CliError(
        `Can't compile base contracts: ${base.contracts.problems.join(', ')}`,
        'BASE_INCOMPLETE',
        'Fix the base contracts or select another --base revision',
      )
  }
  const candidate = await snapshot(root, config, command === 'check', cancellation.signal)
  if (stopping) return
  if (timeout && Date.now() - started > timeout)
    throw new CliError('Command deadline expired', 'TIMEOUT', 'Rerun with a longer --timeout', 1)
  if (command === 'explain') {
    const queries = operands[0] === '-' ? stdin().split(/\r?\n/).filter(Boolean) : operands
    const components = [
      ...new Map(
        queries
          .flatMap((query) => explain(candidate, query))
          .map((component) => [component.id, component]),
      ).values(),
    ]
    for (const query of queries)
      if (!explain(candidate, query).length)
        throw new CliError(
          `Component or file not found: ${query}`,
          'NOT_FOUND',
          'Check the maintained inventory with bonsai config show',
          4,
        )
    const rows = components.map(
      (component) =>
        `${component.id}\t${component.tokens}\t${component.contracts.length}\t${component.file}:${component.line}`,
    )
    const lines = components.flatMap((component) => [
      component.id,
      `  ${symbol('├─', '|-')} ${component.tokens} tokens`,
      `  ${symbol('└─', "'-")} ${component.contracts.length} required checks`,
      ...(enabled('verbose')
        ? component.relationships.map((edge) => `  ${edge.from} ${symbol('→', '->')} ${edge.to}`)
        : []),
    ])
    emit(
      { fingerprint: candidate.fingerprint, components, problems: candidate.source.problems },
      rows,
      lines.length ? lines : ['No targets provided'],
    )
    if (candidate.source.problems.length) {
      process.exitCode = 2
      if (!json)
        for (const problem of candidate.source.problems)
          write(`Incomplete analysis: ${problem}`, process.stderr)
    }
    return
  }
  const decision = evaluate(base, candidate, config.policy)
  const passed = candidate.evidence?.checks.filter((check) => check.status === 'passed').length ?? 0
  const rows = [
    [
      decision.status,
      decision.retained,
      decision.ceiling,
      decision.requiredReduction,
      decision.surface,
      passed,
      candidate.contracts.checks.length,
      candidate.unrooted.length,
    ].join('\t'),
  ]
  const glyph =
    decision.status === 'pass'
      ? symbol('✓', '+')
      : decision.status === 'reject'
        ? symbol('✗', 'x')
        : symbol('△', '!')
  const label =
    decision.status === 'pass' ? 'Pass' : decision.status === 'reject' ? 'Rejected' : 'Incomplete'
  const lines = [
    `${style(glyph, decision.status === 'pass' ? 32 : decision.status === 'reject' ? 31 : 33)} ${label}`,
    `  ${symbol('├─', '|-')} Retained: ${decision.retained} / ${decision.ceiling} tokens`,
    `  ${symbol('├─', '|-')} Contract surface: ${decision.surface} ${decision.surface === 1 ? 'pair' : 'pairs'}`,
    `  ${symbol('└─', "'-")} Required checks: ${passed} / ${candidate.contracts.checks.length} passed`,
  ]
  if (decision.base)
    lines.push(
      `Retained change: ${decision.base.retainedChange}`,
      `Additional capacity: ${decision.base.additionalCapacity}`,
    )
  if (decision.requiredReduction)
    lines.push(`Required reduction: ${decision.requiredReduction} tokens`)
  const violations = enabled('verbose') ? decision.violations : decision.violations.slice(0, 20)
  if (violations.length)
    lines.push(
      '',
      ...violations.map((violation) => `- ${violation}`),
      'Next → bonsai explain <reported-file-or-component> --root ' + root,
    )
  if (decision.violations.length > violations.length) lines.push('Use --verbose for all violations')
  if (enabled('verbose'))
    lines.push(
      '',
      ...(candidate.evidence?.checks.map((check) => `${check.id}: ${check.status}`) ?? []),
    )
  const counters = [
    ...(passed ? [`${passed} checks passed`] : []),
    ...(candidate.unrooted.length ? [`${candidate.unrooted.length} unrooted`] : []),
    ...(decision.violations.length ? [`${decision.violations.length} violations`] : []),
  ]
  if (counters.length) lines.push('', style(counters.join(` ${symbol('·', '.')} `), 1))
  emit({ decision, snapshot: candidate }, rows, lines)
  if (!json && decision.status !== 'pass' && (!human || quiet)) {
    for (const violation of violations) write(`${decision.status}: ${violation}`, process.stderr)
    write(
      `Next ${symbol('→', '->')} bonsai explain <reported-file-or-component> --root ${root}`,
      process.stderr,
    )
  }
  process.exitCode = decision.status === 'pass' ? 0 : decision.status === 'reject' ? 1 : 2
}

main()
  .catch((error) => {
    if (!stopping) reportError(error)
  })
  .finally(clean)
