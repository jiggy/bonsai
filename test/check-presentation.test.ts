import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { displayWidth } from '../src/cli-interface.ts'

const executable = resolve('src/cli.ts')
const hasPty = process.platform === 'linux' && spawnSync('script', ['--version']).status === 0
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
const withoutElapsed = (text: string) =>
  text.replace(/\b\d+(?:\.\d+)?\s*(?:ms|s)(?= elapsed\b)/g, '<duration>')

function fixture(
  options: {
    draft?: boolean
    broken?: boolean
    unused?: number
    budget?: number
    feedbackMs?: number
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-check-presentation-'))
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  writeFileSync(
    join(root, 'handler.ts'),
    [
      'export function sample(input: { quantity: number }) {',
      `  return { status: ${options.broken ? "'accepted'" : "input.quantity > 0 ? 'accepted' : 'rejected'"} }`,
      '}',
      ...Array.from(
        { length: options.unused ?? 0 },
        (_, index) =>
          `export function unused${String(index).padStart(2, '0')}() { return ${index} }`,
      ),
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'bindings.ts'),
    options.draft
      ? 'export const actions = {}\n'
      : "import { sample } from './handler.ts'\nexport const actions = { 'sample': sample }\n",
  )
  writeFileSync(
    join(root, 'sample.feature'),
    options.draft
      ? '# Feature: Replace the commented starter\n'
      : 'Feature: Sample\nScenario Outline: Submit\n When I invoke "sample" with {"quantity": <quantity>}\n Then response "status" equals "<status>"\n Examples:\n | quantity | status |\n | 1 | accepted |\n | 0 | rejected |\n',
  )
  writeFileSync(
    join(root, 'bonsai.json'),
    JSON.stringify({
      maintained: ['handler.ts', 'bindings.ts', 'sample.feature', 'bonsai.json', 'package.json'],
      bindings: 'bindings.ts',
      policy: {
        bootstrap: options.budget ?? 10000,
        bootstrapSurface: 1,
        perDoubling: 0,
        hardLimit: options.budget ?? 10000,
        maxFeedbackMs: options.feedbackMs ?? 15000,
      },
    }),
  )
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function run(
  root: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = {},
  tty = false,
  redirect = '',
) {
  const command = [process.execPath, executable, 'check', '--root', root, ...args]
  const result = spawnSync(
    tty ? 'script' : process.execPath,
    tty ? ['-qefc', command.map(quote).join(' ') + redirect, '/dev/null'] : command.slice(1),
    {
      encoding: 'utf8',
      input: '',
      timeout: 20000,
      env: {
        ...process.env,
        BONSAI_ROOT: undefined,
        BONSAI_BASE: undefined,
        BONSAI_POLICY: undefined,
        BONSAI_NO_COLOR: '',
        NO_COLOR: '',
        FORCE_COLOR: '',
        CI: '1',
        COLUMNS: '80',
        TERM: 'xterm-256color',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        ...env,
      },
    },
  )
  assert.equal(result.error, undefined, String(result.error) + result.stdout + result.stderr)
  return {
    ...result,
    stdout: result.stdout.replaceAll('\r\n', '\n'),
    stderr: result.stderr.replaceAll('\r\n', '\n'),
  }
}

/** Inspect terminal-visible characters, so a reset or dim attribute cannot hide a colored alert. */
function characters(text: string) {
  const result: { value: string; color: number | undefined; dim: boolean }[] = []
  let color: number | undefined
  let dim = false
  let cursor = 0
  for (const match of text.matchAll(/\x1b\[([\d;]*)m/g)) {
    for (const value of text.slice(cursor, match.index)) result.push({ value, color, dim })
    for (const code of (match[1] || '0').split(';').map(Number)) {
      if (code === 0) {
        color = undefined
        dim = false
      } else if (code === 2) dim = true
      else if (code === 22) dim = false
      else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) color = code
      else if (code === 39) color = undefined
    }
    cursor = match.index + match[0].length
  }
  for (const value of text.slice(cursor)) result.push({ value, color, dim })
  return result
}

function expectColor(text: string, phrase: string, color: number) {
  const visible = characters(text)
  const plain = visible.map((character) => character.value).join('')
  const start = plain.indexOf(phrase)
  assert.ok(start >= 0, `${JSON.stringify(phrase)} missing from ${plain}`)
  for (const character of visible
    .slice(start, start + phrase.length)
    .filter((character) => character.value.trim())) {
    assert.equal(
      character.color,
      color,
      `${JSON.stringify(phrase)} must use semantic ANSI ${color}`,
    )
    assert.equal(character.dim, false, `${JSON.stringify(phrase)} must remain readable`)
  }
}

test('incomplete terminal checks give blockers a red alert state instead of dimming them', {
  skip: !hasPty,
}, () => {
  const { root, dispose } = fixture({ draft: true })
  try {
    const result = run(root, [], {}, true)
    assert.equal(result.status, 2, result.stdout + result.stderr)
    const output = result.stdout + result.stderr
    expectColor(output, 'Incomplete', 33)
    expectColor(output, 'No executable scenarios', 31)
    expectColor(output, '✗', 31)
    assert.match(stripVTControlCharacters(output), /sample.feature/)
    assert.match(stripVTControlCharacters(output), /bindings.ts/)
    const command = `bonsai check --root ${root}`
    expectColor(output, command, 36)
    const monochrome = run(root, ['--no-color'], {}, true)
    assert.equal(monochrome.status, 2, monochrome.stderr)
    assert.doesNotMatch(monochrome.stdout + monochrome.stderr, /\x1b\[/)
    assert.equal(
      withoutElapsed(stripVTControlCharacters(output)),
      withoutElapsed(monochrome.stdout + monochrome.stderr),
    )
  } finally {
    dispose()
  }
})

test('rejected checks preserve red failure states for assertions, ancestry, and budget', {
  skip: !hasPty,
}, () => {
  for (const options of [{ broken: true }, { unused: 1 }, { budget: 1 }]) {
    const { root, dispose } = fixture(options)
    try {
      const result = run(root, [], {}, true)
      assert.equal(result.status, 1, result.stdout + result.stderr)
      expectColor(result.stdout + result.stderr, 'Rejected', 31)
      expectColor(result.stdout + result.stderr, '✗', 31)
      assert.match(stripVTControlCharacters(result.stdout + result.stderr), /Fix:|Next →/)
    } finally {
      dispose()
    }
  }
})

test('wrapped blocker continuations keep their alert role and commands remain copyable', {
  skip: !hasPty,
}, () => {
  const { root, dispose } = fixture({ draft: true })
  try {
    for (const width of ['40', '80']) {
      const result = run(root, [], { COLUMNS: width }, true)
      assert.equal(result.status, 2, result.stdout + result.stderr)
      const output = result.stdout + result.stderr
      const visible = characters(output)
      const plain = stripVTControlCharacters(output)
      assert.match(plain, /scenarios/)
      // The final word of this alert wraps on a 40-column terminal.
      expectColor(output, '.feature', 31)
      assert.ok(
        visible.some((character) => character.color === 90),
        'tree/separator styling remains muted',
      )
      assert.ok(
        visible.some((character) => character.color === 37),
        'important names and values remain primary text',
      )
      const command = `bonsai check --root ${root}`
      expectColor(output, command, 36)
      for (const line of plain.trimEnd().split('\n')) {
        if (line.includes('bonsai check --root')) continue
        assert.ok(displayWidth(line) <= Number(width), line)
      }
    }
  } finally {
    dispose()
  }
})

test('machine check records remain complete and uncolored while quiet failures remain visible', () => {
  const { root, dispose } = fixture({ draft: true, unused: 25 })
  try {
    const json = run(root, ['--json', '--limit', '1'], { FORCE_COLOR: '1' })
    assert.equal(json.status, 2, json.stderr)
    assert.doesNotMatch(json.stdout, /\x1b\[/)
    const report = JSON.parse(json.stdout)
    assert.equal(report.decision.status, 'incomplete')
    assert.ok(report.snapshot.unrooted.length >= 25)
    const plain = run(root, ['--plain', '--limit', '1'], { FORCE_COLOR: '1' })
    assert.equal(plain.status, 2, plain.stderr)
    assert.doesNotMatch(plain.stdout, /\x1b\[/)
    assert.equal(plain.stdout.trimEnd().split('\t').length, 8)
    const quiet = run(root, ['--quiet', '--output', 'human'])
    assert.equal(quiet.status, 2, quiet.stderr)
    assert.equal(quiet.stdout, '')
    assert.match(quiet.stderr, /No executable scenarios/)
    assert.doesNotMatch(quiet.stderr, /Checking /)
    assert.doesNotMatch(quiet.stderr, /Timing|elapsed|Feedback window/)
    const ascii = run(root, ['--output', 'human'], { TERM: 'dumb' })
    assert.equal(ascii.status, 2, ascii.stderr)
    assert.doesNotMatch(ascii.stdout + ascii.stderr, /\x1b\[|[^\x00-\x7f]/)
    assert.match(ascii.stderr, /x /)
  } finally {
    dispose()
  }
})

test('verbose human ancestry is grouped and bounded while limit zero exposes every component', () => {
  const { root, dispose } = fixture({ draft: true, unused: 25 })
  try {
    const bounded = run(root, ['--verbose', '--output', 'human', '--limit', '2'])
    assert.equal(bounded.status, 2, bounded.stderr)
    assert.equal(bounded.stdout, '')
    assert.match(bounded.stderr, /handler.ts/)
    assert.match(bounded.stderr, /--limit 0/)
    assert.ok((bounded.stderr.match(/unused\d+/g) ?? []).length <= 2, bounded.stderr)
    assert.doesNotMatch(bounded.stderr, /^- No contract ancestry:/m)
    const all = run(root, ['--verbose', '--output', 'human', '--limit', '0'])
    assert.equal(all.status, 2, all.stderr)
    for (let index = 0; index < 25; index++)
      assert.match(all.stderr, new RegExp(`unused${String(index).padStart(2, '0')}\\b`))
  } finally {
    dispose()
  }
})

test('failed check styling follows stderr capabilities independently of stdout', {
  skip: !hasPty,
}, () => {
  const { root, dispose } = fixture({ draft: true })
  try {
    const diagnostics = join(root, 'diagnostics.txt')
    const redirectedError = run(root, ['--output', 'human'], {}, true, ` 2>${quote(diagnostics)}`)
    assert.equal(redirectedError.status, 2, redirectedError.stdout + redirectedError.stderr)
    assert.equal(redirectedError.stdout, '')
    const saved = readFileSync(diagnostics, 'utf8')
    assert.match(saved, /Incomplete/)
    assert.doesNotMatch(saved, /\x1b\[/)
    const records = join(root, 'records.txt')
    const terminalError = run(root, ['--output', 'human'], {}, true, ` >${quote(records)}`)
    assert.equal(terminalError.status, 2, terminalError.stdout + terminalError.stderr)
    assert.equal(readFileSync(records, 'utf8'), '')
    expectColor(terminalError.stdout + terminalError.stderr, 'No executable scenarios', 31)
  } finally {
    dispose()
  }
})

test('check setup failures use the same readable alert role as gate blockers', () => {
  const { root, dispose } = fixture({ draft: true })
  try {
    rmSync(join(root, 'bonsai.json'))
    const result = run(root, ['--output', 'human'], { FORCE_COLOR: '1' })
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    expectColor(result.stderr, 'Configuration not found:', 31)
    expectColor(result.stderr, `bonsai init --root ${root}`, 36)
    const plain = run(root, ['--output', 'human', '--no-color'], { FORCE_COLOR: '1' })
    assert.doesNotMatch(plain.stderr, /\x1b\[/)
    assert.equal(
      withoutElapsed(stripVTControlCharacters(result.stderr)),
      withoutElapsed(plain.stderr),
    )
  } finally {
    dispose()
  }
})

test('timing values stay primary and interrupted stages use an explicit warning state', {
  skip: !hasPty,
}, () => {
  const { root, dispose } = fixture({ feedbackMs: 0.000001 })
  try {
    const result = run(root, ['--verbose'], {}, true)
    assert.equal(result.status, 2, result.stdout + result.stderr)
    const output = result.stdout + result.stderr
    const plain = stripVTControlCharacters(output)
    const elapsed = plain.match(/\b\d+(?:\.\d+)?\s*(?:ms|s) elapsed\b/)
    assert.ok(elapsed, plain)
    expectColor(output, elapsed[0], 37)
    assert.match(plain, /Timing/)
    const interrupted = plain.match(/Verification[^\n]*interrupted/i)
    assert.ok(interrupted, plain)
    expectColor(output, interrupted[0], 33)
  } finally {
    dispose()
  }
})
