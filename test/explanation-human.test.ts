import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import { displayWidth } from '../src/cli-interface.ts'
import { cliEnvironment, executable, runCli } from './cli.ts'
import { createProject } from './project.ts'
import { characters, hasPty, quote } from './terminal.ts'

function fixture() {
  return createProject({
    'handler.ts': `import { middle } from './subject.ts'
throw new Error('explain must not load application modules')
export function order() { return middle() }
`,
    'subject.ts': `export function middle() { return subject() }
export function subject() { return { status: 'ok' } }
export function unused() { return 'unused' }
`,
    'bindings.ts': `import { order } from './handler.ts'
export const actions = { order: order }
`,
    'unit.test.ts': `import { subject } from './subject.ts'
import { assertValue } from './assertions.test.ts'
export function checksSubject() { return assertValue(subject()) }
`,
    'assertions.test.ts': 'export function assertValue(value: unknown) { return value }\n',
    'orders.feature': `Feature: Orders
Scenario Outline: Place an order
 When I invoke "order" with {"quantity": <quantity>}
 Then response "status" equals "ok"
 Examples:
 | quantity |
 | 1 |
 | 2 |
 | 3 |
`,
  })
}

function run(root: string, target: string, args: string[] = [], tty = false) {
  const command = [process.execPath, executable, 'explain', target, '--root', root, ...args]
  const options = {
    encoding: 'utf8' as const,
    timeout: 20000,
    env: cliEnvironment({
      NO_COLOR: '',
      BONSAI_NO_COLOR: '',
      FORCE_COLOR: '',
      TERM: 'xterm-256color',
      COLUMNS: '40',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    }),
  }
  const result = tty
    ? spawnSync('script', ['-qefc', command.map(quote).join(' '), '/dev/null'], options)
    : runCli(['explain', target, '--root', root, ...args], options)
  assert.equal(result.error, undefined, String(result.error))
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return { stdout: result.stdout.replaceAll('\r\n', '\n'), stderr: result.stderr }
}

test('human explanations show static contract routes and test subjects without running handlers', () => {
  const project = fixture()
  try {
    const result = run(project.root, 'assertions.test.ts#assertValue', ['--output', 'human'])
    assert.equal(result.stderr, '')
    const output = result.stdout.replace(/\s+/g, ' ')
    assert.match(output, /Contract: order \/ status/)
    assert.match(
      output,
      /Path to subject: handler.ts#order → subject.ts#middle → subject.ts#subject/,
    )
    assert.match(output, /Static test subject: subject.ts#subject/)
    assert.match(output, /References: unit.test.ts#checksSubject → subject.ts#subject/)
    assert.match(output, /Support: unit.test.ts#checksSubject → assertions.test.ts#assertValue/)
    assert.match(output, /Explain doesn't run handlers or supporting tests/)
    const registry = run(project.root, 'bindings.ts#actions', ['--output', 'human'])
    assert.match(registry.stdout.replace(/\s+/g, ' '), /Registry: bindings.ts#actions/)
    assert.doesNotMatch(registry.stdout, /Path: bindings.ts#actions.*handler.ts/)
  } finally {
    project.dispose()
  }
})

test('human path limits keep complete machine facts and stable plain columns', () => {
  const project = fixture()
  try {
    const bounded = run(project.root, 'subject.ts#subject', ['--output', 'human', '--limit', '1'])
    assert.equal((bounded.stdout.match(/Contract:/g) ?? []).length, 1)
    assert.match(bounded.stdout.replace(/\s+/g, ' '), /Showing 1 of 3 contract paths/)
    const all = run(project.root, 'subject.ts#subject', ['--output', 'human', '--limit', '0'])
    assert.equal((all.stdout.match(/Contract:/g) ?? []).length, 3)
    assert.doesNotMatch(all.stdout, /Showing /)
    const machine = run(project.root, 'subject.ts#subject', ['--json', '--limit', '1'])
    assert.equal(JSON.parse(machine.stdout).components[0].contractPaths.length, 3)
    assert.doesNotMatch(machine.stdout, /\x1b\[/)
    const plain = run(project.root, 'subject.ts#subject', ['--plain', '--limit', '1'])
    assert.equal(plain.stdout.trimEnd().split('\t').length, 4)
    assert.doesNotMatch(plain.stdout, /Contract:|Path:|\x1b\[/)
  } finally {
    project.dispose()
  }
})

test('terminal path values stay primary through narrow wrapping and structure stays muted', {
  skip: !hasPty,
}, () => {
  const project = fixture()
  try {
    const result = run(project.root, 'subject.ts#subject', ['--limit', '1'], true)
    const plain = stripVTControlCharacters(result.stdout)
    const visible = characters(result.stdout)
    for (const phrase of ['handler.ts#order', 'subject.ts#middle', 'subject.ts#subject']) {
      const index = plain.indexOf(phrase, plain.indexOf('Path:'))
      assert.ok(index >= 0, plain)
      for (const character of visible.slice(index, index + phrase.length)) {
        assert.equal(character.color, 37, phrase)
        assert.equal(character.dim, false, phrase)
      }
    }
    assert.ok(plain.includes('\n     subject.ts#middle'), plain)
    assert.ok(visible.some((character) => character.value === '├' && character.color === 90))
    for (const line of plain.trimEnd().split('\n')) assert.ok(displayWidth(line) <= 40, line)
  } finally {
    project.dispose()
  }
})
