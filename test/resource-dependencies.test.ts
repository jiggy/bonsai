import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inventory } from '../src/source.ts'
import { collectRustSource } from '../src/collector.ts'
import { analyzeSource } from './reference.ts'
import { canonicalSource } from './native/client.ts'
import { compileContracts } from '../src/contracts.ts'
import { buildSnapshot } from '../src/retention.ts'
import type { Config } from '../src/model.ts'
import { runCli } from './cli.ts'

const behavior = `Feature: Resource response
Scenario: Read the greeting
 When I invoke "sample" with {}
 Then response "status" equals "hello"
`
const handler = `import { readFileSync, writeFileSync } from 'node:fs'
export function sample() {
 writeFileSync(new URL('./executed', import.meta.url), 'executed')
 return { status: readFileSync(new URL('./message.txt', import.meta.url), 'utf8') }
}
`

function fixture(code = handler, extra: Record<string, string> = {}) {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/resource-dependencies-'))
  const content = {
    'package.json': '{"type":"module"}',
    'handler.ts': code,
    'bindings.ts':
      "import { sample } from './handler.ts'\nexport const actions = { sample: sample }\n",
    'message.txt': 'hello',
    'sample.feature': behavior,
    ...extra,
  }
  for (const [file, text] of Object.entries(content)) writeFileSync(resolve(root, file), text)
  const config: Config = {
    maintained: [...Object.keys(content), 'bonsai.json'],
    bindings: 'bindings.ts',
    policy: {
      bootstrap: 10000,
      bootstrapSurface: 1,
      perDoubling: 0,
      hardLimit: 10000,
      maxFeedbackMs: 15000,
    },
  }
  const save = () => writeFileSync(resolve(root, 'bonsai.json'), JSON.stringify(config))
  save()
  return { root, config, save, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

test('a literal UTF-8 resource has a read-only explanation after actual native verification', () => {
  const project = fixture()
  try {
    const check = runCli(['check', '--root', project.root, '--json'])
    assert.equal(check.error, undefined)
    assert.equal(check.status, 0, check.stderr || check.stdout)
    const verified = JSON.parse(check.stdout)
    assert.equal(verified.decision.status, 'pass')
    assert.equal(verified.snapshot.evidence.complete, true)
    assert.deepEqual(
      verified.snapshot.evidence.checks.map((check: { status: string }) => check.status),
      ['passed'],
    )
    assert.equal(existsSync(resolve(project.root, 'executed')), true)
    rmSync(resolve(project.root, 'executed'))
    const explanation = runCli([
      'explain',
      'message.txt#<resource>',
      '--root',
      project.root,
      '--json',
    ])
    assert.equal(explanation.error, undefined)
    assert.equal(explanation.status, 0, explanation.stderr || explanation.stdout)
    const report = JSON.parse(explanation.stdout)
    assert.equal(report.components.length, 1)
    assert.equal(report.components[0].checks.length, 1)
    assert.equal(existsSync(resolve(project.root, 'executed')), false)
  } finally {
    project.dispose()
  }
})

test('a literal resource outside maintained scope blocks before executing the otherwise working handler', () => {
  const project = fixture()
  try {
    project.config.maintained = project.config.maintained.filter((file) => file !== 'message.txt')
    project.save()
    const result = runCli(['check', '--root', project.root, '--json'])
    assert.equal(result.error, undefined)
    assert.equal(result.status, 2, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.decision.status, 'incomplete')
    assert.ok(
      report.snapshot.source.problems.some(
        (problem: string) => /resource/i.test(problem) && problem.includes('message.txt'),
      ),
    )
    assert.equal(existsSync(resolve(project.root, 'executed')), false)
  } finally {
    project.dispose()
  }
})

async function both(
  project: ReturnType<typeof fixture>,
  files = inventory(project.root, project.config.maintained, project.config.exclude),
) {
  const reference = analyzeSource(project.root, files, project.config.bindings)
  const native = await collectRustSource(project.root, files, project.config.bindings)
  assert.deepEqual(canonicalSource(native.source), canonicalSource(reference))
  return {
    source: native.source,
    snapshot: buildSnapshot(
      'resource-fixture',
      compileContracts([{ file: 'sample.feature', text: behavior }]),
      native.source,
    ),
  }
}

test('named reader aliases deduplicate the whole-file resource with real call provenance and no cost discount', async () => {
  const project = fixture(`import { readFileSync as read } from 'node:fs'
export function sample() {
 const first = read(new URL('./message.txt', import.meta.url), 'utf8')
 const second = read(new URL('./message.txt', import.meta.url), 'utf-8')
 return { status: first + second }
}
export function dormant() { return read(new URL('./message.txt', import.meta.url), 'utf8') }
`)
  try {
    const { source, snapshot } = await both(project)
    assert.deepEqual(source.problems, [])
    const resources = source.components.filter((component) => component.name === '<resource>')
    assert.equal(resources.length, 1)
    const resource = resources[0]!
    assert.equal(resource.id, 'message.txt#<resource>')
    assert.equal(resource.tokens, source.files.find((file) => file.file === 'message.txt')!.tokens)
    const edges = source.relationships.filter((edge) => edge.to === resource.id)
    assert.equal(edges.length, 2)
    assert.deepEqual(
      edges.map((edge) => [
        edge.from,
        edge.kind,
        edge.origin,
        edge.sourceRef.file,
        edge.sourceRef.line,
      ]),
      [
        ['handler.ts#sample', 'reference', 'static', 'handler.ts', 3],
        ['handler.ts#dormant', 'reference', 'static', 'handler.ts', 7],
      ],
    )
    assert.equal(source.files.filter((file) => file.file === 'message.txt').length, 1)
    assert.ok(snapshot.ancestry[resource.id]?.length)
    assert.ok(snapshot.unrooted.includes('handler.ts#dormant'))
    assert.equal(existsSync(resolve(project.root, 'executed')), false)
  } finally {
    project.dispose()
  }
})

test('reading source as data never roots its executable declarations or unused neighboring resource', async () => {
  const project = fixture(
    `import { readFileSync } from 'node:fs'
export function sample() { return { status: readFileSync(new URL('./data.ts', import.meta.url), 'utf8') } }
export function dormant() { return readFileSync(new URL('./unused.txt', import.meta.url), 'utf8') }
`,
    { 'data.ts': 'export function neverCalled() { return 42 }\n', 'unused.txt': 'unused' },
  )
  try {
    const { source, snapshot } = await both(project)
    assert.deepEqual(source.problems, [])
    assert.ok(snapshot.ancestry['data.ts#<resource>']?.length)
    assert.ok(snapshot.unrooted.includes('data.ts#neverCalled'))
    assert.ok(snapshot.unrooted.includes('unused.txt#<resource>'))
    assert.ok(snapshot.unrooted.includes('handler.ts#dormant'))
  } finally {
    project.dispose()
  }
})

test('test reads cannot add resource ancestry and ordinary runtime input reads remain outside the adapter', async () => {
  const project = fixture(
    `import { readFileSync } from 'node:fs'
export function sample() { return { status: 'hello' } }
export function runtimeInput(path: string) { return readFileSync(path, 'utf8') }
`,
    {
      'reader.test.ts': `import { readFileSync } from 'node:fs'
import { sample } from './handler.ts'
export function supportingTest() { sample(); return readFileSync(new URL('./message.txt', import.meta.url), 'utf8') }
`,
    },
  )
  try {
    const { source, snapshot } = await both(project)
    assert.deepEqual(source.problems, [])
    assert.equal(
      source.components.some((component) => component.name === '<resource>'),
      false,
    )
    assert.ok(snapshot.ancestry['reader.test.ts#supportingTest']?.length)
    assert.ok(snapshot.unrooted.includes('handler.ts#runtimeInput'))
    assert.ok(source.files.some((file) => file.file === 'message.txt' && file.tokens > 0))
  } finally {
    project.dispose()
  }
})

test('resolved reader and global constructor identities exclude lookalikes and mutable URL aliases', async () => {
  const project = fixture(
    `import { readFileSync } from 'node:fs'
import { readFileSync as fake } from './fake.ts'
import { URL as ImportedURL } from 'node:url'
const alias = new URL('./message.txt', import.meta.url)
export function sample() { return { status: 'hello' } }
export function fakeReader() { return fake(new URL('./message.txt', import.meta.url), 'utf8') }
export function shadowReader(readFileSync: typeof fake) { return readFileSync(new URL('./message.txt', import.meta.url), 'utf8') }
export function shadowURL(URL: typeof globalThis.URL) { return readFileSync(new URL('./message.txt', import.meta.url), 'utf8') }
export function importedURL() { return readFileSync(new ImportedURL('./message.txt', import.meta.url), 'utf8') }
export function mutableAlias() { alias.pathname = '/different'; return readFileSync(alias, 'utf8') }
`,
    {
      'fake.ts':
        'export function readFileSync(path: URL, encoding: string) { return String(path) + encoding }\n',
    },
  )
  try {
    const { source } = await both(project)
    assert.deepEqual(source.problems, [])
    assert.equal(
      source.components.some((component) => component.name === '<resource>'),
      false,
    )
  } finally {
    project.dispose()
  }
})

test('recognized module URL reads reject computed selection, encoding changes, search, hash, traversal, and encoded slashes', async () => {
  for (const expression of [
    "readFileSync(new URL(['.', 'message.txt'].join('/'), import.meta.url), 'utf8')",
    "readFileSync(new URL('./message.txt', import.meta.url), 'base64')",
    "readFileSync(new URL('./message.txt', import.meta.url))",
    "readFileSync(new URL('./message.txt?query', import.meta.url), 'utf8')",
    "readFileSync(new URL('./message.txt#fragment', import.meta.url), 'utf8')",
    "readFileSync(new URL('../message.txt', import.meta.url), 'utf8')",
    "readFileSync(new URL('https://example.com/message.txt', import.meta.url), 'utf8')",
    "readFileSync(new URL('./folder%2fmessage.txt', import.meta.url), 'utf8')",
    "readFileSync(new URL('./folder%5cmessage.txt', import.meta.url), 'utf8')",
  ]) {
    const project = fixture(`import { readFileSync } from 'node:fs'
export function sample() { return { status: ${expression} } }
`)
    try {
      const { source } = await both(project)
      assert.ok(
        source.problems.some((problem) => /resource/i.test(problem)),
        expression,
      )
      assert.equal(
        source.components.some((component) => component.name === '<resource>'),
        false,
      )
    } finally {
      project.dispose()
    }
  }
})

test('recognized resources reject malformed UTF-8, binary formats, missing targets, and symlink paths', async () => {
  for (const mode of ['utf8', 'binary', 'missing', 'symlink']) {
    const target = mode === 'binary' ? './image.png' : './message.txt'
    const project = fixture(handler.replace('./message.txt', target))
    try {
      if (mode === 'utf8')
        writeFileSync(resolve(project.root, 'message.txt'), Buffer.from([0xc3, 0x28]))
      if (mode === 'binary') {
        writeFileSync(
          resolve(project.root, 'image.png'),
          'ASCII bytes do not make a PNG supported text',
        )
        project.config.maintained.push('image.png')
      }
      if (mode === 'missing') {
        rmSync(resolve(project.root, 'message.txt'))
        project.config.maintained = project.config.maintained.filter(
          (file) => file !== 'message.txt',
        )
      }
      if (mode === 'symlink') {
        rmSync(resolve(project.root, 'message.txt'))
        symlinkSync('package.json', resolve(project.root, 'message.txt'))
      }
      project.save()
      // Missing/symlink files are not regular inventory members; retaining a
      // literal reference must still block rather than silently ignore the read.
      if (mode === 'symlink')
        assert.throws(() => inventory(project.root, project.config.maintained), /Symlinks/)
      const { source } = await both(
        project,
        mode === 'symlink' ? project.config.maintained : undefined,
      )
      assert.ok(
        source.problems.some((problem) => /resource/i.test(problem)),
        mode + '\n' + source.problems.join('\n'),
      )
      assert.equal(
        source.components.some((component) => component.name === '<resource>'),
        false,
      )
      assert.equal(existsSync(resolve(project.root, 'executed')), false)
    } finally {
      project.dispose()
    }
  }
})
