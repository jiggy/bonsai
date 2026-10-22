import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { defaultExclusions, excludedBy, literalExclusion, scopedIgnore } from '../src/exclusions.ts'

type Query = string | [path: string, directory: boolean]

function conforms(files: Record<string, string>, queries: Query[]) {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-ignore-'))
  const git = (args: string[]) =>
    spawnSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    })
  try {
    const initialized = git(['init', '--quiet', '--template='])
    assert.equal(initialized.status, 0, initialized.stderr)
    assert.equal(git(['config', 'core.ignoreCase', 'false']).status, 0)
    const patterns: string[] = []
    for (const [path, text] of Object.entries(files).sort(
      ([a], [b]) => a.split('/').length - b.split('/').length,
    )) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
      const base = dirname(path)
      patterns.push(...scopedIgnore(text, base === '.' ? '' : base))
    }
    const excluded = excludedBy(patterns)
    for (const query of queries) {
      const [path, directory] = typeof query === 'string' ? [query, false] : query
      mkdirSync(directory ? join(root, path) : dirname(join(root, path)), { recursive: true })
      if (!directory) writeFileSync(join(root, path), '')
      const result = git(['check-ignore', '--no-index', '--quiet', '--', path])
      assert.ok(result.status === 0 || result.status === 1, result.stderr)
      assert.equal(excluded(path, directory), result.status === 0, path)
    }
    return excluded
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('default exclusions cover generated artifacts, dependencies, caches, and lockfiles', () => {
  const excluded = excludedBy(defaultExclusions)
  for (const path of [
    '.git',
    '.hg',
    '.svn',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.next',
    '.nuxt',
    '.output',
    '.cache',
    '.turbo',
    '.vercel',
    '.svelte-kit',
    '.parcel-cache',
    'target',
    '.direnv',
    '.bonsai',
  ]) {
    assert.equal(excluded(path, true), true, path)
    assert.equal(excluded(`packages/app/${path}/generated.ts`), true, path)
  }
  for (const path of [
    'bun.lock',
    'bun.lockb',
    'yarn.lock',
    'Cargo.lock',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'pnpm-lock.yaml',
    'skills-lock.json',
  ]) {
    assert.equal(excluded(path), true, path)
    assert.equal(excluded(`packages/app/${path}`), true, path)
  }
  for (const path of [
    'package.json',
    '.github/workflows/check.yml',
    'src/lock.ts',
    'Node_Modules/a.ts',
  ])
    assert.equal(excluded(path), false, path)
})

test('compiled exclusions preserve ordered negation and remain independent of pattern edits', () => {
  const patterns = ['*.tmp', '!keep.tmp', '*.tmp']
  const excluded = excludedBy(patterns)
  assert.equal(excluded('keep.tmp'), true)
  patterns.push('!keep.tmp', 'later.ts')
  assert.equal(excluded('keep.tmp'), true)
  assert.equal(excluded('later.ts'), false)
  assert.equal(excluded(''), false)
  assert.equal(excluded('.', true), false)
  const exception = excludedBy([...defaultExclusions, '!dist/', 'dist/*', '!dist/kept.ts'])
  assert.equal(exception('dist', true), false)
  assert.equal(exception('dist/kept.ts'), false)
  assert.equal(exception('dist/dropped.ts'), true)
})

test('nested gitignore anchors, basename rules, directory rules, and double stars agree with Git', () => {
  conforms(
    {
      '.gitignore': 'root-anywhere.txt\n/root-only.txt\n*.tmp\n',
      'packages/app/.gitignore': [
        'cache/',
        'build/   ',
        '/only-here.txt',
        'rel/file.ts',
        '!keep.tmp',
        '**/trace.log',
      ].join('\n'),
    },
    [
      'root-anywhere.txt',
      'packages/other/root-anywhere.txt',
      'root-only.txt',
      'packages/app/root-only.txt',
      ['packages/app/cache', true],
      ['packages/app/deep/cache', true],
      'packages/app/cache/keep.tmp',
      ['packages/app/build', true],
      ['packages/app/deep/build', true],
      'packages/app/only-here.txt',
      'packages/app/deep/only-here.txt',
      'packages/app/rel/file.ts',
      'packages/app/deep/rel/file.ts',
      'packages/app/keep.tmp',
      'packages/app/deep/keep.tmp',
      'packages/other/keep.tmp',
      'packages/app/trace.log',
      'packages/app/deep/trace.log',
      'packages/other/trace.log',
    ],
  )
})

test('nested negation can override a parent file rule but cannot reopen an ignored parent directory', () => {
  conforms(
    {
      '.gitignore': '*.tmp\nblocked/\nignored/*\ncontents/**\n',
      'allowed/.gitignore': '!keep.tmp\n',
      'blocked/.gitignore': '!keep.tmp\n!child/\n!child/keep.tmp\n',
      'ignored/.gitignore': '!keep.tmp\n!child/\nchild/*\n!child/keep.tmp\n',
      'contents/.gitignore': '!keep.tmp\n',
    },
    [
      'allowed/keep.tmp',
      'allowed/deep/keep.tmp',
      'allowed/drop.tmp',
      ['blocked', true],
      'blocked/keep.tmp',
      'blocked/child/keep.tmp',
      'ignored/keep.tmp',
      ['ignored/child', true],
      'ignored/child/keep.tmp',
      'ignored/child/drop.tmp',
      ['contents', true],
      'contents/keep.tmp',
      'contents/drop.tmp',
    ],
  )
})

test('scoped rules preserve escaped markers, glob literals, spaces, BOM, and CRLF', () => {
  const base = 'packages/[app] space'
  conforms(
    {
      '.gitignore': '\uFEFF# comment\r\nroot\\ space.txt\r\n',
      [`${base}/.gitignore`]:
        '\uFEFF' +
        [
          String.raw`\#hash`,
          String.raw`\!bang`,
          ' leading.txt',
          String.raw`trailing\ `,
          'trimmed   ',
          String.raw`literal\[x\].txt`,
          String.raw`star\*.txt`,
          String.raw`question\?.txt`,
          String.raw`back\\slash.txt`,
          '# comment',
          '/',
          '!',
          '    ',
          '/anchored.txt',
          'folder/   ',
        ].join('\r\n'),
    },
    [
      'root space.txt',
      'rootspace.txt',
      `${base}/#hash`,
      `${base}/!bang`,
      `${base}/deep/#hash`,
      `${base}/ leading.txt`,
      `${base}/leading.txt`,
      `${base}/trailing `,
      `${base}/trailing`,
      `${base}/trimmed`,
      `${base}/trimmed `,
      `${base}/literal[x].txt`,
      `${base}/literalx.txt`,
      `${base}/star*.txt`,
      `${base}/star-other.txt`,
      `${base}/question?.txt`,
      `${base}/questionA.txt`,
      `${base}/back\\slash.txt`,
      `${base}/backslash.txt`,
      `${base}/anchored.txt`,
      `${base}/deep/anchored.txt`,
      [`${base}/folder`, true],
      [`${base}/deep/folder`, true],
      ['packages/a space/folder', true],
      `${base}/unmatched.ts`,
    ],
  )
})

test('literal exclusions match exact anchored paths containing gitignore metacharacters', () => {
  const files = [
    'name[1]',
    'star*name',
    'question?name',
    '#hash',
    '!bang',
    'with space',
    'trailing ',
    'back\\slash',
  ]
  const directory = 'apps/[child] project'
  const patterns = [
    ...files.map((path) => literalExclusion(path)),
    literalExclusion(directory, true),
  ]
  const excluded = conforms({ '.gitignore': patterns.join('\n') + '\n' }, [
    ...files,
    'name1',
    'star-other-name',
    'questionAname',
    'withspace',
    'trailing',
    'backslash',
    'deep/name[1]',
    [directory, true],
    `${directory}/src/main.ts`,
    ['apps/c project', true],
    'deep/apps/[child] project/src/main.ts',
  ])
  for (const path of files) assert.equal(excluded(path), true, path)
  assert.equal(excluded(`${directory}/src/main.ts`), true)
})
