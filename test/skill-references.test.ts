import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { referenceSources, syncSkills } from './skill-references.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))
const entry = join(repository, 'test/skill-references.ts')
const code =
  '````markdown\n[Literal example](missing.md)\n```feature\nThen response "status" equals "accepted"\n```\n````\n'
const guide =
  '---\ntitle: A workflow\n---\n\n# Workflow\n\n' +
  '[Adoption](adoption.md#start) and [README](../README.md).\n' +
  '[Unbundled](more.md) and [source](../src/example.ts).\n' +
  '[Reference][cli]\n\n[cli]: cli.md "CLI reference"\n' +
  '`[Inline example](missing-inline.md)`\n\n' +
  '    [Indented example](missing-indented.md)\n\n' +
  code

async function put(root: string, path: string, bytes: string | Uint8Array) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), bytes)
}

async function fixture(t: TestContext) {
  const temporary = join(repository, 'work')
  await mkdir(temporary, { recursive: true })
  const root = await mkdtemp(join(temporary, 'skill-references-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const source of Object.keys(referenceSources)) await put(root, source, `# ${source}\n`)
  await put(
    root,
    'skills/bonsai/SKILL.md',
    '---\nname: bonsai\ndescription: Adopt Bonsai.\n---\n\nRead [Workflow](reference/workflow.md) and [Adoption](reference/adoption.md).\n',
  )
  await put(
    root,
    'README.md',
    '# Bonsai\n\n[Workflow](docs/agent-workflow.md) and [Skill](skills/bonsai/SKILL.md).\n[Native](https://github.com/jiggy/bonsai/blob/main/docs/native-prototype.md).\n',
  )
  await put(root, 'docs/agent-workflow.md', guide)
  await put(root, 'docs/more.md', '# Further documentation\n')
  await put(root, 'src/example.ts', 'export const example = 1\n')
  await put(root, 'skills/bonsai/notes.md', 'Authored companion file.\n')
  return root
}

async function snapshot(directory: string) {
  const files: [string, string][] = []
  async function visit(prefix: string) {
    for (const name of (await readdir(join(directory, prefix))).sort()) {
      const path = join(prefix, name)
      if ((await lstat(join(directory, path))).isDirectory()) await visit(path)
      else files.push([path, (await readFile(join(directory, path))).toString('base64')])
    }
  }
  await visit('')
  return files
}

test('bundles standalone references without changing examples or adding maintenance text', async (t) => {
  const root = await fixture(t)
  const skill = await readFile(join(root, 'skills/bonsai/SKILL.md'))
  await syncSkills({ root })
  assert.deepEqual(await readFile(join(root, 'skills/bonsai/SKILL.md')), skill)
  const output = join(root, 'skills/bonsai/reference')
  const workflow = await readFile(join(output, 'workflow.md'), 'utf8')
  assert.ok(workflow.startsWith('---\ntitle: A workflow\n---\n\n# Workflow\n'))
  assert.ok(workflow.includes('[Adoption](adoption.md#start) and [README](README.md).'))
  assert.ok(workflow.includes('[cli]: cli.md "CLI reference"'))
  assert.ok(workflow.includes('https://github.com/jiggy/bonsai/blob/main/docs/more.md'))
  assert.ok(workflow.includes('https://github.com/jiggy/bonsai/blob/main/src/example.ts'))
  assert.ok(workflow.includes(code))
  assert.ok(workflow.includes('`[Inline example](missing-inline.md)`'))
  assert.ok(workflow.includes('    [Indented example](missing-indented.md)'))
  assert.doesNotMatch(workflow, /<!-- Generated from|Edit the source|sync-skills/)
  const readme = await readFile(join(output, 'README.md'), 'utf8')
  assert.ok(readme.includes('[Workflow](workflow.md) and [Skill](../SKILL.md).'))
  assert.ok(readme.includes('[Native](native-prototype.md)'))
  for (const source of [
    'docs/adoption.md',
    'LICENSE.md',
    'LICENSES.md',
    'PRICING.md',
    'LICENSE-ACTION',
  ])
    assert.deepEqual(
      await readFile(join(output, referenceSources[source])),
      await readFile(join(root, source)),
    )
  const provenance = JSON.parse(await readFile(join(output, 'provenance.json'), 'utf8'))
  assert.deepEqual(Object.keys(provenance), ['version', 'repository', 'files'])
  for (const file of provenance.files) {
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
    assert.equal(file.sourceSha256, hash(await readFile(join(root, file.source))))
    assert.equal(file.outputSha256, hash(await readFile(join(output, file.destination))))
  }
  const detached = join(root, 'installed')
  await cp(join(root, 'skills/bonsai'), detached, { recursive: true })
  await rm(join(root, 'docs'), { recursive: true })
  await rm(join(root, 'skills'), { recursive: true })
  assert.deepEqual(await readFile(join(detached, 'SKILL.md')), skill)
  for (const target of ['workflow.md', 'adoption.md', 'README.md', 'cli.md', 'native-prototype.md'])
    assert.ok((await readFile(join(detached, 'reference', target))).length > 0)
  assert.equal(
    (await snapshot(detached)).some(([path]) => /\.(?:feature|ts)$/.test(path)),
    false,
  )
})

test('check is read-only and repeated synchronization is stable', async (t) => {
  const root = await fixture(t)
  const output = join(root, 'skills/bonsai/reference')
  await assert.rejects(syncSkills({ root, check: true }), /references are stale/)
  await assert.rejects(lstat(output), { code: 'ENOENT' })
  await syncSkills({ root })
  const before = await snapshot(output)
  assert.deepEqual(await syncSkills({ root }), [])
  assert.deepEqual(await syncSkills({ root, check: true }), [])
  await put(root, 'docs/adoption.md', '# A changed adoption guide\n')
  const result = spawnSync(process.execPath, [entry, '--root', root, '--check'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Run bun run sync-skills/)
  assert.deepEqual(await snapshot(output), before)
  await syncSkills({ root })
  assert.equal(await readFile(join(output, 'adoption.md'), 'utf8'), '# A changed adoption guide\n')
  assert.deepEqual(await syncSkills({ root, check: true }), [])
})

test('repairs missing and edited references and removes stale output without touching authored files', async (t) => {
  const root = await fixture(t)
  await syncSkills({ root })
  const output = join(root, 'skills/bonsai/reference')
  const expected = await snapshot(output)
  await rm(join(output, 'adoption.md'))
  await writeFile(join(output, 'README.md'), 'An incorrect installed copy.\n')
  await put(output, 'obsolete/guide.md', 'Stale reference.\n')
  await syncSkills({ root })
  assert.deepEqual(await snapshot(output), expected)
  await assert.rejects(lstat(join(output, 'obsolete')), { code: 'ENOENT' })
  assert.equal(
    await readFile(join(root, 'skills/bonsai/notes.md'), 'utf8'),
    'Authored companion file.\n',
  )
})

test('missing sources and escaping links fail before any output changes', async (t) => {
  const root = await fixture(t)
  await syncSkills({ root })
  const output = join(root, 'skills/bonsai/reference')
  const before = await snapshot(output)
  await put(root, 'docs/adoption.md', '# New source\n')
  await rm(join(root, 'docs/cli.md'))
  await assert.rejects(syncSkills({ root }), /Maintained path does not exist/)
  assert.deepEqual(await snapshot(output), before)
  await put(root, 'docs/cli.md', '# Restored source\n')
  await put(root, 'README.md', '[Outside](../outside.md)\n')
  await assert.rejects(syncSkills({ root }), /Invalid reference path/)
  assert.deepEqual(await snapshot(output), before)
  await put(root, 'README.md', '# Restored README\n')
  await put(root, 'skills/bonsai/SKILL.md', '# Skill\n\n[Repository dependency](../../README.md)\n')
  await assert.rejects(syncSkills({ root }), /Skill link escapes/)
  assert.deepEqual(await snapshot(output), before)
})

test('source and output symlinks cannot read or overwrite their targets', async (t) => {
  const root = await fixture(t)
  await syncSkills({ root })
  const output = join(root, 'skills/bonsai/reference')
  const before = await snapshot(output)
  await put(root, 'sentinel.md', 'Keep these bytes.\n')
  await rm(join(root, 'README.md'))
  await symlink(join(root, 'sentinel.md'), join(root, 'README.md'))
  await assert.rejects(syncSkills({ root }), /[Ss]ymlinks/)
  assert.deepEqual(await snapshot(output), before)
  await rm(join(root, 'README.md'))
  await put(root, 'README.md', '# A normal source\n')
  await rm(join(output, 'adoption.md'))
  await symlink(join(root, 'sentinel.md'), join(output, 'adoption.md'))
  await assert.rejects(syncSkills({ root }), /[Ss]ymlinks/)
  assert.equal(await readFile(join(root, 'sentinel.md'), 'utf8'), 'Keep these bytes.\n')
})

test('CI exports newly generated files and deletions as an applicable patch', async (t) => {
  const root = await fixture(t)
  const output = join(root, 'skills/bonsai/reference')
  await syncSkills({ root })
  await rm(join(output, 'verification.md'))
  await put(output, 'obsolete.md', 'Old reference.\n')
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  git('init', '-b', 'main')
  git('add', '.')
  git(
    '-c',
    'user.name=Bonsai Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-m',
    'Fixture',
  )
  await put(root, 'docs/adoption.md', '# Revised guide\n')
  await syncSkills({ root })
  const workflow = await readFile(join(repository, '.github/workflows/ci.yml'), 'utf8')
  const patchStep = workflow.slice(workflow.indexOf('        id: patch\n'))
  const script = /        run: \|\n((?:          [^\n]*(?:\n|$))+)/
    .exec(patchStep)?.[1]
    .replace(/^ {10}/gm, '')
  assert.ok(script, 'CI must export its generated changes')
  const temporary = join(root, 'runner-temp')
  await mkdir(temporary)
  execFileSync('sh', ['-eu', '-c', script], {
    cwd: root,
    env: { ...process.env, RUNNER_TEMP: temporary, GITHUB_OUTPUT: join(temporary, 'outputs') },
  })
  assert.equal(await readFile(join(temporary, 'outputs'), 'utf8'), 'changed=true\n')
  const replica = join(root, 'replica')
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', '--', root, replica])
  execFileSync('git', [
    '-C',
    replica,
    'apply',
    '--index',
    join(temporary, 'format-patch/format.patch'),
  ])
  assert.equal(
    await readFile(join(replica, 'skills/bonsai/reference/verification.md'), 'utf8'),
    '# docs/verification.md\n',
  )
  await assert.rejects(lstat(join(replica, 'skills/bonsai/reference/obsolete.md')), {
    code: 'ENOENT',
  })
  assert.equal(
    await readFile(join(replica, 'skills/bonsai/reference/adoption.md'), 'utf8'),
    '# Revised guide\n',
  )
  assert.equal(await readFile(join(replica, 'docs/adoption.md'), 'utf8'), '# Revised guide\n')
})
