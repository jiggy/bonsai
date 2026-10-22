#!/usr/bin/env bun
import { parseArgs } from 'node:util'
import { resolve, join, relative, sep } from 'node:path'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import type { Snapshot } from './model.ts'
import {
  CliError,
  colorEnabled,
  commandFlags,
  commands,
  flags,
  helpData,
  helpText,
  markdownHelp,
  suggest,
  version,
  renderHelp,
  renderError,
  renderHuman,
  type CommandName,
} from './cli-interface.ts'
import { completion } from './cli-completion.ts'

const invokedAt = Date.now()
const args = process.argv.slice(2)
const options = Object.fromEntries(
  Object.entries(flags).map(([name, flag]) => [
    name,
    { type: flag.type, ...('short' in flag ? { short: flag.short } : {}) },
  ]),
)
// Tolerant parsing identifies output preferences before strict validation can fail.
// Use the same flag definitions so clusters, attached values, and -- stay consistent.
const preliminary = parseArgs({
  args,
  options,
  allowPositionals: true,
  tokens: true,
  strict: false,
})
let json = preliminary.values.json === true || preliminary.values.output === 'json'
let debug = preliminary.values.debug === true
let noColor = preliminary.values['no-color'] === true
const cancellation = new AbortController()
let stopping = false
let temporary: string | undefined
let deadline: ReturnType<typeof setTimeout> | undefined
let expiresAt = 0

const clean = () => {
  if (deadline) clearTimeout(deadline)
  if (temporary) {
    rmSync(temporary, { recursive: true, force: true })
    temporary = undefined
  }
}
const width = (stream: NodeJS.WriteStream = process.stdout) => {
  const configured = Number(process.env.COLUMNS)
  return Math.max(
    20,
    Number.isFinite(configured) && configured > 0 ? configured : stream.columns || 80,
  )
}
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
      renderError(problem.message, problem.run, {
        width: width(process.stderr),
        color: colorEnabled(process.stderr.isTTY, noColor),
        ascii: ascii(),
      }),
      process.stderr,
    )
    if (debug && error instanceof Error) write(error.stack ?? error.message, process.stderr)
  }
  process.exitCode = problem.exitCode
}

function stop(error: CliError): void {
  if (stopping) process.exit()
  stopping = true
  process.exitCode = error.exitCode
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
function streamError(error: NodeJS.ErrnoException): void {
  if (stopping) return
  if (error.code === 'EPIPE') {
    clean()
    process.exit(0)
  }
  reportError(error)
  clean()
  process.exit(1)
}
for (const stream of [process.stdout, process.stderr]) stream.on('error', streamError)
process.on('SIGPIPE', () => {
  if (stopping) return
  clean()
  process.exit(0)
})

function checkDeadline(): void {
  if (expiresAt && Date.now() >= expiresAt)
    throw new CliError('Command deadline expired', 'TIMEOUT', 'Rerun with a longer --timeout', 1)
}

async function writeReport(text: string): Promise<void> {
  const output = text.trimEnd() + '\n'
  checkDeadline()
  await new Promise<void>((resolveWrite, reject) => {
    const abort = () => {
      cancellation.signal.removeEventListener('abort', abort)
      process.stdout.destroy()
      reject(new Error('Output interrupted'))
    }
    if (cancellation.signal.aborted) {
      abort()
      return
    }
    cancellation.signal.addEventListener('abort', abort, { once: true })
    const finish = (error?: Error | null) => {
      cancellation.signal.removeEventListener('abort', abort)
      if (error) {
        streamError(error)
        reject(error)
      } else resolveWrite()
    }
    try {
      process.stdout.write(output, finish)
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
  checkDeadline()
}

async function stdin(): Promise<string> {
  if (process.stdin.isTTY)
    throw new CliError(
      'Standard input needs piped data',
      'USAGE',
      'Pipe input into the command or provide a file path',
    )
  checkDeadline()
  return new Promise((resolveInput, reject) => {
    const chunks: Buffer[] = []
    const cleanup = () => {
      process.stdin.removeListener('data', data)
      process.stdin.removeListener('end', end)
      process.stdin.removeListener('error', error)
      cancellation.signal.removeEventListener('abort', abort)
    }
    const data = (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    const end = () => {
      cleanup()
      resolveInput(Buffer.concat(chunks).toString('utf8'))
    }
    const error = (cause: Error) => {
      cleanup()
      reject(cause)
    }
    const abort = () => {
      cleanup()
      process.stdin.destroy()
      reject(new Error('Input interrupted'))
    }
    process.stdin.on('data', data).once('end', end).once('error', error)
    cancellation.signal.addEventListener('abort', abort, { once: true })
    if (cancellation.signal.aborted) abort()
    else process.stdin.resume()
  })
}

const shellWord = (value: string) =>
  /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'"

async function tool(file: string, parameters: string[], input?: Buffer): Promise<Buffer> {
  checkDeadline()
  try {
    const result = await new Promise<Buffer>((resolveOutput, reject) => {
      const child = execFile(
        file,
        parameters,
        {
          encoding: 'buffer',
          maxBuffer: 64 * 1024 * 1024,
          signal: cancellation.signal,
          timeout: expiresAt ? Math.max(1, expiresAt - Date.now()) : undefined,
          killSignal: 'SIGKILL',
        },
        (error, stdout) => (error ? reject(error) : resolveOutput(stdout)),
      )
      child.stdin?.on('error', () => {})
      child.stdin?.end(input)
    })
    checkDeadline()
    return result
  } catch (error) {
    checkDeadline()
    throw error
  }
}

async function git(root: string, parameters: string[]): Promise<string> {
  try {
    return (await tool('git', ['-C', root, ...parameters])).toString('utf8').trim()
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError(
      `Can't read Git revision in ${root}`,
      'GIT_BASE',
      'Check --base and --root with git rev-parse --show-toplevel',
    )
  }
}

async function main(): Promise<void> {
  const wantsHelp = preliminary.values.help === true
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({ args, allowPositionals: true, options, tokens: true, strict: !wantsHelp })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('ambiguous')) {
      for (const token of preliminary.tokens) {
        if (token.kind !== 'option' || token.inlineValue !== false || !token.value?.startsWith('-'))
          continue
        const requested = parseArgs({
          args: [token.value],
          options,
          strict: false,
          allowPositionals: true,
        }).values
        json ||= requested.json === true || requested.output === 'json'
      }
    }
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
  const helpRequest =
    wantsHelp ||
    (!command && !enabled('version')) ||
    command === 'help' ||
    (command === 'config' && !operands.length)
  if (enabled('version') && !helpRequest) command = 'version'
  if (!helpRequest && !Object.hasOwn(commands, command))
    throw new CliError(
      `Unknown command '${command}'`,
      'USAGE',
      `${suggest(command, Object.keys(commands))} Run bonsai --help`,
    )
  if (!helpRequest) {
    const allowed = new Set(commandFlags(command as CommandName).map(([flag]) => flag))
    for (const token of tokens ?? [])
      if (token.kind === 'option' && !allowed.has(token.name))
        throw new CliError(
          `--${token.name} doesn't apply to ${command}`,
          'USAGE',
          `bonsai help ${command}`,
        )
  }
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
    throw new CliError(
      '--pretty needs JSON output',
      'USAGE',
      `bonsai ${command || 'help'} --json --pretty`,
    )
  if (enabled('markdown') && (!helpRequest || json || format === 'plain'))
    throw new CliError(
      '--markdown needs help without a machine output mode',
      'USAGE',
      'Use bonsai help --markdown or bonsai help --json',
    )
  const jsonText = (data: unknown) =>
    JSON.stringify(data, null, enabled('pretty') || process.stdout.isTTY ? 2 : undefined)
  if (helpRequest) {
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
    else if (json) write(jsonText(helpData(target)))
    else {
      const concise =
        wantsHelp &&
        !preliminary.tokens.some(
          (token) => token.kind === 'option' && token.name === 'help' && token.rawName === '--help',
        )
      write(
        process.stdout.isTTY
          ? renderHelp(target, concise, {
              width: width(),
              color: colorEnabled(process.stdout.isTTY, noColor),
              ascii: ascii(),
            })
          : helpText(target, concise),
      )
    }
    return
  }
  const quiet = enabled('quiet') && !enabled('verbose')
  const human = format === 'human' || (format === 'auto' && Boolean(process.stdout.isTTY))
  const emit = async (data: unknown, plain: string[], rendered: string[]) => {
    checkDeadline()
    if (json) await writeReport(jsonText(data))
    else if (!quiet || enabled('plain') || format === 'plain') {
      if (human) {
        await writeReport(
          renderHuman(command as CommandName, rendered, {
            header: Boolean(process.stdout.isTTY),
            width: width(),
            color: colorEnabled(process.stdout.isTTY, noColor),
            ascii: ascii(),
          }),
        )
      } else if (plain.length) await writeReport(plain.join('\n'))
    }
  }
  const source = (key: string, env: string) =>
    text(key) !== undefined ? `--${key}` : process.env[env] !== undefined ? env : 'default'
  if (command === 'version') {
    if (operands.length) throw new CliError('Version takes no arguments', 'USAGE', 'bonsai version')
    if (json) write(jsonText({ name: 'bonsai', version }))
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
    if (json) await emit({ shell: operands[0], script }, [], [])
    else write(script)
    return
  }
  if (text('timeout') !== undefined) {
    const timeout = Number(text('timeout')) * 1000
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483647)
      throw new CliError(
        `Invalid timeout '${text('timeout')}'`,
        'USAGE',
        'Use --timeout with positive seconds, such as --timeout 30',
      )
    expiresAt = invokedAt + timeout
    checkDeadline()
    deadline = setTimeout(
      () =>
        stop(
          new CliError('Command deadline expired', 'TIMEOUT', 'Rerun with a longer --timeout', 1),
        ),
      Math.max(0, expiresAt - Date.now()),
    )
  }
  const limit = text('limit') === undefined ? 20 : Number(text('limit'))
  if (
    (text('limit') !== undefined && !/^\d+$/.test(text('limit')!)) ||
    !Number.isSafeInteger(limit) ||
    limit < 0
  )
    throw new CliError(
      `Invalid limit '${text('limit')}'`,
      'USAGE',
      'Use --limit with a non-negative integer, or --limit 0 for all results',
    )
  let prompted = false
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
    prompted = Boolean(operands[0])
  }
  if (command === 'explain' && (!operands.length || !operands[0]))
    throw new CliError(
      'Missing file or component',
      'USAGE',
      'Use bonsai explain <file-or-component> or pipe targets into bonsai explain -',
    )
  if (
    ((command === 'check' || command === 'init') && operands.length) ||
    (command === 'explain' && (operands.length !== 1 || !operands[0])) ||
    (command === 'config' && (operands.length !== 1 || operands[0] !== 'show'))
  )
    throw new CliError(`Invalid arguments for ${command}`, 'USAGE', `bonsai help ${command}`)
  const rootValue = text('root') ?? process.env.BONSAI_ROOT ?? '.'
  if (!rootValue.trim() || rootValue === '-')
    throw new CliError('--root needs a project directory', 'USAGE', 'Use --root examples/checkout')
  const root = resolve(rootValue)
  if (command === 'init') {
    const { initialize } = await import('./init.ts')
    let result: ReturnType<typeof initialize>
    try {
      result = initialize(root, checkDeadline)
    } catch (error) {
      if (error instanceof CliError) throw error
      const errno = (error as NodeJS.ErrnoException).code
      throw new CliError(
        `Can't initialize ${root}: ${error instanceof Error ? error.message : String(error)}`,
        'INIT',
        `Check directory permissions and run bonsai init --root ${shellWord(root)}`,
        errno === 'EACCES' || errno === 'EPERM' ? 3 : 2,
      )
    }
    await emit(
      result,
      [
        ...result.created.map((path) => `created\t${join(root, path)}`),
        ...result.next.map((step) => `next\t${step}`),
      ],
      [
        `${symbol('✓', '+')} Initialized ${result.file}`,
        ...result.created.map((path) => `  ${symbol('├─', '|-')} Created ${path}`),
        `  ${symbol('└─', "'-")} Maintained: ${result.config.maintained.join(', ')}`,
        ...(result.excluded.length ? [`Excluded paths: ${result.excluded.join(', ')}`] : []),
        '',
        ...result.next.slice(0, -1),
        `Next ${symbol('→', '->')} ${result.next.at(-1)}`,
      ],
    )
    return
  }
  const { readConfig, snapshot } = await import('./project.ts')
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
  checkDeadline()
  if (!quiet && !json && (process.stderr.isTTY || enabled('verbose')))
    write(`${command === 'check' ? 'Checking' : 'Reading'} ${root}`, process.stderr)
  const context = [
    '--root',
    root,
    ...(baseValue ? ['--base', baseValue] : []),
    ...(policyValue ? ['--policy', policyValue === '-' ? '-' : resolve(policyValue)] : []),
  ]
  const invocation = (words: string[]) => {
    const positional =
      words[0] === 'explain' && words[1]?.startsWith('-') && words[1] !== '-'
        ? [words[0], `./${words[1]}`, ...words.slice(2)]
        : words
    return ['bonsai', ...positional, ...context].map(shellWord).join(' ')
  }
  if (prompted)
    write(`Next ${symbol('→', '->')} ${invocation(['explain', operands[0]])}`, process.stderr)
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
        errno === 'ENOENT' && !file && !temporary && existsSync(root)
          ? ['bonsai', 'init', '--root', root].map(shellWord).join(' ')
          : `Check ${path} or use --root and --policy to select the project`,
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
    const repository = await git(root, ['rev-parse', '--show-toplevel'])
    if (resolve(repository) !== root)
      throw new CliError(
        '--base needs the Git repository root',
        'USAGE',
        `Use --root ${repository}`,
      )
    baseSha = await git(root, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${baseValue}^{commit}`,
    ])
    temporary = mkdtempSync(join(tmpdir(), 'bonsai-base-'))
    try {
      const archive = await tool('git', ['-C', root, 'archive', baseSha])
      await tool('tar', ['-x', '-C', temporary], archive)
    } catch (error) {
      if (error instanceof CliError) throw error
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
      ? loadConfig(root, 'stdin', await stdin())
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
    await emit(
      result,
      [
        `root\t${root}`,
        `policy\t${configFile}`,
        `bindings\t${config.bindings}`,
        ...config.maintained.map((path) => `maintained\t${path}`),
        ...(config.exclude ?? []).map((pattern) => `exclude\t${pattern}`),
        ...Object.entries(result.origin).map(([key, value]) => `origin.${key}\t${value}`),
        ...Object.entries(config.policy).map(([key, value]) => `${key}\t${value}`),
      ],
      [
        `Policy: ${configFile}`,
        `Origin: ${result.origin.policy}`,
        `Root: ${root}`,
        `Maintained: ${config.maintained.join(', ')}`,
        `Exclusions: ${config.exclude?.length ?? 0} saved patterns (use --json to inspect)`,
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
  const inputQueries =
    command === 'explain' && operands[0] === '-'
      ? (await stdin()).split(/\r?\n/).filter(Boolean)
      : operands
  checkDeadline()
  const candidate = await snapshot(root, config, command === 'check', cancellation.signal)
  if (stopping) return
  checkDeadline()
  if (command === 'explain') {
    const normalize = (query: string) => {
      if (
        candidate.source.components.some(
          (component) => component.id === query || component.file === query,
        )
      )
        return query
      return relative(root, resolve(root, query)).split(sep).join('/')
    }
    const queries = inputQueries.map(normalize)
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
          invocation(['config', 'show']),
          4,
        )
    const rows = components.map(
      (component) =>
        `${component.id}\t${component.tokens}\t${component.contracts.length}\t${component.file}:${component.line}`,
    )
    const shown = human && limit ? components.slice(0, limit) : components
    const lines = shown.flatMap((component) => [
      component.id,
      `  ${symbol('├─', '|-')} ${component.tokens} tokens`,
      `  ${symbol('└─', "'-")} ${component.contracts.length} required checks`,
      ...(enabled('verbose')
        ? component.relationships.map((edge) => `  ${edge.from} ${symbol('→', '->')} ${edge.to}`)
        : []),
    ])
    if (shown.length < components.length)
      lines.push(
        `Showing ${shown.length} of ${components.length} components. Use --limit 0 to show all`,
      )
    await emit(
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
  if (decision.status === 'incomplete') {
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
    const blockers = [...new Set(decision.violations.filter((message) => !secondary.has(message)))]
    const provisional = [
      ...new Set(decision.violations.filter((message) => secondary.has(message))),
    ]
    const shown = enabled('verbose') ? blockers : blockers.slice(0, 20)
    const results = candidate.evidence
      ? (['passed', 'failed', 'missing'] as const)
          .flatMap((status) => {
            const count = candidate.evidence!.checks.filter(
              (check) => check.status === status,
            ).length
            return count ? [`${count} ${status}`] : []
          })
          .join(` ${symbol('·', '.')} `) || 'no results'
      : candidate.source.problems.some((problem) =>
            problem.startsWith('Evidence collection interrupted:'),
          )
        ? 'not completed'
        : 'not run'
    const recovery = invocation(['config', 'show'])
    const lines = [
      `${symbol('△', '!')} Incomplete`,
      '',
      'Blocking issues',
      ...shown.map((message) => `- ${message}`),
      ...(shown.length < blockers.length
        ? [`${blockers.length - shown.length} more blocking issues. Use --verbose to show all`]
        : []),
      '',
      'Verification',
      `  ${symbol('├─', '|-')} Required checks: ${results} (${candidate.contracts.checks.length} expected)`,
      `  ${symbol('└─', "'-")} Discovered contract surface: ${decision.surface} ${decision.surface === 1 ? 'pair' : 'pairs'}`,
      '',
      'Inventory measurements',
      `  ${symbol('├─', '|-')} Retained: ${decision.retained} tokens`,
      `  ${decision.requiredReduction ? symbol('├─', '|-') : symbol('└─', "'-")} Configured ceiling: ${decision.ceiling} tokens`,
      ...(decision.requiredReduction
        ? [
            `  ${symbol('└─', "'-")} Potential overage: ${decision.requiredReduction} tokens (provisional)`,
          ]
        : []),
      ...(enabled('verbose') && provisional.length
        ? ['', 'Additional findings (provisional)', ...provisional.map((message) => `- ${message}`)]
        : provisional.length
          ? ['', 'Use --verbose for all provisional findings']
          : []),
      '',
      `Next ${symbol('→', '->')} ${recovery}`,
    ]
    await emit({ decision, snapshot: candidate }, rows, lines)
    if (!json && (!human || quiet)) {
      for (const blocker of shown) write(`incomplete: ${blocker}`, process.stderr)
      if (enabled('verbose'))
        for (const finding of provisional)
          write(`incomplete (provisional): ${finding}`, process.stderr)
      if (shown.length < blockers.length)
        write(
          `${blockers.length - shown.length} more blocking issues. Use --verbose to show all`,
          process.stderr,
        )
      write(`Next ${symbol('→', '->')} ${recovery}`, process.stderr)
    }
    process.exitCode = 2
    return
  }
  const glyph =
    decision.status === 'pass'
      ? symbol('✓', '+')
      : decision.status === 'reject'
        ? symbol('✗', 'x')
        : symbol('△', '!')
  const label =
    decision.status === 'pass' ? 'Pass' : decision.status === 'reject' ? 'Rejected' : 'Incomplete'
  const lines = [
    `${glyph} ${label}`,
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
  const subject = candidate.unrooted[0] ?? candidate.source.components[0]?.id
  const recovery = subject ? invocation(['explain', subject]) : invocation(['config', 'show'])
  const violations = enabled('verbose') ? decision.violations : decision.violations.slice(0, 20)
  if (violations.length)
    lines.push(
      '',
      ...violations.map((violation) => `- ${violation}`),
      `Next ${symbol('→', '->')} ${recovery}`,
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
  if (counters.length) lines.push('', counters.join(` ${symbol('·', '.')} `))
  await emit({ decision, snapshot: candidate }, rows, lines)
  if (!json && decision.status !== 'pass' && (!human || quiet)) {
    for (const violation of violations) write(`${decision.status}: ${violation}`, process.stderr)
    write(`Next ${symbol('→', '->')} ${recovery}`, process.stderr)
  }
  process.exitCode = decision.status === 'pass' ? 0 : decision.status === 'reject' ? 1 : 2
}

main()
  .catch((error) => {
    if (!stopping) {
      if (error instanceof CliError && error.code === 'TIMEOUT') stop(error)
      else reportError(error)
    }
  })
  .finally(clean)
