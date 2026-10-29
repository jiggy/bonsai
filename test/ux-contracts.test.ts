import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripVTControlCharacters } from 'node:util'
import { checkUx } from '../features/support/ux.ts'
import { cliEnvironment, runCli } from './cli.ts'

test('the reported version matches the independently read installed package manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const result = runCli(['version', '--json'], {
    env: cliEnvironment({
      BONSAI_ROOT: '/missing-bonsai-project',
      BONSAI_NATIVE_BINARY: '/missing-bonsai-checker',
    }),
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  assert.equal(JSON.parse(result.stdout).version, manifest.version)
})

test('machine-readable help retains its command identity and engine flag scope', () => {
  const result = runCli(['help', 'check', '--json'])
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.name, 'bonsai')
  assert.equal(report.command, 'check')
  assert.equal(report.commands.check.usage, 'bonsai check [flags]')
  assert.deepEqual(report.flags.engine.choices, ['rust'])
  assert.deepEqual(report.flags.engine.scope, ['check', 'explain'])
})

test('the narrow subprocess blocker preserves its exact copy and semantic ANSI state', () => {
  const report = checkUx(
    { case: 'verbose-blocker' },
    {
      NO_COLOR: '',
      BONSAI_NO_COLOR: '',
      FORCE_COLOR: '1',
      COLUMNS: '32',
      TERM: 'xterm-256color',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    },
  )
  assert.equal(report.exitCode, 2)
  assert.equal(report.stdout, '')
  assert.equal(report.title, "Can't trace 1 local subprocess entry point")
  assert.deepEqual(report.titleColors, [31])
  assert.equal(report.titleDimmed, false)
  assert.equal(report.titleWrapped, true)
  assert.equal(report.hasSourceLocation, true)
  assert.equal(report.hasFix, true)
  assert.equal(report.hasTimings, true)
  const plain = stripVTControlCharacters(report.stderr)
  assert.match(plain, /^Timing$/m)
  assert.match(plain, /^Feedback window:/m)
  assert.match(plain, /\belapsed\b/)
  const retry = checkUx({ case: 'copied-retry' })
  assert.equal(retry.exitCode, 2)
  assert.equal(retry.decision.status, 'incomplete')
  assert.equal(retry.handlerExecuted, false)
  assert.equal(report.handlerExecuted, false)
})

test('blocked JSON keeps every source problem uncolored and quiet output suppresses measurements', () => {
  const machine = checkUx({ case: 'machine' })
  assert.equal(machine.exitCode, 2)
  assert.equal(machine.decision.status, 'incomplete')
  assert.equal(machine.snapshot.source.problems.length, 1)
  assert.equal(machine.stderr, '')
  assert.equal(machine.hasAnsi, false)
  const quiet = checkUx({ case: 'quiet' })
  assert.equal(quiet.exitCode, 2)
  assert.equal(quiet.stdout, '')
  assert.equal(quiet.hasBlocker, true)
  assert.equal(quiet.hasFix, true)
  assert.equal(quiet.hasProgress, false)
  assert.equal(quiet.hasMeasurements, false)
})

test('completion scripts retain all shell grammars and the check-only serial option', () => {
  for (const shell of ['bash', 'zsh', 'fish', 'powershell']) {
    const result = runCli(['completion', shell, '--json'])
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.shell, shell)
    assert.equal(typeof report.script, 'string')
    assert.ok(report.script.trim())
    assert.ok(report.script.includes('check'))
    if (shell === 'fish') assert.match(report.script, /-l serial(?:\s|$)/m)
    else assert.ok(report.script.includes('--serial'))
  }
  const unsupported = runCli(['completion', 'unsupported', '--json'])
  assert.equal(unsupported.status, 2)
  assert.equal(JSON.parse(unsupported.stderr).code, 'USAGE')

  const bash = checkUx({ case: 'completion' })
  assert.equal(bash.exitCode, 0)
  assert.equal(bash.shell, 'bash')
  assert.equal(bash.bashExitCode, 0)
  assert.deepEqual(bash.checkCandidates, ['--serial'])
  assert.deepEqual(bash.explainCandidates, [])
})
