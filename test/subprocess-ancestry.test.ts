import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { inventory } from '../src/source.ts'
import { analyzeSource } from './reference.ts'
import { collectRustSource } from '../src/collector.ts'
import { compileContracts } from '../src/contracts.ts'
import { buildSnapshot } from '../src/retention.ts'
import type { Config, Source } from '../src/model.ts'
import { canonicalSource } from '../native/tools/client.ts'
import { runCli } from './cli.ts'

const repository = resolve('.')
const behavior = `Feature: Child process
Scenario: Report the child result
 When I invoke "sample" with {}
 Then response "status" equals "from-child"
`
const launcher = `import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const entry = fileURLToPath(new URL('./child.ts', import.meta.url))
export function sample() {
  const result = spawnSync(process.execPath, [entry], { encoding: 'utf8', timeout: 3000 })
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout)
}
`
const child = `import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
function answer() { return 'from-child' }
writeFileSync(fileURLToPath(new URL('./executed', import.meta.url)), 'executed')
process.stdout.write(JSON.stringify({ status: answer() }))
`

function fixture(handler = launcher, extra: Record<string, string> = {}) {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/subprocess-ancestry-'))
  const content = {
    'package.json': '{"type":"module"}',
    'handler.ts': handler,
    'bindings.ts':
      "import { sample } from './handler.ts'\nexport const actions = { sample: sample }\n",
    'child.ts': child,
    'sample.feature': behavior,
    ...extra,
  }
  for (const [file, text] of Object.entries(content)) {
    mkdirSync(dirname(resolve(root, file)), { recursive: true })
    writeFileSync(resolve(root, file), text)
  }
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

async function both(project: ReturnType<typeof fixture>) {
  const files = inventory(project.root, project.config.maintained, project.config.exclude)
  const reference = analyzeSource(project.root, files, project.config.bindings)
  const native = await collectRustSource(project.root, files, project.config.bindings)
  assert.deepEqual(canonicalSource(native.source), canonicalSource(reference))
  const contracts = compileContracts([{ file: 'sample.feature', text: behavior }])
  return { source: reference, snapshot: buildSnapshot('fixture', contracts, reference) }
}

const entries = (source: Source) =>
  source.relationships.filter((edge) => edge.kind === 'entry-point')

test('fixed child entry points retain executable startup and selected helpers without retaining unused exports', async () => {
  const project = fixture(
    launcher + '\nconst ambientURL = globalThis.URL\nconst ambientRuntime = globalThis.process\n',
    {
      'child.ts':
        child +
        '\nexport function unused() { return 42 }\nexport const inert = 42\nfunction uncalled() { return 42 }\nexport default () => uncalled()\n',
    },
  )
  try {
    const { source, snapshot } = await both(project)
    assert.deepEqual(source.problems, [])
    const edges = entries(source)
    assert.ok(edges.length > 0)
    assert.ok(edges.every((edge) => edge.from === 'handler.ts#sample'))
    assert.ok(
      edges.every((edge) => edge.sourceRef.file === 'handler.ts' && edge.sourceRef.line === 5),
    )
    assert.ok(edges.every((edge) => edge.origin === 'static' && edge.to.startsWith('child.ts#')))
    assert.ok(snapshot.ancestry['child.ts#answer']?.length)
    assert.ok(snapshot.unrooted.includes('child.ts#unused'))
    assert.ok(snapshot.unrooted.includes('child.ts#inert'))
    assert.ok(snapshot.unrooted.includes('child.ts#uncalled'))
    assert.equal(existsSync(resolve(project.root, 'executed')), false)
  } finally {
    project.dispose()
  }
})

test('the native default and compatibility alias verify a child while explain never executes it', () => {
  const project = fixture()
  try {
    for (const selection of [[], ['--engine', 'rust']]) {
      for (const command of ['explain', 'check']) {
        rmSync(resolve(project.root, 'executed'), { force: true })
        const result = runCli(
          [
            command,
            ...(command === 'explain' ? ['child.ts#answer'] : []),
            '--root',
            project.root,
            ...selection,
            '--json',
          ],
          {
            cwd: repository,
            timeout: 15000,
            env: {
              ...process.env,
              BONSAI_ROOT: undefined,
              BONSAI_BASE: undefined,
              BONSAI_POLICY: undefined,
              NO_COLOR: '1',
            },
          },
        )
        assert.equal(result.error, undefined, String(result.error))
        assert.equal(result.status, 0, result.stderr || result.stdout)
        const report = JSON.parse(result.stdout)
        if (command === 'check') {
          assert.equal(report.decision.status, 'pass')
          assert.equal(report.snapshot.evidence.complete, true)
          assert.equal(report.snapshot.evidence.fingerprint, report.snapshot.fingerprint)
          assert.deepEqual(
            report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
            ['passed'],
          )
        } else {
          assert.equal(report.components.length, 1)
          assert.equal(report.components[0].checks.length, 1)
        }
        assert.equal(existsSync(resolve(project.root, 'executed')), command === 'check')
      }
    }
  } finally {
    project.dispose()
  }
})

test('literal dynamic fork imports and aliased builtin imports resolve the same maintained child', async () => {
  const project = fixture(`import { spawnSync as launch } from 'node:child_process'
import { fileURLToPath as path } from 'node:url'
const entry = path(new URL('./child.ts', import.meta.url))
export function sample() { launch(process.execPath, [entry]); return { status: 'from-child' } }
export async function forkChild() {
  const { fork: run } = await import('node:child_process')
  return run(new URL('./child.ts', import.meta.url), [], { execArgv: [], silent: true })
}
`)
  try {
    const { source } = await both(project)
    assert.deepEqual(source.problems, [])
    const owners = new Set(entries(source).map((edge) => edge.from))
    assert.deepEqual(owners, new Set(['handler.ts#sample', 'handler.ts#forkChild']))
    assert.equal(existsSync(resolve(project.root, 'executed')), false)
  } finally {
    project.dispose()
  }
})

test('uncontracted launches and admitted lower-level tests cannot grant child production ancestry', async () => {
  const project = fixture(
    `import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
export function sample() { return { status: 'from-child' } }
export function unusedLaunch() {
  return spawnSync(process.execPath, [fileURLToPath(new URL('./child.ts', import.meta.url))])
}
`,
    {
      'launcher.test.ts': `import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sample } from './handler.ts'
test('child', () => {
  sample()
  spawnSync(process.execPath, [fileURLToPath(new URL('./child.ts', import.meta.url))])
})
`,
    },
  )
  try {
    const { source, snapshot } = await both(project)
    assert.deepEqual(source.problems, [])
    assert.ok(entries(source).some((edge) => edge.from === 'handler.ts#unusedLaunch'))
    const lowerTest = source.components.find((component) => component.file === 'launcher.test.ts')!
    assert.ok(
      snapshot.ancestry[lowerTest.id]?.length,
      'The test itself supports the contracted handler',
    )
    assert.ok(snapshot.unrooted.includes('handler.ts#unusedLaunch'))
    assert.ok(
      source.components
        .filter((component) => component.file === 'child.ts')
        .every((component) => snapshot.unrooted.includes(component.id)),
    )
    assert.equal(existsSync(resolve(project.root, 'executed')), false)
  } finally {
    project.dispose()
  }
})

test('lookalike APIs, shadowed runtime globals, computed paths, and launch overrides receive no entry ancestry', async () => {
  const project = fixture(
    `import { spawnSync as spawn, fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { spawnSync as fake } from './fake.ts'
const entry = fileURLToPath(new URL('./child.ts', import.meta.url))
const options = { shell: true }
const mutableURL = new URL('./child.ts', import.meta.url)
export function sample() { return { status: 'from-child' } }
export function lookalike() { return fake(process.execPath, [entry]) }
export function shadowedProcess(process: { execPath: string }) { return spawn(process.execPath, [entry]) }
export function shadowedURL(URL: typeof globalThis.URL) { return spawn(process.execPath, [fileURLToPath(new URL('./child.ts', import.meta.url))]) }
export function shell() { return spawn(process.execPath, [entry], { shell: true }) }
export function runtime() { return fork(new URL('./child.ts', import.meta.url), [], { execPath: '/elsewhere' }) }
export function computed() { return spawn(process.execPath, [['.', 'child.ts'].join('/')]) }
export function unknownOptions() { return spawn(process.execPath, [entry], options) }
export function spreadOptions() { return spawn(process.execPath, [entry], { ...options }) }
export function urlAlias() { return fork(mutableURL) }
`,
    {
      'fake.ts':
        'export function spawnSync(command: string, args: string[]) { return { command, args } }\n',
    },
  )
  try {
    const { source, snapshot } = await both(project)
    assert.deepEqual(entries(source), [])
    assert.ok(snapshot.unrooted.includes('child.ts#answer'))
    assert.equal(existsSync(resolve(project.root, 'executed')), false)
  } finally {
    project.dispose()
  }
})

test('a statically selected missing or unmaintained local entry blocks analysis without running handlers', async () => {
  for (const missing of [false, true]) {
    const project = fixture()
    try {
      project.config.maintained = project.config.maintained.filter((file) => file !== 'child.ts')
      project.save()
      if (missing) rmSync(resolve(project.root, 'child.ts'))
      const { source } = await both(project)
      assert.ok(
        source.problems.some(
          (problem) => /entry|subprocess/i.test(problem) && problem.includes('child.ts'),
        ),
        source.problems.join('\n'),
      )
      assert.deepEqual(entries(source), [])
      assert.equal(existsSync(resolve(project.root, 'executed')), false)
    } finally {
      project.dispose()
    }
  }
})
