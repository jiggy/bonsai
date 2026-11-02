import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { displayWidth } from '../src/cli-interface.ts'
import { cliEnvironment, executable, runCli } from './cli.ts'
import { createProject } from './project.ts'
import { characters, hasPty, quote } from './terminal.ts'

function project() {
  const fixture = createProject(
    {
      'package.json': '{"type":"module"}\n',
      'README.md': '# Application\n',
      'handler.ts': `import { writeFileSync } from 'node:fs'
export function handle() {
  writeFileSync(new URL('./handler-ran', import.meta.url), 'ran')
  return { status: 'ok' }
}
`,
      'bindings.ts':
        "import { handle } from './handler.ts'\nexport const actions = { 'handle': handle }\n",
      'app.feature':
        'Feature: Application\nScenario: A supported handler\n When I invoke "handle" with {}\n Then response "status" equals "ok"\n',
    },
    {},
    "bonsai inventory's root #",
  )
  return { ...fixture, marker: join(fixture.root, 'handler-ran') }
}

function inspect(command: string, cwd: string, input?: string) {
  const result = spawnSync(
    'sh',
    ['-c', command.replace(/^bonsai\b/, '"$BONSAI_TEST_RUNTIME" "$BONSAI_TEST_CLI"') + ' --json'],
    {
      cwd,
      input,
      encoding: 'utf8',
      timeout: 15000,
      env: cliEnvironment({
        BONSAI_TEST_RUNTIME: process.execPath,
        BONSAI_TEST_CLI: executable,
      }),
    },
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function git(root: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-C',
      root,
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgSign=false',
      '-c',
      'user.name=Bonsai Test',
      '-c',
      'user.email=test@example.invalid',
      ...args,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim()
}

test('a missing maintained README identifies its required input and allows policy inspection', () => {
  const fixture = project()
  const configFile = join(fixture.root, 'bonsai.json')
  const original = readFileSync(configFile, 'utf8')
  try {
    rmSync(join(fixture.root, 'README.md'))
    for (const command of [['check'], ['check', '--no-report'], ['explain', 'handler.ts']]) {
      const result = runCli([...command, '--root', fixture.root, '--json'])
      assert.equal(result.status, 2, result.stderr)
      assert.equal(result.stdout, '')
      const problem = JSON.parse(result.stderr)
      assert.equal(problem.status, 'incomplete')
      assert.equal(problem.code, 'INVENTORY')
      assert.match(problem.error, /Maintained path not found: README\.md/)
      assert.match(problem.error, /Restore/)
      assert.doesNotMatch(problem.error, /ENOENT|ENOTDIR|lstat|statx/)
      assert.match(problem.run, /^bonsai config show --root /)
      const inspected = inspect(problem.run, fixture.root)
      assert.equal(inspected.root, fixture.root)
      assert.ok(inspected.config.maintained.includes('README.md'))
      assert.equal(readFileSync(configFile, 'utf8'), original)
      assert.equal(existsSync(fixture.marker), false)
      assert.equal(existsSync(join(fixture.root, '.bonsai/report.html')), false)
    }
    writeFileSync(join(fixture.root, 'README.md'), '# Application\n')
    const repaired = runCli(['check', '--root', fixture.root, '--json'])
    assert.equal(repaired.status, 0, repaired.stderr || repaired.stdout)
    assert.equal(JSON.parse(repaired.stdout).decision.status, 'pass')
    assert.equal(existsSync(fixture.marker), true)
  } finally {
    fixture.dispose()
  }
})

test('a maintained descendant under a regular file reports the same input error with and without HTML', () => {
  const fixture = project()
  try {
    writeFileSync(join(fixture.root, 'blocker'), 'A file occupies the required directory\n')
    const configFile = join(fixture.root, 'bonsai.json')
    const config = JSON.parse(readFileSync(configFile, 'utf8'))
    config.maintained.push('blocker/README.md')
    writeFileSync(configFile, JSON.stringify(config))
    const results = [[], ['--no-report']].map((flags) =>
      runCli(['check', '--root', fixture.root, '--json', ...flags]),
    )
    for (const result of results) {
      assert.equal(result.status, 2, result.stderr)
      assert.equal(result.stdout, '')
    }
    const problems = results.map((result) => JSON.parse(result.stderr))
    assert.deepEqual(
      problems.map((problem) => problem.code),
      ['INVENTORY', 'INVENTORY'],
    )
    for (const problem of problems) {
      assert.match(problem.error, /Maintained path not found: blocker\/README\.md/)
      assert.doesNotMatch(problem.error, /ENOTDIR|lstat|statx/)
      assert.equal(inspect(problem.run, fixture.root).root, fixture.root)
    }
    assert.equal(existsSync(fixture.marker), false)
    assert.equal(existsSync(join(fixture.root, '.bonsai/report.html')), false)
  } finally {
    fixture.dispose()
  }
})

test('missing inventory recovery preserves the reviewed base and explicit policy selection', () => {
  const fixture = project()
  const selected = createProject({})
  try {
    const configFile = join(fixture.root, 'bonsai.json')
    const policyFile = join(selected.root, "reviewed policy's scope.json")
    const reviewed = readFileSync(configFile, 'utf8')
    writeFileSync(policyFile, reviewed)
    git(fixture.root, 'init', '-b', 'main')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '-m', 'Reviewed inputs')
    rmSync(join(fixture.root, 'README.md'))
    const candidate = JSON.parse(reviewed)
    candidate.maintained = candidate.maintained.filter((path: string) => path !== 'README.md')
    writeFileSync(configFile, JSON.stringify(candidate))
    for (const policy of [[], ['--policy', policyFile]]) {
      const result = runCli([
        'check',
        '--root',
        fixture.root,
        '--base',
        'HEAD',
        ...policy,
        '--json',
      ])
      assert.equal(result.status, 2, result.stderr)
      assert.equal(result.stdout, '')
      const problem = JSON.parse(result.stderr)
      assert.equal(problem.code, 'INVENTORY')
      assert.match(problem.error, /README\.md/)
      const inspected = inspect(problem.run, selected.root)
      assert.equal(inspected.root, fixture.root)
      assert.equal(inspected.base, git(fixture.root, 'rev-parse', 'HEAD'))
      assert.equal(inspected.origin.policy, policy.length ? '--policy' : 'base')
      if (policy.length) assert.equal(inspected.file, policyFile)
      assert.deepEqual(inspected.config, JSON.parse(reviewed))
      assert.equal(existsSync(fixture.marker), false)
    }
    const piped = runCli(['check', '--root', fixture.root, '--policy', '-', '--json'], {
      input: reviewed,
    })
    assert.equal(piped.status, 2, piped.stderr)
    const problem = JSON.parse(piped.stderr)
    assert.equal(problem.code, 'INVENTORY')
    const inspected = inspect(problem.run, selected.root, reviewed)
    assert.equal(inspected.file, 'stdin')
    assert.deepEqual(inspected.config, JSON.parse(reviewed))
    assert.equal(existsSync(fixture.marker), false)
  } finally {
    fixture.dispose()
    selected.dispose()
  }
})

test('a missing historical input points to the selected base after the candidate restores it', () => {
  const fixture = project()
  try {
    rmSync(join(fixture.root, 'README.md'))
    git(fixture.root, 'init', '-b', 'main')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '-m', 'Base missing its maintained README')
    writeFileSync(join(fixture.root, 'README.md'), '# Application\n')
    const result = runCli(['check', '--root', fixture.root, '--base', 'HEAD', '--json'])
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    const problem = JSON.parse(result.stderr)
    assert.equal(problem.code, 'INVENTORY')
    assert.match(problem.error, /README\.md/)
    assert.match(problem.error, /base 'HEAD'/)
    assert.match(problem.error, /Select a --base revision.*contains.*input/)
    assert.doesNotMatch(problem.error, /Restore|ENOENT|bonsai-base-/)
    const inspected = inspect(problem.run, fixture.root)
    assert.equal(inspected.root, fixture.root)
    assert.equal(inspected.base, git(fixture.root, 'rev-parse', 'HEAD'))
    assert.ok(inspected.config.maintained.includes('README.md'))
    assert.equal(readFileSync(join(fixture.root, 'README.md'), 'utf8'), '# Application\n')
    assert.equal(existsSync(fixture.marker), false)
    git(fixture.root, 'add', 'README.md')
    git(fixture.root, 'commit', '-m', 'Restore the reviewed input')
    const repaired = runCli(['check', '--root', fixture.root, '--base', 'HEAD', '--json'])
    assert.equal(repaired.status, 0, repaired.stderr || repaired.stdout)
    assert.equal(JSON.parse(repaired.stdout).decision.status, 'pass')
    assert.equal(existsSync(fixture.marker), true)
  } finally {
    fixture.dispose()
  }
})

test('missing maintained inputs keep wrapped terminal diagnostics readable and commands copyable', {
  skip: !hasPty,
}, () => {
  const fixture = project()
  try {
    rmSync(join(fixture.root, 'README.md'))
    const args = ['check', '--root', fixture.root, '--quiet']
    const env = cliEnvironment({
      NO_COLOR: '',
      BONSAI_NO_COLOR: '',
      FORCE_COLOR: '',
      TERM: 'xterm-256color',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      COLUMNS: '40',
    })
    const invoke = (flags: string[]) =>
      spawnSync(
        'script',
        [
          '-qefc',
          [process.execPath, executable, ...args, ...flags].map(quote).join(' '),
          '/dev/null',
        ],
        { env, encoding: 'utf8', timeout: 15000 },
      )
    const styled = invoke([])
    assert.equal(styled.status, 2, styled.stderr)
    const visible = characters(styled.stdout.replaceAll('\r\n', '\n'))
    const plain = visible.map((character) => character.value).join('')
    assert.match(plain, /Maintained path not found: README\.md/)
    assert.doesNotMatch(plain, /ENOENT|statx|lstat/)
    const end = plain.indexOf('  Next →')
    assert.ok(end > 0)
    assert.ok(plain.slice(0, end).trimEnd().split('\n').length > 2)
    for (const character of visible.slice(0, end).filter((character) => character.value.trim())) {
      assert.equal(character.color, 31)
      assert.equal(character.dim, false)
    }
    for (const line of plain.slice(0, end).trimEnd().split('\n'))
      assert.ok(displayWidth(line) <= 40, line)
    const recovery = plain
      .slice(end)
      .trim()
      .replace(/^Next → /, '')
      .trimEnd()
    assert.equal(inspect(recovery, fixture.root).root, fixture.root)
    const monochrome = invoke(['--no-color'])
    assert.equal(monochrome.status, 2, monochrome.stderr)
    assert.equal(stripVTControlCharacters(styled.stdout), monochrome.stdout)
    assert.doesNotMatch(monochrome.stdout, /\x1b\[/)
    assert.equal(existsSync(fixture.marker), false)
  } finally {
    fixture.dispose()
  }
})
