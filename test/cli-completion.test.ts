import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('..', import.meta.url))

function fixture(shell: string) {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-completion-'))
  const script = join(root, `bonsai.${shell}`)
  const generated = spawnSync(process.execPath, ['src/cli.ts', 'completion', shell], {
    cwd: repository,
    encoding: 'utf8',
    env: { ...process.env, BONSAI_ROOT: '/missing-completion-project' },
  })
  assert.equal(generated.status, 0, generated.stderr)
  assert.equal(generated.stderr, '')
  writeFileSync(script, generated.stdout)
  mkdirSync(join(root, 'project-dir', 'src'), { recursive: true })
  mkdirSync(join(root, 'project space'))
  writeFileSync(join(root, 'project-file'), '')
  writeFileSync(join(root, 'policy.json'), '{}')
  writeFileSync(join(root, 'project-dir', 'src', 'order.ts'), '')
  return { root, script, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

const bashProbe = `
source "$1"
shift
COMP_WORDS=(bonsai "$@")
COMP_CWORD=$((\${#COMP_WORDS[@]} - 1))
_bonsai
for candidate in "\${COMPREPLY[@]}"; do printf '%s\\0' "$candidate"; done
`

test('generated Bash completions follow command context and flag scopes', () => {
  const { root, script, dispose } = fixture('bash')
  const complete = (...words: string[]) => {
    const result = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-c', bashProbe, 'completion', script, ...words],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    return result.stdout.split('\0').filter(Boolean)
  }
  try {
    assert.deepEqual(complete('config', 'sh'), ['show'])
    assert.deepEqual(complete('completion', 'ba'), ['bash'])
    assert.deepEqual(complete('help', 'exp'), ['explain'])
    assert.deepEqual(complete('help', 'config', 'sh'), ['show'])
    assert.deepEqual(complete('--root', 'project-dir', 'config', 'sh'), ['show'])
    assert.deepEqual(complete('--root=project-dir', 'help', 'exp'), ['explain'])
    assert.deepEqual(complete('--root', '=', 'project-dir', 'config', 'sh'), ['show'])
    assert.deepEqual(complete('-vrproject-dir', 'config', 'sh'), ['show'])
    assert.deepEqual(complete('--output', 'json', 'help', 'exp'), ['explain'])
    assert.ok(complete('').includes('check'))
    assert.deepEqual(complete('in'), ['init'])
    assert.deepEqual(complete('help', 'in'), ['init'])
    const initFlags = complete('init', '-')
    assert.ok(initFlags.includes('--root'))
    assert.ok(initFlags.includes('-r'))
    assert.ok(initFlags.includes('--timeout'))
    for (const flag of ['--base', '--policy', '--limit', '--markdown'])
      assert.ok(!initFlags.includes(flag), flag)
    assert.deepEqual(complete('--root', 'project-dir', 'init', '--ti'), ['--timeout'])
    const checkFlags = complete('check', '-')
    assert.ok(checkFlags.includes('--root'))
    assert.ok(checkFlags.includes('-r'))
    assert.ok(checkFlags.includes('-j'))
    assert.ok(!checkFlags.includes('--markdown'))
    assert.ok(checkFlags.includes('--limit'))
    assert.ok(checkFlags.includes('--engine'))
    assert.ok(!initFlags.includes('--engine'))
    assert.deepEqual(complete('check', '--li'), ['--limit'])
    assert.deepEqual(complete('help', '--mark'), ['--markdown'])
    assert.deepEqual(complete('explain', '--li'), ['--limit'])
    assert.deepEqual(complete('version', '--ro'), [])
    assert.deepEqual(complete('version', '-r'), [])
    assert.deepEqual(complete('version', '--root=pro'), [])
    assert.deepEqual(complete('check', '--', '--ro'), [])
  } finally {
    dispose()
  }
})

test('generated Bash completions complete enum values and filesystem arguments', () => {
  const { root, script, dispose } = fixture('bash')
  const complete = (...words: string[]) => {
    const result = spawnSync(
      'bash',
      ['--noprofile', '--norc', '-c', bashProbe, 'completion', script, ...words],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    return result.stdout.split('\0').filter(Boolean).sort()
  }
  try {
    assert.deepEqual(complete('check', '--output', 'js'), ['json'])
    assert.deepEqual(complete('check', '--engine', 'ru'), ['rust'])
    assert.deepEqual(complete('explain', '--engine=ty'), ['--engine=typescript'])
    assert.deepEqual(complete('config', 'show', '--engine', 'ru'), [])
    assert.deepEqual(complete('check', '--output=js'), ['--output=json'])
    assert.deepEqual(complete('check', '--output', '=', 'js'), ['json'])
    assert.deepEqual(complete('check', '-ojs'), ['-ojson'])
    assert.deepEqual(complete('check', '-vojs'), ['-vojson'])
    assert.deepEqual(complete('check', '--root', 'project'), ['project space/', 'project-dir/'])
    assert.deepEqual(complete('check', '--root=project'), [
      '--root=project space/',
      '--root=project-dir/',
    ])
    assert.deepEqual(complete('check', '--root', '=', 'project'), [
      'project space/',
      'project-dir/',
    ])
    assert.deepEqual(complete('check', '-rproject'), ['-rproject space/', '-rproject-dir/'])
    assert.deepEqual(complete('check', '-vrproject'), ['-vrproject space/', '-vrproject-dir/'])
    assert.deepEqual(complete('check', '--policy', 'pol'), ['policy.json'])
    assert.deepEqual(complete('check', '--policy=pol'), ['--policy=policy.json'])
    assert.deepEqual(complete('explain', '--root', 'project-dir', 'src/or'), ['src/order.ts'])
    assert.deepEqual(complete('explain', '-rproject-dir', 'src/or'), ['src/order.ts'])
    assert.deepEqual(complete('check', '--timeout', 'project'), [])
    assert.deepEqual(complete('init', '--root=project-d'), ['--root=project-dir/'])
    assert.deepEqual(complete('init', '-rproject-d'), ['-rproject-dir/'])
    assert.deepEqual(complete('init', '--timeout', 'project'), [])
    assert.deepEqual(complete('init', '--policy=pol'), [])
  } finally {
    dispose()
  }
})

test('generated Zsh completion parses context and delegates paths to native completion', (context) => {
  if (spawnSync('zsh', ['--version']).status !== 0) {
    context.skip('Zsh is not installed')
    return
  }
  const { root, script, dispose } = fixture('zsh')
  const probe = `
compdef() { :; }
source "$1"
shift
compadd() { shift; for candidate in "$@"; do printf '%s\\0' "$candidate"; done; }
compset() { :; }
_path_files() { for argument in "$@"; do printf '%s\\0' "$argument"; done; }
words=(bonsai "$@")
CURRENT=$#words
_bonsai
`
  const complete = (...words: string[]) => {
    const result = spawnSync('zsh', ['-f', '-c', probe, 'completion', script, ...words], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    return result.stdout.split('\0').filter(Boolean)
  }
  try {
    assert.deepEqual(complete('--root', 'project-dir', 'config', 'sh'), ['show'])
    assert.ok(complete('completion', '').includes('powershell'))
    assert.ok(complete('help', 'exp').includes('explain'))
    assert.ok(complete('help', 'in').includes('init'))
    const initFlags = complete('init', '--')
    assert.ok(initFlags.includes('--root'))
    assert.ok(initFlags.includes('-r'))
    assert.ok(initFlags.includes('--timeout'))
    for (const flag of ['--base', '--policy', '--limit', '--markdown'])
      assert.ok(!initFlags.includes(flag), flag)
    assert.ok(complete('--root', 'project-dir', 'init', '--').includes('--timeout'))
    assert.deepEqual(complete('init', '--root=pro'), ['-/'])
    assert.deepEqual(complete('init', '--timeout', 'project'), [])
    assert.ok(!complete('version', '--').includes('--root'))
    assert.ok(!complete('check', '--').includes('--markdown'))
    assert.ok(complete('explain', '--').includes('--limit'))
    assert.deepEqual(complete('check', '--root=pro'), ['-/'])
    assert.deepEqual(complete('check', '--policy', 'pol'), [])
    assert.deepEqual(complete('explain', '--root', 'project-dir', 'src/or'), ['-W', 'project-dir'])
    assert.ok(complete('check', '-vojs').includes('json'))
    const syntax = spawnSync('zsh', ['-n', script], { encoding: 'utf8' })
    assert.equal(syntax.status, 0, syntax.stderr)
  } finally {
    dispose()
  }
})

test('generated fish completion uses native command, value, and path completion', (context) => {
  if (spawnSync('fish', ['--version']).status !== 0) {
    context.skip('fish is not installed')
    return
  }
  const { root, script, dispose } = fixture('fish')
  const complete = (line: string) => {
    const result = spawnSync(
      'fish',
      ['--no-config', '-c', 'source $argv[1]; complete -C $argv[2]', script, line],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    return result.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((candidate) => candidate.split('\t')[0])
  }
  try {
    assert.deepEqual(complete('bonsai config sh'), ['show'])
    assert.deepEqual(complete('bonsai --root project-dir config sh'), ['show'])
    assert.deepEqual(complete('bonsai completion ba'), ['bash'])
    assert.deepEqual(complete('bonsai help exp'), ['explain'])
    assert.deepEqual(complete('bonsai in'), ['init'])
    assert.deepEqual(complete('bonsai help in'), ['init'])
    const initFlags = complete('bonsai init --')
    assert.ok(initFlags.includes('--root'))
    assert.ok(initFlags.includes('--timeout'))
    for (const flag of ['--base', '--policy', '--limit', '--markdown'])
      assert.ok(!initFlags.includes(flag), flag)
    assert.deepEqual(complete('bonsai --root project-dir init --ti'), ['--timeout'])
    assert.deepEqual(complete('bonsai init --root=project-d'), ['--root=project-dir/'])
    assert.deepEqual(complete('bonsai init -rproject-d'), ['-rproject-dir/'])
    const initDirectories = complete('bonsai init --root=project')
    assert.ok(initDirectories.includes('--root=project-dir/'))
    assert.ok(!initDirectories.includes('--root=project-file'))
    assert.deepEqual(complete('bonsai init --timeout project'), [])
    assert.deepEqual(complete('bonsai init --output project'), [])
    assert.deepEqual(complete('bonsai check --output js'), ['json'])
    assert.deepEqual(complete('bonsai check -ojs'), ['-ojson'])
    assert.deepEqual(complete('bonsai check --root=project-d'), ['--root=project-dir/'])
    assert.deepEqual(complete('bonsai check -rproject-d'), ['-rproject-dir/'])
    assert.deepEqual(complete('bonsai check -vrproject-d'), ['-vrproject-dir/'])
    assert.deepEqual(complete('bonsai explain --root project-dir src/or'), ['src/order.ts'])
    assert.deepEqual(complete('bonsai explain --root=project-dir src/or'), ['src/order.ts'])
    assert.deepEqual(complete('bonsai explain -vrproject-dir src/or'), ['src/order.ts'])
    assert.deepEqual(complete('bonsai version --ro'), [])
    assert.deepEqual(complete('bonsai check --mark'), [])
  } finally {
    dispose()
  }
})
