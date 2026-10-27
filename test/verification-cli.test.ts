import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verifyIsolatedScenarios } from '../src/self-host.ts'
import { cliEnvironment, executable, runCli } from './cli.ts'
import { createProject } from './project.ts'
import { characters, hasPty, quote } from './terminal.ts'

test('the real CLI fulfills every observation with isolated scenario state', () => {
  const report = verifyIsolatedScenarios({ workers: 2 })
  assert.equal(report.exitCode, 0, JSON.stringify(report))
  assert.equal(report.decision.status, 'pass')
  assert.deepEqual(report.snapshot.verification, {
    profile: 'isolated-scenarios-v1',
    workers: 2,
  })
  assert.equal(report.snapshot.evidence.profile, 'isolated-scenarios-v1')
  assert.equal(report.snapshot.evidence.complete, true)
  assert.equal(report.snapshot.contracts.cases.length, 2)
  assert.deepEqual(report.observations, ['passed', 'passed', 'passed', 'passed'])
  assert.deepEqual(
    report.snapshot.evidence.checks.map((check: { id: string }) => check.id),
    report.snapshot.contracts.checks.map((check: { id: string }) => check.id),
  )
})

test('config inspection shows explicit verification settings without loading handlers', () => {
  const { root, dispose } = createProject({
    'bindings.ts': 'throw new Error("Configuration inspection must not load handlers")\n',
  })
  try {
    const file = join(root, 'bonsai.json')
    const config = JSON.parse(readFileSync(file, 'utf8'))
    const normal = runCli(['config', 'show', '--root', root, '--output', 'human'])
    assert.equal(normal.status, 0, normal.stderr)
    assert.doesNotMatch(normal.stdout, /Verification:/)
    config.verification = { profile: 'isolated-scenarios-v1', workers: 2 }
    const selected = join(root, 'selected.json')
    writeFileSync(selected, JSON.stringify(config))
    const args = ['config', 'show', '--root', root, '--policy', selected]
    const structured = runCli([...args, '--json'])
    assert.equal(structured.status, 0, structured.stderr)
    assert.equal(structured.stderr, '')
    assert.deepEqual(JSON.parse(structured.stdout).config.verification, config.verification)
    assert.equal(JSON.parse(structured.stdout).origin.policy, '--policy')
    const plain = runCli([...args, '--plain'])
    assert.equal(plain.status, 0, plain.stderr)
    assert.match(plain.stdout, /^verification\.profile\tisolated-scenarios-v1$/m)
    assert.match(plain.stdout, /^verification\.workers\t2$/m)
    assert.doesNotMatch(plain.stdout, /\x1b\[/)
    const human = runCli([...args, '--output', 'human'])
    assert.equal(human.status, 0, human.stderr)
    assert.match(human.stdout, /^Verification: isolated scenarios \(2 workers\)$/m)
    assert.equal(readFileSync(file, 'utf8'), JSON.stringify({ ...config, verification: undefined }))
    if (hasPty) {
      const terminal = spawnSync(
        'script',
        ['-qefc', [process.execPath, executable, ...args].map(quote).join(' '), '/dev/null'],
        {
          encoding: 'utf8',
          timeout: 15000,
          env: cliEnvironment({ NO_COLOR: '', FORCE_COLOR: '1', TERM: 'xterm-256color' }),
        },
      )
      assert.equal(terminal.status, 0, terminal.stdout + terminal.stderr)
      const visible = characters(terminal.stdout)
      const text = visible.map((character) => character.value).join('')
      const phrase = 'isolated scenarios (2 workers)'
      const start = text.indexOf(phrase)
      assert.ok(start >= 0, text)
      for (const character of visible.slice(start, start + phrase.length)) {
        assert.equal(character.color, 37)
        assert.equal(character.dim, false)
      }
    }
  } finally {
    dispose()
  }
})
