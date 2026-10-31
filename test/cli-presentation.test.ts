import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import {
  commands,
  displayWidth,
  helpText,
  renderError,
  renderHelp,
  renderHuman,
  wrap,
} from '../src/cli-interface.ts'
import { cliEnvironment, executable, runCli } from './cli.ts'
import { characters, hasPty, quote } from './terminal.ts'

const example = resolve('examples/checkout')

function run(args: string[], env: NodeJS.ProcessEnv = {}, tty = false) {
  const command = [process.execPath, executable, ...args]
  const options = {
    encoding: 'utf8' as const,
    timeout: 15000,
    input: '',
    env: cliEnvironment({
      BONSAI_NO_COLOR: '',
      NO_COLOR: '',
      FORCE_COLOR: '',
      COLUMNS: '80',
      TERM: 'xterm-256color',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      ...env,
    }),
  }
  const result = tty
    ? spawnSync('script', ['-qefc', command.map(quote).join(' '), '/dev/null'], options)
    : runCli(args, options)
  return {
    ...result,
    stdout: result.stdout.replaceAll('\r\n', '\n'),
    stderr: result.stderr.replaceAll('\r\n', '\n'),
  }
}

test('terminal help uses the shared visual language and --no-color preserves its content', {
  skip: !hasPty,
}, () => {
  const styled = run(['check', '--help'], {}, true)
  assert.equal(styled.status, 0, styled.stderr)
  for (const code of [1, 2, 36, 90]) assert.ok(styled.stdout.includes(`\x1b[${code}m`))
  const monochrome = run(['check', '--help', '--no-color'], {}, true)
  assert.equal(monochrome.status, 0, monochrome.stderr)
  assert.doesNotMatch(monochrome.stdout, /\x1b\[/)
  assert.equal(stripVTControlCharacters(styled.stdout), monochrome.stdout)
  const config = run(['config', 'show', '--root', example], {}, true)
  assert.equal(config.status, 0, config.stderr)
  assert.match(stripVTControlCharacters(config.stdout), /bonsai · config/)
  for (const code of [1, 2, 36, 90]) assert.ok(config.stdout.includes(`\x1b[${code}m`))
})

test('narrow terminal help keeps examples copyable and descriptions visually attached', {
  skip: !hasPty,
}, () => {
  const narrow = run(['check', '--help', '--no-color'], { COLUMNS: '40' }, true)
  assert.equal(narrow.status, 0, narrow.stderr)
  for (const example of commands.check.examples)
    assert.ok(narrow.stdout.includes(`  $ ${example}\n`))
  assert.match(narrow.stdout, /  -o, --output string\n    output: auto, human, plain, json/)
  const hanging = run(['check', '--help', '--no-color'], { COLUMNS: '60' }, true)
  assert.equal(hanging.status, 0, hanging.stderr)
  assert.match(
    hanging.stdout,
    /  -v, --verbose +show detailed results and check\n {28}timings, overrides --quiet/,
  )
})

test('canonical help and generated documentation stay unstyled when redirected', () => {
  const help = run(['check', '--help'], { FORCE_COLOR: '1', COLUMNS: '40' })
  assert.equal(help.status, 0, help.stderr)
  assert.equal(help.stdout, helpText('check') + '\n')
  const markdown = run(['help', '--markdown'], { FORCE_COLOR: '1' })
  assert.equal(markdown.status, 0, markdown.stderr)
  assert.doesNotMatch(markdown.stdout, /\x1b\[/)
  assert.match(markdown.stdout, /maximum human results \(default 20, 0 shows all\)/)
})

test('conflicting report flags keep wrapped alert text readable without relying on color', {
  skip: !hasPty,
}, () => {
  const args = ['check', '--report', 'report.html', '--no-report']
  const styled = run(args, { COLUMNS: '40' }, true)
  assert.equal(styled.status, 2, styled.stderr)
  const visible = characters(styled.stdout)
  const plain = visible.map((character) => character.value).join('')
  assert.match(plain, /Can't combine --report with\n\s+--no-report/)
  const start = plain.indexOf("Can't combine")
  const end = plain.indexOf('  Next →', start)
  assert.ok(end > start)
  for (const character of visible.slice(start, end).filter((character) => character.value.trim())) {
    assert.equal(character.color, 31, 'Every alert continuation stays red')
    assert.equal(character.dim, false, 'Every alert continuation stays readable')
  }
  for (const line of plain.trimEnd().split('\n')) assert.ok(displayWidth(line) <= 40, line)
  const monochrome = run([...args, '--no-color'], { COLUMNS: '40' }, true)
  assert.equal(monochrome.status, 2, monochrome.stderr)
  assert.doesNotMatch(monochrome.stdout, /\x1b\[/)
  assert.equal(plain, monochrome.stdout)
})

test('human errors wrap to the diagnostic width and ASCII mode covers every structural glyph', () => {
  const result = run(
    ['check', '--root', '/tmp/bonsai-missing-project-with-a-long-directory-name'],
    { COLUMNS: '40', TERM: 'dumb' },
  )
  assert.equal(result.status, 2, result.stderr)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /^x /)
  assert.match(result.stderr, /Next ->/)
  for (const line of result.stderr.trimEnd().split('\n')) assert.ok(displayWidth(line) <= 40, line)
  const rendered = renderHuman(
    'check',
    [
      '△ Incomplete',
      '  ├─ Retained: 500 / 400 tokens',
      '  └─ Required checks: 2 / 3 passed',
      '',
      'Next → bonsai explain src/checkout.ts',
      '',
      '2 checks passed · 1 violations',
    ],
    { ascii: true, header: true, width: 80 },
  )
  assert.doesNotMatch(rendered, /[^\x00-\x7f]/)
  assert.match(rendered, /Next -> bonsai explain src\/checkout.ts/)
})

test('layout measures terminal cells without counting ANSI or splitting graphemes', () => {
  assert.equal(displayWidth('\x1b[36m界e\u0301👩‍💻\x1b[0m'), 5)
  const wrapped = wrap('\x1b[36m界界 e\u0301\x1b[0m', 5)
  assert.equal(stripVTControlCharacters(wrapped), '界界\ne\u0301')
  for (const line of wrapped.split('\n')) assert.ok(displayWidth(line) <= 5)
  const message = 'Component not found: very-long-directory/界界界界界界界界界界界界界界界界.ts'
  const styled = renderError(message, 'bonsai help explain', { width: 40, color: true })
  const plain = renderError(message, 'bonsai help explain', { width: 40 })
  assert.equal(stripVTControlCharacters(styled), plain)
  for (const line of plain.split('\n')) assert.ok(displayWidth(line) <= 40, line)
  assert.equal(
    stripVTControlCharacters(renderHelp('explain', false, { width: 60, color: true })),
    renderHelp('explain', false, { width: 60 }),
  )
})

test('human recovery links remain intact at narrow terminal widths', () => {
  const url = 'https://github.com/jiggy/bonsai/blob/main/docs/roadmap.md'
  const result = renderHuman('check', [{ text: `  └─ Fix: See ${url}`, role: 'text' }], {
    width: 40,
  })
  assert.ok(result.includes(url))
  assert.doesNotMatch(result, /…/)
})
