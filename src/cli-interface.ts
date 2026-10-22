import manifest from '../package.json' with { type: 'json' }

export const version = manifest.version
export const docsUrl = 'https://github.com/jiggy/bonsai/blob/main/docs/cli.md'

export const flags = {
  root: {
    type: 'string',
    short: 'r',
    description: 'project directory (default current directory)',
    scope: ['check', 'explain', 'config'],
  },
  base: {
    type: 'string',
    description: 'Git base revision supplying trusted rules',
    scope: ['check', 'explain', 'config'],
  },
  policy: {
    type: 'string',
    description: 'explicit policy file, or - for piped JSON',
    scope: ['check', 'explain', 'config'],
  },
  timeout: {
    type: 'string',
    description: 'command deadline in seconds (default none)',
    scope: ['check', 'explain', 'config'],
  },
  json: { type: 'boolean', short: 'j', description: 'write JSON data and JSON errors' },
  plain: { type: 'boolean', description: 'write headerless tab-separated records' },
  output: {
    type: 'string',
    short: 'o',
    description: 'output: auto, human, plain, json (default auto)',
  },
  pretty: { type: 'boolean', description: 'indent JSON (default only on a terminal)' },
  quiet: { type: 'boolean', short: 'q', description: 'suppress human results and progress' },
  verbose: {
    type: 'boolean',
    short: 'v',
    description: 'show all result details, overrides --quiet',
  },
  debug: { type: 'boolean', short: 'd', description: 'show error traces on stderr' },
  'no-color': { type: 'boolean', description: 'disable ANSI color and styling' },
  'no-input': { type: 'boolean', description: 'disable prompts, including at a terminal' },
  interactive: {
    type: 'boolean',
    short: 'i',
    description: 'enable prompts when stdin and stderr are terminals',
  },
  markdown: { type: 'boolean', description: 'generate the CLI reference', scope: ['help'] },
  help: { type: 'boolean', short: 'h', description: 'show help (-h concise, --help complete)' },
  version: { type: 'boolean', short: 'V', description: 'show the installed version' },
} satisfies Record<
  string,
  { type: 'string' | 'boolean'; short?: string; description: string; scope?: string[] }
>

export type CommandName = keyof typeof commands
export const commands = {
  check: {
    summary: 'Check behavior, ancestry, and the retained-code budget',
    usage: 'bonsai check [flags]',
    description:
      'Runs the project’s named handlers in a worker. A rejected or incomplete gate blocks acceptance.',
    examples: [
      'bonsai check',
      'bonsai check --root examples/checkout --json',
      'bonsai check --base origin/main --verbose',
    ],
  },
  explain: {
    summary: 'Show why a file or component is retained',
    usage: 'bonsai explain <file-or-component> [flags]',
    description:
      'Inspects ancestry and relationships without running handlers. Use - to read one target per line from stdin.',
    examples: [
      'bonsai explain src/checkout.ts --root examples/checkout',
      "bonsai explain 'src/checkout.ts#placeOrder' --root examples/checkout --json",
      "printf 'src/checkout.ts\\n' | bonsai explain - --root examples/checkout --plain",
    ],
  },
  config: {
    summary: 'Show the effective project configuration and its origin',
    usage: 'bonsai config show [flags]',
    description:
      'Reads the same policy and inventory as check, including trusted base rules. Never runs handlers or changes configuration.',
    examples: [
      'bonsai config show --root examples/checkout',
      'bonsai config show --base origin/main --json',
    ],
  },
  completion: {
    summary: 'Generate shell completions',
    usage: 'bonsai completion <bash|zsh|fish|powershell> [flags]',
    description:
      'Writes a completion script to stdout. Review and install it in your shell’s completion directory.',
    examples: ['bonsai completion bash > bonsai.bash', 'bonsai completion fish > bonsai.fish'],
  },
  help: {
    summary: 'Show command help and machine-readable capabilities',
    usage: 'bonsai help [command] [flags]',
    description:
      'Shows command-specific help without reading project files. JSON describes commands, options, examples, and exit codes.',
    examples: [
      'bonsai help check',
      'bonsai help explain --json',
      'bonsai help --markdown > docs/cli.md',
    ],
  },
  version: {
    summary: 'Show the installed version',
    usage: 'bonsai version [flags]',
    description: 'Reads the packaged version without loading a project or contacting the network.',
    examples: ['bonsai version', 'bonsai version --json'],
  },
}

export const exitCodes = {
  0: 'success or gate pass',
  1: 'gate rejection or runtime failure',
  2: 'incomplete gate, invalid input, or usage error',
  3: 'permission denied',
  4: 'component or file not found by explain',
  130: 'interrupted by SIGINT',
  143: 'stopped by SIGTERM',
}

export function commandFlags(command?: CommandName) {
  return Object.entries(flags).filter(
    ([, flag]) => !('scope' in flag) || (command ? flag.scope.includes(command) : false),
  )
}

export function helpData(command?: CommandName) {
  return {
    name: 'bonsai',
    version,
    command: command ?? null,
    description: command
      ? commands[command].summary
      : 'Keep required behavior within a retained-code budget',
    usage: command ? commands[command].usage : 'bonsai <command> [flags]',
    commands: command ? { [command]: commands[command] } : commands,
    flags: Object.fromEntries(commandFlags(command)),
    exitCodes,
    docs: docsUrl,
  }
}

export function helpText(command?: CommandName, concise = false): string {
  const info = helpData(command)
  const examples = command
    ? commands[command].examples
    : [
        'bonsai check --root examples/checkout',
        'bonsai explain src/checkout.ts --root examples/checkout',
        'bonsai help check --json',
      ]
  const lines = [info.description, '', 'USAGE', `  ${info.usage}`]
  if (command && !concise) lines.push('', commands[command].description)
  if (!command) {
    lines.push('', 'PROJECT COMMANDS')
    for (const name of ['check', 'explain', 'config'] as const)
      lines.push(`  ${name.padEnd(12)}${commands[name].summary}`)
    lines.push('', 'OTHER COMMANDS')
    for (const name of ['completion', 'help', 'version'] as const)
      lines.push(`  ${name.padEnd(12)}${commands[name].summary}`)
  }
  lines.push(
    '',
    'EXAMPLES',
    ...examples.slice(0, concise ? 2 : 3).map((text) => `  $ ${text}`),
    '',
    'OPTIONS',
  )
  for (const [name, flag] of commandFlags(command)) {
    if (concise && !['root', 'json', 'help', 'version'].includes(name)) continue
    const label = `${'short' in flag ? `-${flag.short}, ` : '    '}--${name}${flag.type === 'string' ? ' string' : ''}`
    lines.push(`  ${label.padEnd(26)}${flag.description}`)
  }
  if (!concise) {
    lines.push(
      '',
      'EXIT CODES',
      ...Object.entries(exitCodes).map(([code, text]) => `  ${code.padEnd(5)}${text}`),
    )
    if (command && ['check', 'explain', 'config'].includes(command))
      lines.push(
        '',
        'ENVIRONMENT',
        '  Flags override BONSAI_ROOT, BONSAI_BASE, and BONSAI_POLICY',
        '  --base supplies project policy unless --policy is explicit',
      )
  }
  lines.push(
    '',
    'See also: bonsai help check, bonsai help explain',
    `Docs: ${docsUrl}${command ? `#${command}` : ''}`,
  )
  return lines.join('\n')
}

export function markdownHelp(): string {
  return [
    `# CLI reference`,
    '',
    `Bonsai ${version}. Generated with \`bonsai help --markdown\`.`,
    '',
    ...Object.keys(commands).flatMap((name) => [
      `## ${name}`,
      '',
      '```text',
      helpText(name as CommandName),
      '```',
      '',
    ]),
  ]
    .join('\n')
    .trimEnd()
}

export function completion(shell: string): string {
  const names = Object.keys(commands).join(' ')
  const options = Object.keys(flags)
    .map((name) => `--${name}`)
    .join(' ')
  const words = `${names} ${options} show bash zsh fish powershell`
  if (shell === 'bash')
    return `_bonsai() {\n  local current="\${COMP_WORDS[COMP_CWORD]}"\n  COMPREPLY=()\n  if [[ "$current" == -* || "$COMP_CWORD" -eq 1 ]]; then\n    mapfile -t COMPREPLY < <(compgen -W '${words}' -- "$current")\n  else\n    mapfile -t COMPREPLY < <(compgen -f -- "$current")\n  fi\n}\ncomplete -o default -F _bonsai bonsai`
  if (shell === 'zsh')
    return `#compdef bonsai\n_bonsai() {\n  local -a words\n  words=(${words})\n  _describe 'bonsai commands and options' words\n  _files\n}\ncompdef _bonsai bonsai`
  if (shell === 'fish')
    return [
      'complete -c bonsai -f',
      ...Object.entries(commands).map(
        ([name, command]) =>
          `complete -c bonsai -n '__fish_use_subcommand' -a '${name}' -d '${command.summary}'`,
      ),
      ...Object.entries(flags).map(
        ([name, flag]) =>
          `complete -c bonsai -l '${name}'${'short' in flag ? ` -s '${flag.short}'` : ''}${flag.type === 'string' ? ' -r' : ''} -d '${flag.description}'`,
      ),
    ].join('\n')
  return `Register-ArgumentCompleter -Native -CommandName bonsai -ScriptBlock {\n  param($wordToComplete, $commandAst, $cursorPosition)\n  '${words}'.Split(' ') | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {\n    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)\n  }\n}`
}

export class CliError extends Error {
  constructor(
    message: string,
    public code: string,
    public run: string,
    public exitCode = 2,
  ) {
    super(message)
  }
}

export function suggest(value: string, candidates: string[]): string {
  const distance = (a: string, b: string): number => {
    let row = Array.from({ length: b.length + 1 }, (_, index) => index)
    for (let i = 0; i < a.length; i++) {
      const next = [i + 1]
      for (let j = 0; j < b.length; j++)
        next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j])))
      row = next
    }
    return row[b.length]
  }
  const matches = candidates
    .map((name) => ({ name, distance: distance(value, name) }))
    .filter((item) => item.distance <= 2)
    .sort((a, b) => a.distance - b.distance)
  return matches.length && (matches.length === 1 || matches[0].distance < matches[1].distance)
    ? `Did you mean '${matches[0].name}'?`
    : `Choose from: ${candidates.join(', ')}`
}

export function colorEnabled(tty: boolean | undefined, noColor: boolean): boolean {
  if (noColor || process.env.NO_COLOR || process.env.BONSAI_NO_COLOR || process.env.TERM === 'dumb')
    return false
  if (process.env.FORCE_COLOR === '0') return false
  return Boolean(process.env.FORCE_COLOR || tty)
}

export function wrap(text: string, width: number): string {
  return text
    .split('\n')
    .flatMap((line) => {
      if (line.length <= width) return [line]
      const indent = line.match(/^\s*/)?.[0] ?? ''
      const result: string[] = []
      let current = ''
      for (const word of line.trim().split(/\s+/)) {
        if (current && current.length + word.length + 1 > width - indent.length) {
          result.push(indent + current)
          current = ''
        }
        current += `${current ? ' ' : ''}${word}`
      }
      return [...result, indent + current]
    })
    .join('\n')
}
