import manifest from '../package.json' with { type: 'json' }
import { stripVTControlCharacters } from 'node:util'

export const version = manifest.version
export const docsUrl = 'https://github.com/jiggy/bonsai/blob/main/docs/cli.md'

export const flags = {
  root: {
    type: 'string',
    short: 'r',
    description: 'project directory (default current directory)',
    completion: 'directory',
    scope: ['init', 'check', 'explain', 'config'],
  },
  base: {
    type: 'string',
    description: 'Git base revision supplying trusted rules',
    scope: ['check', 'explain', 'config'],
  },
  policy: {
    type: 'string',
    description: 'explicit policy file, or - for piped JSON',
    completion: 'file',
    scope: ['check', 'explain', 'config'],
  },
  engine: {
    type: 'string',
    description: 'compatibility option: rust (always used by default)',
    choices: ['rust'],
    scope: ['check', 'explain'],
  },
  serial: {
    type: 'boolean',
    description: 'run scenarios in order with shared application state',
    scope: ['check'],
  },
  report: {
    type: 'string',
    description: 'offline HTML path relative to --root (default .bonsai/report.html)',
    completion: 'file',
    scope: ['check'],
  },
  'no-report': {
    type: 'boolean',
    description: 'skip writing the offline HTML report',
    scope: ['check'],
  },
  timeout: {
    type: 'string',
    description: 'command deadline in seconds (default none)',
    scope: ['init', 'check', 'explain', 'config'],
  },
  limit: {
    type: 'string',
    description: 'maximum human results (default 20, 0 shows all)',
    scope: ['check', 'explain'],
  },
  json: { type: 'boolean', short: 'j', description: 'write JSON data and JSON errors' },
  plain: { type: 'boolean', description: 'write headerless tab-separated records' },
  output: {
    type: 'string',
    short: 'o',
    description: 'output: auto, human, plain, json (default auto)',
    choices: ['auto', 'human', 'plain', 'json'],
  },
  pretty: { type: 'boolean', description: 'indent JSON (default only on a terminal)' },
  quiet: { type: 'boolean', short: 'q', description: 'suppress human results and progress' },
  verbose: {
    type: 'boolean',
    short: 'v',
    description: 'show detailed results and check timings, overrides --quiet',
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
  {
    type: 'string' | 'boolean'
    short?: string
    description: string
    scope?: string[]
    choices?: string[]
    completion?: 'directory' | 'file'
  }
>

export type CommandName = keyof typeof commands
export const commands = {
  init: {
    summary: 'Initialize local configuration and starter contracts',
    usage: 'bonsai init [flags]',
    description:
      'Creates bonsai.json and missing starter bindings and a feature without overwriting files or running handlers. Replace the starter behavior with contracts for real handlers.',
    examples: [
      'bonsai init',
      'bonsai init --root packages/checkout',
      'bonsai init --root packages/checkout --json',
    ],
  },
  check: {
    summary: 'Check behavior, ancestry, and the retained-code budget',
    usage: 'bonsai check [flags]',
    description:
      'Runs independent scenarios concurrently in fresh workers, using available CPU capacity and at most one worker per scenario. Use --serial for ordered scenarios sharing application state. Checks source with the native Rust TypeScript checker. Rejected or incomplete gates block acceptance. Saves an offline .bonsai/report.html after evaluation without changing console output. Use --report PATH to choose another destination or --no-report to skip the file. Phase timings appear in --verbose and --json.',
    examples: [
      'bonsai check',
      'bonsai check --root examples/checkout --serial',
      'bonsai check --root examples/checkout --report .bonsai/review.html --json',
    ],
  },
  explain: {
    summary: 'Show why a file or component is retained',
    usage: 'bonsai explain <file-or-component> [flags]',
    description:
      'Inspects ancestry and relationships with the native Rust TypeScript checker without running handlers. Use - to read one target per line from stdin.',
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
        'bonsai init',
        'bonsai check --root examples/checkout',
        'bonsai explain src/checkout.ts --root examples/checkout',
      ]
  const lines = [info.description, '', 'USAGE', `  ${info.usage}`]
  if (command && !concise) lines.push('', commands[command].description)
  if (!command) {
    lines.push('', 'PROJECT COMMANDS')
    for (const name of ['init', 'check', 'explain', 'config'] as const)
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
    if (command === 'init') lines.push('', 'ENVIRONMENT', '  --root overrides BONSAI_ROOT')
    else if (command && ['check', 'explain', 'config'].includes(command))
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

export type PresentationOptions = { width?: number; color?: boolean; ascii?: boolean }
export type HumanLine =
  | string
  | {
      text: string
      role:
        | 'success'
        | 'error'
        | 'warning'
        | 'info'
        | 'text'
        | 'detail'
        | 'heading'
        | 'summary'
        | 'command'
    }

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const segments = (text: string) => [...graphemes.segment(text)].map((item) => item.segment)

export function displayWidth(text: string): number {
  return segments(stripVTControlCharacters(text)).reduce((total, segment) => {
    if (/^[\p{Mark}\p{Control}\u200d\ufe0e\ufe0f]+$/u.test(segment)) return total
    const code = segment.codePointAt(0) ?? 0
    const wide =
      /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(segment) ||
      (code >= 0x1100 &&
        (code <= 0x115f ||
          code === 0x2329 ||
          code === 0x232a ||
          (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
          (code >= 0xac00 && code <= 0xd7a3) ||
          (code >= 0xf900 && code <= 0xfaff) ||
          (code >= 0xfe10 && code <= 0xfe6f) ||
          (code >= 0xff01 && code <= 0xff60) ||
          (code >= 0xffe0 && code <= 0xffe6) ||
          (code >= 0x20000 && code <= 0x3fffd)))
    return total + (wide ? 2 : 1)
  }, 0)
}

function asciiText(text: string, ascii = false): string {
  if (!ascii) return text
  const replacements: Record<string, string> = {
    '✓': '+',
    '✗': 'x',
    '△': '!',
    '⊘': 'o',
    '−': '-',
    '–': '-',
    '—': '-',
    '├─': '|-',
    '└─': "'-",
    '│': '|',
    '→': '->',
    '·': '.',
    '…': '...',
    '’': "'",
    '‘': "'",
    '“': '"',
    '”': '"',
  }
  return text.replace(/├─|└─|[✓✗△⊘−–—│→·…’‘“”]/g, (glyph) => replacements[glyph])
}

function shorten(text: string, width: number, ascii: boolean): string {
  if (displayWidth(text) <= width) return text
  const ellipsis = ascii ? '...'.slice(0, width) : '…'
  const parts = segments(stripVTControlCharacters(text))
  let left = '',
    right = ''
  const available = width - displayWidth(ellipsis)
  while (parts.length) {
    const takeLeft = displayWidth(left) <= displayWidth(right)
    const next = takeLeft ? parts[0] : parts[parts.length - 1]
    if (displayWidth(left + right + next) > available) break
    if (takeLeft) left += parts.shift()
    else right = parts.pop() + right
  }
  return left + ellipsis + right
}

function paragraph(
  text: string,
  width: number,
  first = '',
  continuation = first,
  ascii = false,
): string[] {
  const result: string[] = []
  let prefix = first,
    current = ''
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if (current && displayWidth(prefix + current + ' ' + word) > width) {
      result.push(prefix + current)
      prefix = continuation
      current = ''
    }
    const fitted = /^https?:\/\//.test(word)
      ? word
      : shorten(word, Math.max(1, width - displayWidth(prefix)), ascii)
    current += `${current ? ' ' : ''}${fitted}`
  }
  return [...result, prefix + current]
}

export function wrap(text: string, width: number, options: { ascii?: boolean } = {}): string {
  const columns = Math.max(1, Math.floor(width) || 80)
  return asciiText(text, options.ascii)
    .split('\n')
    .flatMap((line) => {
      if (displayWidth(line) <= columns) return [line]
      const item = line.match(/^(\s*(?:├─|└─|\|-|'-|[-✗✓△x+!])\s+)(.*)$/)
      const indent = line.match(/^\s*/)?.[0] ?? ''
      return paragraph(
        item ? item[2] : line.trim(),
        columns,
        item ? item[1] : indent,
        item ? ' '.repeat(displayWidth(item[1])) : indent,
        options.ascii,
      )
    })
    .join('\n')
}

const columns = (options: PresentationOptions) =>
  Math.max(20, Math.floor(options.width ?? 80) || 80)
const tone = (text: string, code: number, options: PresentationOptions) =>
  options.color && text ? `\x1b[${code}m${text}\x1b[0m` : text

function helpRow(
  line: string,
  column: number,
  options: PresentationOptions,
  command = false,
): string[] {
  const label = line.slice(0, column).trimEnd()
  const description = line.slice(column)
  const width = columns(options)
  const labelColor = command ? 36 : 37
  if (width - column < 20)
    return [
      tone('  ' + label.trim(), labelColor, options),
      ...paragraph(description, width, '    ', '    ', options.ascii).map((text) =>
        tone(text, 2, options),
      ),
    ]
  return paragraph(description, width, ' '.repeat(column), ' '.repeat(column), options.ascii).map(
    (text, index) =>
      (index === 0 ? tone(label.padEnd(column), labelColor, options) : ' '.repeat(column)) +
      tone(text.slice(column), 2, options),
  )
}

/** Terminal layout is separate from canonical help used by docs and redirected output. */
export function renderHelp(
  command?: CommandName,
  concise = false,
  options: PresentationOptions = {},
): string {
  let section = ''
  return asciiText(helpText(command, concise), options.ascii)
    .split('\n')
    .flatMap((line, index) => {
      if (!line) return ['']
      if (/^[A-Z][A-Z ]+$/.test(line)) {
        section = line
        return [tone(tone(line, 1, options), 90, options)]
      }
      // Commands and URLs stay intact so wrapping cannot change what users copy.
      if (line.startsWith('  $ '))
        return [tone('  $ ', 90, options) + tone(line.slice(4), 36, options)]
      if (section === 'USAGE' && line.startsWith('  ')) return [tone(line, 36, options)]
      if (line.startsWith('Docs: '))
        return [tone('Docs: ', 2, options) + tone(line.slice(6), 36, options)]
      if (line.startsWith('See also: '))
        return wrap(line, columns(options), options)
          .split('\n')
          .map((text) => tone(text, 2, options))
      if (line.startsWith('  ') && section === 'OPTIONS') return helpRow(line, 28, options)
      if (line.startsWith('  ') && section === 'EXIT CODES') return helpRow(line, 7, options)
      if (line.startsWith('  ') && ['PROJECT COMMANDS', 'OTHER COMMANDS'].includes(section))
        return helpRow(line, 14, options, true)
      return wrap(line, columns(options), options)
        .split('\n')
        .map((text) => tone(text, index === 0 ? 37 : 2, options))
    })
    .join('\n')
}

function humanLine(line: string, options: PresentationOptions): string {
  const status = line.match(/^([✓✗△+x!]) (.*)$/)
  if (status) {
    const color = ['✓', '+'].includes(status[1]) ? 32 : ['✗', 'x'].includes(status[1]) ? 31 : 33
    return tone(tone(status[1], 1, options), color, options) + ' ' + tone(status[2], 2, options)
  }
  const tree = line.match(/^(\s*(?:├─|└─|\|-|'-)) (.*)$/)
  if (tree) return tone(tree[1], 90, options) + ' ' + tone(tree[2], 2, options)
  const next = line.match(/^(\s*Next (?:→|->) )(.*)$/)
  if (next) return tone(next[1], 90, options) + tone(next[2], 36, options)
  if (/^\d+ (?:checks? passed|unrooted|violations?|components?)(?:$|[ .·])/.test(line))
    return tone(line, 1, options)
  const field = line.match(/^([^:]+:)( .*?)$/)
  if (field) return tone(field[1], 2, options) + tone(field[2], 37, options)
  return tone(line, line.includes('#') && !line.startsWith(' ') ? 37 : 2, options)
}

/** Carry meaning through wrapping; indentation is not a severity. */
function semanticLine(
  line: string,
  role: Exclude<HumanLine, string>['role'],
  options: PresentationOptions,
): string {
  const next = line.match(/^(\s*Next (?:→|->) )(.*)$/)
  if (next) return tone(next[1], 90, options) + tone(next[2], role === 'command' ? 36 : 37, options)
  if (role === 'command') return tone(line, 36, options)
  if (role === 'summary')
    return line
      .split(/ (?:·|\.) /)
      .map((part) => {
        const color = /\b(?:blockers?|violations?)\b/.test(part)
          ? 31
          : /not run|not completed|provisional/.test(part)
            ? 33
            : 37
        return tone(tone(part, 1, options), color, options)
      })
      .join(tone(asciiText(' · ', options.ascii), 90, options))
  const tree = line.match(/^(\s*(?:├─|└─|\|-|'-) )(.*)$/)
  const prefix = tree ? tone(tree[1], 90, options) : ''
  const content = tree ? tree[2] : line
  const indicator = content.match(/^([✓✗△i+x!]) (.*)$/)
  const color =
    role === 'error'
      ? 31
      : role === 'warning'
        ? 33
        : role === 'success'
          ? 32
          : role === 'info'
            ? 34
            : 37
  if (indicator)
    return (
      prefix +
      tone(tone(indicator[1], 1, options), color, options) +
      ' ' +
      tone(indicator[2], role === 'info' ? 37 : color, options)
    )
  if (role === 'detail') return prefix + tone(content, 2, options)
  if (role === 'text') {
    const field = content.match(/^([^:]+:)( .*)$/)
    if (field) return prefix + tone(field[1], 2, options) + tone(field[2], 37, options)
  }
  return prefix + tone(content, color, options)
}

export function renderHuman(
  command: CommandName,
  lines: HumanLine[],
  options: PresentationOptions & { header?: boolean } = {},
): string {
  const header = options.header
    ? tone(tone('bonsai', 1, options), 36, options) +
      tone(asciiText(' · ', options.ascii), 90, options) +
      tone(command, 2, options) +
      '\n\n'
    : ''
  return (
    header +
    lines
      .flatMap((line) => {
        const text = asciiText(
          stripVTControlCharacters(typeof line === 'string' ? line : line.text),
          options.ascii,
        )
        const laidOut = /^Next (?:→|->) bonsai\b/.test(text)
          ? text
          : wrap(text, columns(options), options)
        return laidOut
          .split('\n')
          .map((part) =>
            typeof line === 'string'
              ? humanLine(part, options)
              : semanticLine(part, line.role, options),
          )
      })
      .join('\n')
  )
}

export function renderError(
  message: string,
  run: string,
  options: PresentationOptions = {},
): string {
  const prefix = asciiText('  Next → ', options.ascii)
  const error = wrap(asciiText(`✗ ${message}`, options.ascii), columns(options), options)
  const recovery = run.startsWith('bonsai ')
    ? [prefix + run]
    : paragraph(
        asciiText(run, options.ascii),
        columns(options),
        prefix,
        ' '.repeat(displayWidth(prefix)),
        options.ascii,
      )
  return [
    ...error.split('\n').map((line) => semanticLine(line, 'error', options)),
    ...recovery.map((line) =>
      semanticLine(line, run.startsWith('bonsai ') ? 'command' : 'text', options),
    ),
  ].join('\n')
}
