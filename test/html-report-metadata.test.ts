import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli } from './cli.ts'

test('report discovery preserves console formats and stays scoped to check', () => {
  const result = runCli(['help', 'check', '--json', '--root', '/missing-report-project'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const help = JSON.parse(result.stdout)
  assert.equal(help.flags.report.type, 'string')
  assert.equal(help.flags.report.completion, 'file')
  assert.match(
    help.flags.report.description,
    /offline HTML.*relative to --root.*default \.bonsai\/report\.html/,
  )
  assert.deepEqual(help.flags.report.scope, ['check'])
  assert.equal(help.flags['no-report'].type, 'boolean')
  assert.deepEqual(help.flags['no-report'].scope, ['check'])
  assert.equal(help.flags.output.short, 'o')
  assert.deepEqual(help.flags.output.choices, ['auto', 'human', 'plain', 'json'])
  assert(help.commands.check.examples.includes('bonsai check'))
  assert(help.commands.check.examples.some((example: string) => example.includes('--report')))
  assert(help.commands.check.examples.includes('bonsai check --root examples/checkout --serial'))
  for (const command of ['init', 'explain', 'config', 'version']) {
    const response = runCli(['help', command, '--json'])
    assert.equal(response.status, 0, response.stderr)
    assert.equal(JSON.parse(response.stdout).flags.report, undefined, command)
    assert.equal(JSON.parse(response.stdout).flags['no-report'], undefined, command)
  }
})

test('report requires a path and rejects unrelated commands before project work', () => {
  for (const args of [
    ['check', '--report', '--json'],
    ['explain', 'source.ts', '--report', 'report.html', '--json'],
    ['config', 'show', '--report', 'report.html', '--json'],
    ['explain', 'source.ts', '--no-report', '--json'],
    ['config', 'show', '--no-report', '--json'],
  ]) {
    const result = runCli(args)
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    const error = JSON.parse(result.stderr)
    assert.equal(error.code, 'USAGE')
    assert.match(error.error, /report/)
  }
})

test('report and no-report conflict before project work in either order', () => {
  for (const options of [
    ['--report', 'report.html', '--no-report'],
    ['--no-report', '--report=report.html'],
  ]) {
    const result = runCli(['check', '--root', '/missing-report-project', ...options, '--json'])
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    const error = JSON.parse(result.stderr)
    assert.equal(error.code, 'USAGE')
    assert.match(error.error, /--report.*--no-report/)
  }
})

test('report path completion follows root while policy paths remain invocation-relative', () => {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-report-completion-'))
  try {
    mkdirSync(join(root, 'project', 'out'), { recursive: true })
    mkdirSync(join(root, 'out'))
    writeFileSync(join(root, 'project', 'out', 'project.html'), '')
    writeFileSync(join(root, 'out', 'local.json'), '{}')
    const generated = runCli(['completion', 'bash'])
    assert.equal(generated.status, 0, generated.stderr)
    const script = join(root, 'completion.bash')
    writeFileSync(script, generated.stdout)
    const probe = `source "$1"
shift
COMP_WORDS=(bonsai "$@")
COMP_CWORD=$((\${#COMP_WORDS[@]} - 1))
_bonsai
for candidate in "\${COMPREPLY[@]}"; do printf '%s\\0' "$candidate"; done
`
    const complete = (...words: string[]) => {
      const response = spawnSync(
        'bash',
        ['--noprofile', '--norc', '-c', probe, 'completion', script, ...words],
        { cwd: root, encoding: 'utf8' },
      )
      assert.equal(response.status, 0, response.stderr)
      assert.equal(response.stderr, '')
      return response.stdout.split('\0').filter(Boolean)
    }
    assert.deepEqual(complete('check', '--rep'), ['--report'])
    assert.deepEqual(complete('explain', '--rep'), [])
    assert.deepEqual(complete('check', '--no-rep'), ['--no-report'])
    assert.deepEqual(complete('explain', '--no-rep'), [])
    assert.deepEqual(complete('check', '--root', 'project', '--report', 'out/pro'), [
      'out/project.html',
    ])
    assert.deepEqual(complete('check', '--root=project', '--report=out/pro'), [
      '--report=out/project.html',
    ])
    assert.deepEqual(complete('check', '--root', 'project', '--policy', 'out/loc'), [
      'out/local.json',
    ])
    assert.deepEqual(complete('explain', '--root', 'project', '--report', 'out/pro'), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
