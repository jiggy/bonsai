import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { cliEnvironment, executable, runCli as run } from './cli.ts'

const environment = cliEnvironment()

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bonsai init's root #"))
  return {
    root,
    write(path: string, content: string) {
      const file = join(root, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

function covers(paths: string[], file: string) {
  return paths.some((path) => file === path || file.startsWith(path + '/'))
}

test('init help is available without creating files', () => {
  const { root, dispose } = fixture()
  try {
    const help = run(['init', '--root', root, '--help'])
    assert.equal(help.status, 0, help.stderr)
    assert.match(help.stdout, /bonsai init/)
    assert.deepEqual(readdirSync(root), [])
    const metadata = run(['help', 'init', '--json'])
    assert.equal(metadata.status, 0, metadata.stderr)
    assert.equal(JSON.parse(metadata.stdout).command, 'init')
  } finally {
    dispose()
  }
})

test('init rejects expired deadlines and invalid arguments before writing files', () => {
  const { root, dispose } = fixture()
  try {
    for (const flags of [['extra'], ['--base', 'HEAD'], ['--policy', 'missing.json']]) {
      const result = run(['init', '--root', root, ...flags, '--json'])
      assert.equal(result.status, 2, result.stderr)
      assert.equal(result.stdout, '')
      assert.equal(JSON.parse(result.stderr).code, 'USAGE')
      assert.deepEqual(readdirSync(root), [])
    }
    const expired = run(['init', '--root', root, '--timeout', '0.000001', '--json'])
    assert.equal(expired.status, 1, expired.stderr)
    assert.equal(expired.stdout, '')
    assert.equal(JSON.parse(expired.stderr).code, 'TIMEOUT')
    assert.deepEqual(readdirSync(root), [])
  } finally {
    dispose()
  }
})

test('init creates a valid configuration and starter inputs in an empty project', () => {
  const { root, dispose } = fixture()
  try {
    const result = run(['init', '--root', root, '--json'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const initialized = JSON.parse(result.stdout)
    assert.equal(initialized.root, root)
    assert.equal(initialized.file, join(root, 'bonsai.json'))
    assert.ok(initialized.next.some((message: string) => /draft|calibrat/i.test(message)))
    const inspected = run(['config', 'show', '--root', root, '--json'])
    assert.equal(inspected.status, 0, inspected.stderr)
    const { config } = JSON.parse(inspected.stdout)
    assert.deepEqual(initialized.config, config)
    assert.equal(config.bindings, 'bonsai.bindings.ts')
    assert.ok(covers(config.maintained, 'bonsai.json'))
    assert.ok(covers(config.maintained, config.bindings))
    assert.ok(existsSync(join(root, config.bindings)))
    assert.ok(covers(config.maintained, 'features/bonsai.feature'))
    const feature = readFileSync(join(root, 'features/bonsai.feature'), 'utf8')
    assert.ok(
      feature
        .split('\n')
        .filter((line) => line.trim())
        .every((line) => line.trim().startsWith('#')),
    )
    assert.deepEqual(config.policy, {
      bootstrap: 20000,
      bootstrapSurface: 20,
      perDoubling: 2000,
      hardLimit: 30000,
      maxFeedbackMs: 15000,
    })
    const checked = run(['check', '--root', root, '--json'])
    assert.equal(checked.status, 2, checked.stderr)
    const report = JSON.parse(checked.stdout)
    assert.equal(report.decision.status, 'incomplete')
    assert.equal(report.snapshot.contracts.checks.length, 0)
  } finally {
    dispose()
  }
})

test('init reuses conventional bindings and existing features without running project code', () => {
  for (const binding of ['bindings.ts', 'bonsai.bindings.ts']) {
    const project = fixture()
    try {
      const marker = join(project.root, 'must-not-run')
      const registry = `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'executed')\nexport const actions = {}\n`
      const feature = '# An existing product contract\nFeature: Existing behavior\n'
      const manifest = JSON.stringify({
        scripts: { init: 'touch must-not-run', postinstall: 'touch must-not-run' },
      })
      project.write(binding, registry)
      project.write('features/existing.feature', feature)
      project.write('package.json', manifest)
      project.write('src/existing.ts', 'export const existing = 1\n')
      project.write('test/existing.test.ts', 'export const testInput = 1\n')
      project.write('tsconfig.json', '{}\n')
      const result = run(['init', '--root', project.root, '--json'])
      assert.equal(result.status, 0, result.stderr)
      const config = JSON.parse(readFileSync(join(project.root, 'bonsai.json'), 'utf8'))
      assert.equal(config.bindings, binding)
      for (const path of [
        binding,
        'features/existing.feature',
        'package.json',
        'src/existing.ts',
        'test/existing.test.ts',
        'tsconfig.json',
      ])
        assert.ok(covers(config.maintained, path), `missing maintained file: ${path}`)
      assert.equal(readFileSync(join(project.root, binding), 'utf8'), registry)
      assert.equal(readFileSync(join(project.root, 'features/existing.feature'), 'utf8'), feature)
      assert.equal(readFileSync(join(project.root, 'package.json'), 'utf8'), manifest)
      assert.equal(existsSync(marker), false)
    } finally {
      project.dispose()
    }
  }
})

test('init excludes generated, dependency, VCS, and symlink paths at every depth', () => {
  const project = fixture()
  const outside = fixture()
  try {
    project.write('src/kept.ts', 'export const kept = 1\n')
    project.write('test/kept.test.ts', 'export const keptTest = 1\n')
    const excluded = [
      'node_modules/dependency/index.ts',
      'src/node_modules/dependency/index.ts',
      'dist/generated.ts',
      'src/dist/generated.ts',
      'build/generated.ts',
      'coverage/report.json',
      '.git/config',
    ]
    for (const path of excluded) project.write(path, 'generated\n')
    outside.write('outside.ts', 'export const outside = 1\n')
    symlinkSync(outside.root, join(project.root, 'linked'), 'dir')
    symlinkSync(join(project.root, 'src'), join(project.root, 'src/loop'), 'dir')
    const result = run(['init', '--root', project.root, '--json'])
    assert.equal(result.status, 0, result.stderr)
    const checked = run(['check', '--root', project.root, '--json'])
    assert.ok(checked.stdout, checked.stderr)
    const files: string[] = JSON.parse(checked.stdout).snapshot.source.files.map(
      (file: { file: string }) => file.file,
    )
    assert.ok(files.includes('src/kept.ts'))
    assert.ok(files.includes('test/kept.test.ts'))
    for (const path of excluded)
      assert.ok(!files.includes(path), `included generated file: ${path}`)
    assert.ok(!files.includes('linked/outside.ts'))
    assert.ok(!files.includes('src/loop/kept.ts'))
  } finally {
    project.dispose()
    outside.dispose()
  }
})

test('init prefers bindings.ts when both conventional registries exist', () => {
  const project = fixture()
  try {
    const primary = 'export const actions = {}\n'
    const alternative = '// Keep the alternative registry\nexport const actions = {}\n'
    project.write('bindings.ts', primary)
    project.write('bonsai.bindings.ts', alternative)
    const result = run(['init', '--root', project.root, '--json'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).config.bindings, 'bindings.ts')
    assert.equal(readFileSync(join(project.root, 'bindings.ts'), 'utf8'), primary)
    assert.equal(readFileSync(join(project.root, 'bonsai.bindings.ts'), 'utf8'), alternative)
  } finally {
    project.dispose()
  }
})

test('init preserves an existing configuration and rejects nonexistent roots', () => {
  const project = fixture()
  try {
    const original = '// Existing configuration must remain untouched\n{ "custom": true }\n'
    project.write('bonsai.json', original)
    const result = run(['init', '--root', project.root, '--json'])
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(JSON.parse(result.stderr).code, 'CONFIG_EXISTS')
    assert.equal(readFileSync(join(project.root, 'bonsai.json'), 'utf8'), original)
    assert.deepEqual(readdirSync(project.root), ['bonsai.json'])
    const missing = join(project.root, 'missing')
    const invalid = run(['init', '--root', missing, '--json'])
    assert.equal(invalid.status, 2, invalid.stderr)
    assert.equal(invalid.stdout, '')
    assert.equal(existsSync(missing), false)
  } finally {
    project.dispose()
  }
})

test('init refuses blocked starter parents without leaving files or following symlinks', () => {
  for (const kind of ['file', 'symlink']) {
    const project = fixture()
    const outside = fixture()
    try {
      outside.write('keep.txt', 'Keep outside content\n')
      if (kind === 'file') project.write('features', 'Keep the existing file\n')
      else symlinkSync(outside.root, join(project.root, 'features'), 'dir')
      const result = run(['init', '--root', project.root, '--json'])
      assert.equal(result.status, 2, result.stderr)
      assert.equal(result.stdout, '')
      assert.deepEqual(readdirSync(project.root), ['features'])
      assert.deepEqual(readdirSync(outside.root), ['keep.txt'])
      assert.equal(readFileSync(join(outside.root, 'keep.txt'), 'utf8'), 'Keep outside content\n')
      if (kind === 'file')
        assert.equal(
          readFileSync(join(project.root, 'features'), 'utf8'),
          'Keep the existing file\n',
        )
      else assert.equal(readlinkSync(join(project.root, 'features')), outside.root)
    } finally {
      project.dispose()
      outside.dispose()
    }
  }
})

test('init supports plain records and quiet mode without suppressing explicit JSON', () => {
  for (const mode of ['plain', 'quiet', 'quiet-json']) {
    const { root, dispose } = fixture()
    try {
      const flags =
        mode === 'plain' ? ['--plain'] : mode === 'quiet' ? ['--quiet'] : ['--quiet', '--json']
      const result = run(['init', '--root', root, ...flags])
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stderr, '')
      assert.doesNotMatch(result.stdout, /\x1b\[/)
      if (mode === 'quiet') assert.equal(result.stdout, '')
      else if (mode === 'quiet-json') assert.equal(JSON.parse(result.stdout).root, root)
      else {
        const records = result.stdout.trimEnd().split('\n')
        assert.ok(records.some((line) => /^created\t.*bonsai\.json$/.test(line)))
        assert.ok(records.some((line) => line.startsWith('next\t')))
        assert.ok(records.every((line) => /^(?:created|next)\t/.test(line)))
      }
    } finally {
      dispose()
    }
  }
})

test('missing project configuration offers a runnable init command for the same root', () => {
  const { root, dispose } = fixture()
  try {
    const result = run(['check', '--root', root, '--json'])
    assert.equal(result.status, 2, result.stderr)
    const error = JSON.parse(result.stderr)
    assert.equal(error.code, 'CONFIG')
    assert.match(error.run, /^bonsai init --root /)
    const initialized = spawnSync(
      'sh',
      [
        '-c',
        error.run.replace(/^bonsai\b/, '"$BONSAI_TEST_RUNTIME" "$BONSAI_TEST_CLI"') + ' --json',
      ],
      {
        encoding: 'utf8',
        timeout: 15000,
        env: { ...environment, BONSAI_TEST_RUNTIME: process.execPath, BONSAI_TEST_CLI: executable },
      },
    )
    assert.equal(initialized.status, 0, initialized.stderr)
    assert.ok(existsSync(join(root, 'bonsai.json')))
  } finally {
    dispose()
  }
})
