import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { cliEnvironment, runCli as run } from './cli.ts'

const example = resolve('examples/checkout')
const environment = cliEnvironment()

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bonsai ignore's root #"))
  return {
    root,
    write(path: string, content = 'export const value = 1\n') {
      const file = join(root, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

function initialize(root: string) {
  const result = run(['init', '--root', root, '--json'])
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function checked(root: string, flags: string[] = []) {
  const result = run(['check', '--root', root, ...flags, '--json'])
  assert.ok(result.stdout, result.stderr)
  const report = JSON.parse(result.stdout)
  const files: string[] = report.snapshot.source.files.map((file: { file: string }) => file.file)
  return { result, report, files }
}

test('init preserves root and nested gitignore patterns, anchoring, and negations', () => {
  const project = fixture()
  try {
    project.write(
      '.gitignore',
      [
        '*.generated.ts',
        '/root-only.ts',
        'cache/',
        'scratch/*',
        '!scratch/keep.ts',
        'blocked/',
        '',
      ].join('\n'),
    )
    project.write('src/.gitignore', '*.local.ts\n!keep.local.ts\n/root-local.ts\n')
    project.write('blocked/.gitignore', '!keep.ts\n')
    const included = [
      'src/kept.ts',
      'src/keep.local.ts',
      'src/deeper/root-local.ts',
      'src/root-only.ts',
      'scratch/keep.ts',
      'root.local.ts',
    ]
    const excluded = [
      'root-only.ts',
      'root.generated.ts',
      'src/deeper/hidden.generated.ts',
      'src/hidden.local.ts',
      'src/deeper/hidden.local.ts',
      'src/root-local.ts',
      'src/cache/deep.ts',
      'scratch/drop.ts',
      'blocked/keep.ts',
    ]
    for (const path of [...included, ...excluded]) project.write(path)
    const initialized = initialize(project.root)
    assert.ok(Array.isArray(initialized.config.exclude))
    const { files } = checked(project.root)
    for (const path of included) assert.ok(files.includes(path), `excluded authored file: ${path}`)
    for (const path of excluded) assert.ok(!files.includes(path), `included ignored file: ${path}`)
  } finally {
    project.dispose()
  }
})

test('init excludes environment caches and common lockfiles by default', () => {
  const project = fixture()
  try {
    project.write('.gitignore', '!bun.lock\n!.direnv/\n')
    const excluded = [
      '.direnv/cache.ts',
      'src/.direnv/cache.ts',
      '.bonsai/state.json',
      'bun.lock',
      'bun.lockb',
      'package-lock.json',
      'npm-shrinkwrap.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'src/package-lock.json',
      'custom.lock',
      'nested/custom.lockb',
      'skills-lock.json',
    ]
    for (const path of excluded) project.write(path, 'generated\n')
    project.write('src/kept.ts')
    project.write('config/manifest.json', '{}\n')
    initialize(project.root)
    const { files } = checked(project.root)
    assert.ok(files.includes('src/kept.ts'))
    assert.ok(files.includes('config/manifest.json'))
    for (const path of excluded)
      assert.ok(!files.includes(path), `included generated file: ${path}`)
  } finally {
    project.dispose()
  }
})

test('a nested Bonsai project does not supply contracts or inventory to its parent', () => {
  const project = fixture()
  try {
    project.write('src/root.ts')
    const nested = join(project.root, 'examples/checkout')
    mkdirSync(dirname(nested), { recursive: true })
    cpSync(example, nested, { recursive: true })
    const original = readFileSync(join(nested, 'bonsai.json'), 'utf8')
    const initialized = initialize(project.root)
    assert.equal(initialized.config.bindings, 'bonsai.bindings.ts')
    assert.ok(existsSync(join(project.root, 'features/bonsai.feature')))
    assert.equal(readFileSync(join(nested, 'bonsai.json'), 'utf8'), original)
    const { report, files } = checked(project.root)
    assert.equal(report.snapshot.contracts.checks.length, 0)
    assert.ok(files.includes('src/root.ts'))
    assert.ok(!files.some((path) => path.startsWith('examples/checkout/')))
  } finally {
    project.dispose()
  }
})

test('captured exclusions remain effective for future files in compacted directories', () => {
  const project = fixture()
  try {
    project.write('.gitignore', '*.generated.ts\n')
    project.write('src/kept.ts')
    const initialized = initialize(project.root)
    assert.ok(initialized.config.maintained.includes('src'))
    project.write('src/later.generated.ts')
    project.write('src/node_modules/dependency/index.ts')
    project.write('src/new.ts')
    project.write('.gitignore', 'src/new.ts\n')
    const { files } = checked(project.root)
    assert.ok(files.includes('src/kept.ts'))
    assert.ok(files.includes('src/new.ts'), 'candidate gitignore hid new authored source')
    assert.ok(!files.includes('src/later.generated.ts'), 'saved gitignore rule stopped applying')
    assert.ok(!files.includes('src/node_modules/dependency/index.ts'))
  } finally {
    project.dispose()
  }
})

test('trusted base exclusions cannot be weakened by candidate ignore rules or project markers', () => {
  const project = fixture()
  try {
    cpSync(example, project.root, { recursive: true })
    rmSync(join(project.root, 'bonsai.json'))
    project.write('.gitignore', '*.generated.ts\n')
    initialize(project.root)
    for (const args of [
      ['init', '-b', 'main', project.root],
      ['-C', project.root, 'add', '.'],
      [
        '-C',
        project.root,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'base',
      ],
    ]) {
      const result = spawnSync('git', args, { encoding: 'utf8', env: environment })
      assert.equal(result.status, 0, result.stderr)
    }
    project.write('src/unrooted.ts', 'export function unrooted() { return 1 }\n')
    project.write('src/new-project/bonsai.json', '{}\n')
    project.write('src/new-project/hidden.ts', 'export function hidden() { return 1 }\n')
    project.write('.gitignore', 'src/unrooted.ts\nsrc/new-project/\n')
    const file = join(project.root, 'bonsai.json')
    const candidate = JSON.parse(readFileSync(file, 'utf8'))
    candidate.exclude.push('src/unrooted.ts', 'src/new-project/')
    writeFileSync(file, JSON.stringify(candidate))
    const { result, report, files } = checked(project.root, ['--base', 'HEAD'])
    assert.equal(result.status, 1, result.stderr)
    assert.equal(report.decision.status, 'reject')
    assert.ok(files.includes('src/unrooted.ts'))
    assert.ok(files.includes('src/new-project/bonsai.json'))
    assert.ok(files.includes('src/new-project/hidden.ts'))
    assert.equal(report.snapshot.contracts.checks.length, 3)
  } finally {
    project.dispose()
  }
})

test('ignore rules conflicting with mandatory starter paths fail before any writes', () => {
  for (const pattern of ['bonsai.json', '*.ts', 'features/']) {
    const project = fixture()
    try {
      project.write('.gitignore', pattern + '\n')
      const result = run(['init', '--root', project.root, '--json'])
      assert.equal(result.status, 2, result.stderr)
      assert.equal(result.stdout, '')
      const error = JSON.parse(result.stderr)
      assert.equal(error.code, 'INIT')
      assert.match(error.run, /ignore|exclude/i)
      assert.deepEqual(readdirSync(project.root), ['.gitignore'])
    } finally {
      project.dispose()
    }
  }
})
