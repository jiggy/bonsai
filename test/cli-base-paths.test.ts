import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { runCli } from './cli.ts'
import { createProject } from './project.ts'

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

function repository() {
  const fixture = createProject({
    'package.json': '{"type":"module"}\n',
    'handler.ts': `import { writeFileSync } from 'node:fs'
export function handle() {
  writeFileSync(new URL('./handler-ran', import.meta.url), 'ran')
  return { status: 'ok' }
}
`,
    'bindings.ts':
      "import { handle } from './handler.ts'\nexport const actions = { 'handle': handle }\n",
    'app.feature':
      'Feature: Report\nScenario: A supported handler\n When I invoke "handle" with {}\n Then response "status" equals "ok"\n',
  })
  git(fixture.root, 'init', '-b', 'main')
  git(fixture.root, 'add', '.')
  git(fixture.root, 'commit', '-m', 'Reviewed base')
  const physical = realpathSync(fixture.root)
  const alias = fixture.root + ' linked checkout'
  symlinkSync(physical, alias, 'dir')
  return {
    ...fixture,
    physical,
    alias,
    marker: join(fixture.root, 'handler-ran'),
    dispose: () => {
      rmSync(alias, { force: true })
      fixture.dispose()
    },
  }
}

function invoke(args: string[], cwd?: string) {
  const result = runCli([...args, '--json'], { cwd, timeout: 30000 })
  assert.equal(result.error, undefined, String(result.error))
  assert.equal(result.signal, null, result.stderr)
  return { exitCode: result.status, report: JSON.parse(result.stdout || result.stderr) }
}

test('base configuration accepts physical and symlinked roots and preserves requested paths', () => {
  const fixture = repository()
  try {
    for (const root of [fixture.physical, fixture.alias]) {
      const result = invoke(['config', 'show', '--root', root, '--base', 'HEAD'])
      assert.equal(result.exitCode, 0, JSON.stringify(result.report))
      assert.equal(result.report.root, root)
      assert.equal(result.report.origin.policy, 'base')
      assert.equal(result.report.base, git(fixture.physical, 'rev-parse', 'HEAD'))
      assert.equal(existsSync(fixture.marker), false)
    }

    const policy = join(fixture.physical, 'selected policy.json')
    writeFileSync(policy, readFileSync(join(fixture.physical, 'bonsai.json')))
    const explicit = invoke(
      [
        'config',
        'show',
        '--root',
        fixture.alias,
        '--base',
        'HEAD',
        '--policy',
        'selected policy.json',
      ],
      fixture.physical,
    )
    assert.equal(explicit.exitCode, 0, JSON.stringify(explicit.report))
    assert.equal(explicit.report.root, fixture.alias)
    assert.equal(explicit.report.file, policy)
    assert.equal(explicit.report.origin.policy, '--policy')
  } finally {
    fixture.dispose()
  }
})

test('base check and read-only explanation retain the same source facts through a symlinked root', () => {
  const fixture = repository()
  try {
    const explained = invoke([
      'explain',
      'handler.ts#handle',
      '--root',
      fixture.alias,
      '--base',
      'HEAD',
    ])
    assert.equal(explained.exitCode, 0, JSON.stringify(explained.report))
    assert.deepEqual(
      explained.report.components.map((component: { id: string }) => component.id),
      ['handler.ts#handle'],
    )
    assert.equal(existsSync(fixture.marker), false)

    const physical = invoke(['check', '--root', fixture.physical, '--base', 'HEAD'])
    assert.equal(physical.exitCode, 0, JSON.stringify(physical.report))
    rmSync(fixture.marker)
    const linked = invoke(['check', '--root', fixture.alias, '--base', 'HEAD'])
    assert.equal(linked.exitCode, 0, JSON.stringify(linked.report))
    assert.equal(linked.report.decision.status, 'pass')
    assert.equal(linked.report.snapshot.evidence.complete, true)
    assert.equal(existsSync(fixture.marker), true)
    assert.deepEqual(linked.report.snapshot.source, physical.report.snapshot.source)
    assert.deepEqual(linked.report.snapshot.ancestry, physical.report.snapshot.ancestry)
  } finally {
    fixture.dispose()
  }
})

test('base root validation accepts linked worktrees without treating their common Git directory as the root', () => {
  const fixture = repository()
  try {
    const worktree = join(fixture.physical, 'linked-worktree')
    const alias = join(fixture.physical, 'worktree alias')
    git(fixture.physical, 'worktree', 'add', '--detach', worktree, 'HEAD')
    symlinkSync(worktree, alias, 'dir')
    for (const root of [worktree, alias]) {
      const result = invoke(['config', 'show', '--root', root, '--base', 'HEAD'])
      assert.equal(result.exitCode, 0, JSON.stringify(result.report))
      assert.equal(result.report.root, root)
      assert.equal(result.report.origin.policy, 'base')
    }
  } finally {
    fixture.dispose()
  }
})

test('base root validation still rejects real Git subdirectories and aliases to them', () => {
  const fixture = repository()
  try {
    const directory = join(fixture.physical, 'nested')
    const alias = join(fixture.physical, 'nested alias')
    mkdirSync(directory)
    symlinkSync(directory, alias, 'dir')
    for (const root of [directory, alias]) {
      const result = invoke(['config', 'show', '--root', root, '--base', 'HEAD'])
      assert.equal(result.exitCode, 2)
      assert.equal(result.report.code, 'USAGE')
      assert.equal(result.report.error, '--base needs the Git repository root')
      assert.equal(result.report.run, `Use --root ${fixture.physical}`)
      assert.equal(existsSync(fixture.marker), false)
    }
  } finally {
    fixture.dispose()
  }
})
