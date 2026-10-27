import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cliEnvironment, executable, runCli } from './cli.ts'
import { createProject } from './project.ts'
import { characters, hasPty, quote } from './terminal.ts'

function feature(second = 1) {
  return `Feature: Scenario state
 Scenario Outline: Keep actions ordered
  When I invoke "advance" with {}
  Then response "count" equals <first>
  When I invoke "advance" with {}
  Then response "count" equals <second>
  Examples:
   | first | second |
   | 1 | 2 |
   | ${second} | ${second + 1} |
`
}

test('the real CLI defaults to isolated scenarios and --serial preserves shared state and order', () => {
  const fixture = createProject({
    'package.json': '{"type":"module"}',
    'handler.ts': 'let count = 0\nexport function advance() { return { count: ++count } }',
    'bindings.ts':
      "import { advance } from './handler.ts'\nexport const actions = { 'advance': advance }",
    'state.feature': feature(),
  })
  const configFile = join(fixture.root, 'bonsai.json')
  const saved = readFileSync(configFile, 'utf8')
  const args = ['check', '--root', fixture.root, '--json']
  try {
    const concurrent = runCli(args)
    assert.equal(concurrent.status, 0, concurrent.stderr)
    const report = JSON.parse(concurrent.stdout)
    assert.equal(report.snapshot.verification.profile, 'isolated-scenarios-v1')
    assert.equal(report.snapshot.verification.workers, Math.min(availableParallelism(), 2))
    assert.equal(report.snapshot.evidence.profile, 'isolated-scenarios-v1')
    assert.equal(report.snapshot.evidence.complete, true)
    assert.deepEqual(
      report.snapshot.evidence.checks,
      report.snapshot.contracts.checks.map((check: { id: string }) => ({
        id: check.id,
        status: 'passed',
      })),
    )
    const incompatible = runCli([...args, '--serial'])
    assert.equal(incompatible.status, 1, incompatible.stderr)
    assert.deepEqual(
      JSON.parse(incompatible.stdout).snapshot.evidence.checks.map(
        (check: { status: string }) => check.status,
      ),
      ['passed', 'passed', 'failed', 'failed'],
    )
    writeFileSync(join(fixture.root, 'state.feature'), feature(3))
    const serial = runCli(['--serial', ...args])
    assert.equal(serial.status, 0, serial.stderr)
    const ordered = JSON.parse(serial.stdout)
    assert.deepEqual(ordered.snapshot.verification, { profile: 'in-process-v1', workers: 1 })
    assert.equal(ordered.snapshot.evidence.profile, 'in-process-v1')
    assert.ok(
      ordered.snapshot.evidence.checks.every(
        (check: { status: string }) => check.status === 'passed',
      ),
    )
    assert.equal(
      readFileSync(configFile, 'utf8'),
      saved,
      'Execution selection must not write settings',
    )
  } finally {
    fixture.dispose()
  }
})

test('--serial is documented, check-scoped, and retained in check recovery commands', () => {
  const metadata = runCli(['help', 'check', '--json'])
  assert.equal(metadata.status, 0, metadata.stderr)
  assert.deepEqual(JSON.parse(metadata.stdout).flags.serial, {
    type: 'boolean',
    description: 'run scenarios in order with shared application state',
    scope: ['check'],
  })
  const help = runCli(['check', '--help'])
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /--serial\s+run scenarios in order with shared application state/)
  assert.match(help.stdout, /available CPU capacity/)
  assert.match(help.stdout, /\$ bonsai check --root examples\/checkout --serial/)
  for (const args of [
    ['explain', 'missing.ts', '--serial'],
    ['config', 'show', '--serial'],
    ['init', '--serial'],
    ['version', '--serial'],
    ['help', 'explain', '--serial'],
    ['explain', '--help', '--serial'],
    ['check', '--serial=false'],
  ]) {
    const result = runCli([...args, '--json'])
    assert.equal(result.status, 2, JSON.stringify({ args, ...result }))
    assert.equal(result.stdout, '')
    const error = JSON.parse(result.stderr)
    assert.equal(error.code, 'USAGE')
    assert.match(error.error, /serial/)
    assert.doesNotMatch(result.stderr, /\x1b\[/)
  }
  const fixture = createProject(
    {
      'package.json': '{"type":"module"}',
      'handler.ts': 'export function inspect() { return { status: "actual" } }',
      'bindings.ts':
        "import { inspect } from './handler.ts'\nexport const actions = { 'inspect': inspect }",
      'wrong.feature':
        'Feature: Rejection\nScenario: Different response\n When I invoke "inspect" with {}\n Then response "status" equals "expected"\n',
    },
    {},
    "bonsai serial's recovery #",
  )
  try {
    const result = runCli(['check', '--root', fixture.root, '--serial', '--output', 'human'])
    assert.equal(result.status, 1, result.stderr)
    const recovery = /Next (?:→|->) (bonsai check[^\n]+)/.exec(result.stderr)?.[1]
    assert.ok(recovery, result.stderr)
    assert.match(recovery, /--serial(?:\s|$)/)
    const rerun = spawnSync(
      'sh',
      [
        '-c',
        recovery.replace(/^bonsai\b/, '"$BONSAI_TEST_RUNTIME" "$BONSAI_TEST_CLI"') + ' --json',
      ],
      {
        encoding: 'utf8',
        timeout: 15000,
        env: cliEnvironment({ BONSAI_TEST_RUNTIME: process.execPath, BONSAI_TEST_CLI: executable }),
      },
    )
    assert.equal(rerun.status, 1, rerun.stderr)
    assert.equal(JSON.parse(rerun.stdout).snapshot.evidence.profile, 'in-process-v1')
    if (hasPty) {
      const terminal = spawnSync(
        'script',
        [
          '-qefc',
          [process.execPath, executable, 'check', '--root', fixture.root, '--serial']
            .map(quote)
            .join(' '),
          '/dev/null',
        ],
        {
          encoding: 'utf8',
          timeout: 15000,
          env: cliEnvironment({ NO_COLOR: '', FORCE_COLOR: '1', TERM: 'xterm-256color' }),
        },
      )
      assert.equal(terminal.status, 1, terminal.stdout + terminal.stderr)
      const visible = characters(terminal.stdout)
      const text = visible.map((character) => character.value).join('')
      const start = text.lastIndexOf('--serial')
      assert.ok(start >= 0, text)
      for (const character of visible.slice(start, start + '--serial'.length)) {
        assert.equal(character.color, 36)
        assert.equal(character.dim, false)
      }
    }
  } finally {
    fixture.dispose()
  }
})

test('config inspection remains policy-only and never loads handlers', () => {
  const fixture = createProject({
    'bindings.ts': 'throw new Error("Configuration inspection must not load handlers")\n',
  })
  try {
    const saved = readFileSync(join(fixture.root, 'bonsai.json'), 'utf8')
    for (const mode of ['--json', '--plain', '--output']) {
      const result = runCli([
        'config',
        'show',
        '--root',
        fixture.root,
        mode,
        ...(mode === '--output' ? ['human'] : []),
      ])
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stderr, '')
      if (mode === '--json')
        assert.equal(Object.hasOwn(JSON.parse(result.stdout).config, 'verification'), false)
      else assert.doesNotMatch(result.stdout, /Verification:|verification\./)
    }
    assert.equal(readFileSync(join(fixture.root, 'bonsai.json'), 'utf8'), saved)
  } finally {
    fixture.dispose()
  }
})
