import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { canonicalSource } from '../native/tools/client.ts'
import { materializeFixture } from '../native/tools/fixtures.ts'
import { buildSnapshot } from '../src/retention.ts'
import { evaluate } from '../src/policy.ts'
import { snapshot } from '../src/project.ts'
import { runEvidence } from '../src/evidence.ts'
import { analyzeSource } from './reference.ts'
import type { Config, Source } from '../src/model.ts'
import { cliEnvironment, runCli } from './cli.ts'

const feature = `Feature: Native semantics
Scenario: Handle
 When I invoke "handle" with {}
 Then response "status" equals "ok"
`

function fixture(sources: Record<string, string>, maintained?: string[]) {
  const project = materializeFixture({
    name: 'tsrs-semantics',
    bindings: 'bindings.ts',
    feature,
    files: {
      'package.json': '{"type":"module"}\n',
      'behavior.feature': feature,
      'bindings.ts':
        "import { handle } from './handler.ts'\nexport const actions = { handle: handle }\n",
      ...sources,
    },
    inventory: maintained,
  })
  const config: Config = {
    maintained: project.files,
    bindings: 'bindings.ts',
    policy: {
      bootstrap: 100000,
      bootstrapSurface: 1,
      perDoubling: 0,
      hardLimit: 100000,
      maxFeedbackMs: 15000,
    },
  }
  return { ...project, config }
}

async function compare(project: ReturnType<typeof fixture>) {
  const reference = analyzeSource(project.root, project.files, 'bindings.ts')
  const native = await snapshot(project.root, project.config, false)
  assert.equal(native.analysis?.engine, 'rust')
  assert.equal(native.evidence, undefined, 'Source comparison must not manufacture evidence')
  assert.deepEqual(canonicalSource(native.source), canonicalSource(reference))
  const expected = buildSnapshot(native.fingerprint, native.contracts, reference)
  assert.deepEqual(native.ancestry, expected.ancestry)
  assert.deepEqual(native.unrooted, expected.unrooted)
  return native
}

function cli(
  project: ReturnType<typeof fixture>,
  engine: 'rust' | undefined,
  env: NodeJS.ProcessEnv = {},
) {
  writeFileSync(join(project.root, 'bonsai.json'), JSON.stringify(project.config))
  const result = runCli(
    ['check', '--root', project.root, ...(engine ? ['--engine', engine] : []), '--json'],
    {
      cwd: project.root,
      env: cliEnvironment({
        BONSAI_NATIVE_BINARY: undefined,
        FORCE_COLOR: process.env.FORCE_COLOR,
        ...env,
      }),
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
    },
  )
  assert.equal(result.error, undefined, String(result.error))
  return { ...result, report: result.stdout ? JSON.parse(result.stdout) : undefined }
}

function referenceInDirectory(project: ReturnType<typeof fixture>): Source {
  const result = spawnSync(
    process.execPath,
    [
      '--eval',
      `import { analyzeSource } from ${JSON.stringify(new URL('./reference.ts', import.meta.url).href)}; process.stdout.write(JSON.stringify(analyzeSource(${JSON.stringify(project.root)}, ${JSON.stringify(project.files)}, 'bindings.ts')))`,
    ],
    { cwd: project.root, encoding: 'utf8', timeout: 30000 },
  )
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

test('native semantics preserve interpolation, regular expressions, and Unicode source facts', {
  timeout: 60000,
}, async () => {
  const project = fixture({
    'handler.ts': [
      '// 🌳 café λ 中文 é',
      'const route = /https?:\\/\\/[^/]+\\/orders/u',
      "const suffix = 'héllo 🌳'",
      'export function handle() {',
      '  const label = `🌳 ${suffix} ${route.test("https://example.test/orders")}`',
      "  return { status: label.length > 0 ? 'ok' : 'empty' }",
      '}',
      '',
    ].join('\r\n'),
  })
  try {
    const native = await compare(project)
    assert.deepEqual(native.source.problems, [])
    assert.ok(native.ancestry['handler.ts#route']?.length)
    assert.ok(native.ancestry['handler.ts#suffix']?.length)
  } finally {
    project.dispose()
  }
})

test('native semantics trace literal dynamic selections without retaining unused siblings', {
  timeout: 60000,
}, async () => {
  for (const selection of [
    "const { format } = await import('./format.ts'); return format()",
    "const { format: render } = await import('./format.ts'); return render()",
    "const module = await import('./format.ts'); return module.format()",
    "const module = await import('./format.ts'); return module['format']()",
  ]) {
    const project = fixture({
      'handler.ts': `export async function handle() { ${selection} }\n`,
      'format.ts':
        "export function format() { return { status: 'ok' } }\nexport function unused() { return 42 }\n",
    })
    try {
      const native = await compare(project)
      assert.deepEqual(native.source.problems, [])
      assert.ok(native.ancestry['format.ts#format']?.length)
      assert.ok(native.unrooted.includes('format.ts#unused'))
    } finally {
      project.dispose()
    }
  }
})

test('repeated native imports preserve selected exports and ordinary property references', async () => {
  const project = fixture({
    'handler.ts': `const options = { status: 'ok', module: './format.ts', selected: 'unused' }
export async function handle() {
  const direct = await import('./format.ts')
  const quoted = await import('./format.ts')
  const { alternate: render } = await import('./format.ts')
  const results = [direct.format(), quoted['format'](), render()]
  return { status: results.every(result => result.status === options.status) ? 'ok' : 'unexpected' }
}
`,
    'format.ts': `export function format() { return { status: 'ok' } }
export function alternate() { return { status: 'ok' } }
export function unused() { return 42 }
`,
  })
  try {
    const native = await compare(project)
    assert.deepEqual(native.source.problems, [])
    assert.equal(native.source.actions.handle, 'handler.ts#handle')
    for (const selected of ['handler.ts#options', 'format.ts#format', 'format.ts#alternate'])
      assert.ok(native.ancestry[selected]?.length, `Missing selected dependency: ${selected}`)
    assert.ok(native.unrooted.includes('format.ts#unused'))
  } finally {
    project.dispose()
  }
})

test('native semantics keep computed namespace selections incomplete', async () => {
  const project = fixture({
    'handler.ts':
      "export async function handle(input: { name: 'format' | 'unused' }) { const module = await import('./format.ts'); return module[input.name]() }\n",
    'format.ts':
      "export function format() { return { status: 'ok' } }\nexport function unused() { return 42 }\n",
  })
  try {
    const native = await compare(project)
    assert.ok(
      native.source.problems.some((problem) =>
        problem.startsWith('Unsupported dynamic import selection:'),
      ),
    )
    assert.ok(native.unrooted.includes('format.ts#unused'))
  } finally {
    project.dispose()
  }
})

test('native semantics retain measured JSON and detect unmaintained JSON imports', {
  timeout: 60000,
}, async () => {
  for (const handler of [
    "import manifest from './package.json' with { type: 'json' }\nexport function handle() { return { status: manifest.status } }\n",
    "export async function handle() { const manifest = await import('./package.json', { with: { type: 'json' } }); return { status: manifest.default.status } }\n",
  ]) {
    const project = fixture({
      'package.json': '{"type":"module","status":"ok"}\n',
      'handler.ts': handler,
    })
    try {
      const native = await compare(project)
      assert.deepEqual(native.source.problems, [])
      assert.ok(native.source.files.some((file) => file.file === 'package.json' && file.tokens > 0))
      project.files = project.files.filter((file) => file !== 'package.json')
      project.config.maintained = project.files
      const unmaintained = await compare(project)
      assert.ok(
        unmaintained.source.problems.includes(
          'Local dependency outside maintained inventory: package.json',
        ),
      )
    } finally {
      project.dispose()
    }
  }
})

test('native diagnostics include unused type errors and missing imports', {
  timeout: 60000,
}, async () => {
  for (const [extra, expected] of [
    ["export function unused() { const wrong: number = 'text'; return wrong }\n", /not assignable/],
    ["import { missing } from './missing.ts'\n", /Cannot find module/],
    ['const duplicate = 1\nconst duplicate = 2\n', /Cannot redeclare block-scoped variable/],
  ] as const) {
    const project = fixture({
      'handler.ts': `${extra}export function handle() { return { status: 'ok' } }\n`,
    })
    try {
      const native = await compare(project)
      assert.match(native.source.problems.join('\n'), expected)
      assert.equal(evaluate(undefined, native, project.config.policy).status, 'incomplete')
    } finally {
      project.dispose()
    }
  }
})

test('native syntax errors block verification even when no compatible lexical graph exists', async () => {
  const project = fixture({
    'handler.ts':
      "export function unfinished(\nexport function handle() { return { status: 'ok' } }\n",
  })
  try {
    const native = await snapshot(project.root, project.config, true)
    assert.ok(native.source.problems.some((problem) => /handler\.ts:\d+:.*expected/.test(problem)))
    assert.equal(evaluate(undefined, native, project.config.policy).status, 'incomplete')
    assert.equal(native.evidence, undefined)
  } finally {
    project.dispose()
  }
})

test('native checks block unsupported default-library directives before verification', {
  timeout: 60000,
}, () => {
  for (const imported of [false, true]) {
    const project = fixture(
      imported
        ? {
            'handler.ts':
              "import { value } from 'library'\nexport function handle() { return { status: 'ok', value } }\n",
          }
        : {
            'handler.ts': "export function handle() { return { status: 'ok' } }\n",
            'globals.d.ts': '/// <reference no-default-lib="true" />\n',
          },
    )
    const isolated = mkdtempSync(join(tmpdir(), 'bonsai-native-globals-'))
    cpSync(project.root, isolated, { recursive: true })
    if (imported) {
      const library = join(isolated, 'node_modules/library')
      mkdirSync(library, { recursive: true })
      writeFileSync(
        join(library, 'package.json'),
        '{"type":"module","types":"index.d.ts","main":"index.js"}',
      )
      writeFileSync(
        join(library, 'index.d.ts'),
        '/// <reference no-default-lib="true" />\nexport declare const value: number\n',
      )
      writeFileSync(join(library, 'index.js'), 'export const value = 42\n')
    }
    try {
      // Launch outside the checkout so its Node typings cannot restore the libraries.
      const candidate = { ...project, root: isolated }
      const reference = referenceInDirectory(candidate)
      const native = cli(candidate, 'rust')
      assert.match(reference.problems.join('\n'), /Cannot find global type/)
      assert.equal(native.status, 2, native.stderr || native.stdout)
      const file = imported ? join('node_modules', 'library', 'index.d.ts') : 'globals.d.ts'
      assert.deepEqual(native.report.snapshot.source.problems, [
        `Rust checker unsupported: ${file} disables default libraries with no-default-lib; tsrs does not preserve this directive's diagnostics`,
      ])
      assert.deepEqual(
        canonicalSource({ ...native.report.snapshot.source, problems: [] }),
        canonicalSource({ ...reference, problems: [] }),
      )
      assert.equal(native.report.snapshot.evidence, undefined)
    } finally {
      rmSync(isolated, { recursive: true, force: true })
      project.dispose()
    }
  }
})

test('native checks preserve real evidence and reject invalid behavior, ancestry, and budget', {
  timeout: 60000,
}, async () => {
  for (const mode of ['pass', 'behavior', 'ancestry', 'budget', 'diagnostic', 'dynamic'] as const) {
    const project = fixture({
      'handler.ts': "export function handle() { return { status: 'ok' } }\n",
    })
    const marker = join(project.root, 'handler-executed')
    const declaration =
      mode === 'diagnostic'
        ? "export function unused() { const wrong: number = 'text'; return wrong }\n"
        : mode === 'ancestry'
          ? 'export function unused() { return 42 }\n'
          : ''
    writeFileSync(
      join(project.root, 'handler.ts'),
      `import { writeFileSync } from 'node:fs'\n${declaration}export async function handle() {\n${mode === 'dynamic' ? " const target = './format.ts'; await import(target)\n" : ''} writeFileSync(${JSON.stringify(marker)}, 'executed')\n return { status: '${mode === 'behavior' ? 'broken' : 'ok'}' }\n}\n`,
    )
    if (mode === 'dynamic') {
      writeFileSync(join(project.root, 'format.ts'), 'export const value = 1\n')
      project.config.maintained.push('format.ts')
    }
    if (mode === 'budget') {
      project.config.policy.bootstrap = 1
      project.config.policy.hardLimit = 1
    }
    try {
      const native = await snapshot(project.root, project.config)
      const reference = buildSnapshot(
        native.fingerprint,
        native.contracts,
        analyzeSource(project.root, project.files, project.config.bindings),
      )
      if (!reference.source.problems.length && !reference.contracts.problems.length)
        reference.evidence = await runEvidence(
          project.root,
          project.config,
          reference.contracts,
          reference.fingerprint,
          project.config.policy.maxFeedbackMs,
        )
      rmSync(marker, { force: true })
      const repeated = await snapshot(project.root, project.config, true)
      assert.deepEqual(canonicalSource(native.source), canonicalSource(reference.source))
      const expected = evaluate(undefined, reference, project.config.policy)
      const actual = evaluate(undefined, repeated, project.config.policy)
      assert.deepEqual(actual, expected)
      assert.equal(
        actual.status,
        mode === 'pass'
          ? 'pass'
          : mode === 'diagnostic' || mode === 'dynamic'
            ? 'incomplete'
            : 'reject',
      )
      if (mode === 'diagnostic' || mode === 'dynamic') {
        assert.equal(native.evidence, undefined)
        assert.equal(existsSync(marker), false, 'Incomplete analysis must not execute handlers')
      } else {
        assert.equal(existsSync(marker), true)
        assert.equal(native.evidence?.complete, true)
        assert.deepEqual(
          { ...native.evidence, elapsedMs: 0 },
          { ...reference.evidence, elapsedMs: 0 },
        )
      }
    } finally {
      project.dispose()
    }
  }
})

test('native CLI completes when every JavaScript compiler entry point is trapped', {
  timeout: 60000,
}, () => {
  const project = fixture({
    'handler.ts': "export function handle() { return { status: 'ok' } }\n",
  })
  const guard = join(project.root, 'compiler-guard.mjs')
  writeFileSync(
    guard,
    `import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const file = require.resolve('typescript')
const compiler = require(file)
const forbidden = new Set(['createProgram', 'getPreEmitDiagnostics', 'createIncrementalProgram', 'createSemanticDiagnosticsBuilderProgram', 'createEmitAndSemanticDiagnosticsBuilderProgram', 'createLanguageService', 'createWatchProgram', 'createSolutionBuilder'])
require.cache[file].exports = new Proxy(compiler, {
  get(target, key, receiver) {
    if (forbidden.has(key)) return () => { throw new Error('REFERENCE_COMPILER_FORBIDDEN:' + String(key)) }
    return Reflect.get(target, key, receiver)
  },
})
`,
  )
  const env = { BUN_OPTIONS: `--preload ${pathToFileURL(guard).href}` }
  try {
    const control = spawnSync(
      process.execPath,
      ['--eval', "import ts from 'typescript'; ts.createProgram([], { noEmit: true })"],
      { cwd: resolve('.'), env: { ...process.env, ...env }, encoding: 'utf8' },
    )
    assert.notEqual(control.status, 0)
    assert.match(control.stderr, /REFERENCE_COMPILER_FORBIDDEN:createProgram/)
    const native = cli(project, 'rust', env)
    assert.equal(native.status, 0, native.stderr || native.stdout)
    assert.equal(native.report.decision.status, 'pass')
    assert.equal(native.report.snapshot.evidence.complete, true)
    assert.ok(
      native.report.snapshot.evidence.checks.every(
        (check: { status: string }) => check.status === 'passed',
      ),
    )
  } finally {
    project.dispose()
  }
})

test('native CLI discovers ambient packages and refreshes changed declarations', {
  timeout: 60000,
}, () => {
  const project = fixture({
    'handler.ts':
      "export function handle(input: BonsaiAmbient) { const value: string = input; return { status: 'ok' } }\n",
  })
  const declarations = join(project.root, 'node_modules/@types/bonsai-fixture')
  mkdirSync(declarations, { recursive: true })
  const declaration = join(declarations, 'index.d.ts')
  writeFileSync(declaration, 'declare type BonsaiAmbient = string\n')
  try {
    for (const content of [
      'declare type BonsaiAmbient = string\n',
      'declare type BonsaiAmbient = number\n',
      undefined,
    ]) {
      if (content === undefined) rmSync(declarations, { recursive: true })
      else writeFileSync(declaration, content)
      const reference = referenceInDirectory(project)
      const native = cli(project, 'rust')
      assert.deepEqual(canonicalSource(native.report.snapshot.source), canonicalSource(reference))
      if (content?.includes('string')) {
        assert.equal(native.status, 0)
        assert.equal(native.report.snapshot.evidence.complete, true)
      } else {
        assert.equal(native.status, 2)
        assert.equal(native.report.snapshot.evidence, undefined)
        assert.match(
          native.report.snapshot.source.problems.join('\n'),
          content ? /not assignable/ : /Cannot find name/,
        )
      }
    }
  } finally {
    project.dispose()
  }
})

test('native worker protocol corruption blocks acceptance before handlers execute', {
  timeout: 60000,
}, () => {
  const project = fixture({
    'handler.ts': "export function handle() { return { status: 'ok' } }\n",
  })
  const marker = join(project.root, 'handler-executed')
  writeFileSync(
    join(project.root, 'handler.ts'),
    `import { writeFileSync } from 'node:fs'\nexport function handle() { writeFileSync(${JSON.stringify(marker)}, 'executed'); return { status: 'ok' } }\n`,
  )
  const preload = join(project.root, 'corrupt-native-response.mjs')
  writeFileSync(
    preload,
    `if (process.argv[1]?.endsWith('tsrs-worker.ts')) {
  const write = process.stdout.write.bind(process.stdout)
  const mutations = {
    protocol(value) { value.protocol = 1 },
    categories(value) { value.diagnosticCategories.pop() },
    version(value) { value.version = 'unknown-checker-version' },
    inventory(value) { value.source.files.pop() },
    tokens(value) { value.source.files[0].tokens = -1 },
    missingGraph(value) { value.source.components = []; value.source.relationships = []; value.source.registry = 'missing'; value.source.actions = { handle: 'missing' } },
    action(value) { value.source.actions.handle = 'missing' },
    registry(value) { delete value.source.registry },
    duplicates(value) { value.source.components.push({ ...value.source.components[0] }) },
    registryKind(value) { value.source.components.find((component) => component.id === value.source.registry).kind = 'production' },
    edge(value) { value.source.relationships[0].to = 'missing' },
    provenance(value) { value.source.relationships[0].sourceRef.file = 'handler.ts' },
    binding(value) { value.source.bindingImports = [{ from: value.source.registry, file: 'bindings.ts', line: 2, adapter: 'project-bindings-v1', bindings: 'other.ts' }] },
    blockedDuplicate(value) { value.source.components.push({ ...value.source.components[0] }); value.source.problems.push('Unsupported fixture graph') },
  }
  process.stdout.write = (chunk, ...args) => {
    const value = JSON.parse(String(chunk))
    if (value.protocol === 2 && value.source) {
      const mutate = mutations[process.env.BONSAI_TEST_NATIVE_CORRUPTION]
      if (mutate) mutate(value)
    }
    return write(JSON.stringify(value) + '\\n', ...args)
  }
}
`,
  )
  const env = { BUN_OPTIONS: `--preload ${pathToFileURL(preload).href}` }
  try {
    const control = cli(project, 'rust', env)
    assert.equal(control.status, 0, control.stderr || control.stdout)
    assert.equal(existsSync(marker), true)
    for (const mode of [
      'protocol',
      'categories',
      'version',
      'inventory',
      'tokens',
      'missingGraph',
      'action',
      'registry',
      'duplicates',
      'registryKind',
      'edge',
      'provenance',
      'binding',
    ]) {
      rmSync(marker, { force: true })
      const malformed = cli(project, 'rust', { ...env, BONSAI_TEST_NATIVE_CORRUPTION: mode })
      assert.equal(malformed.status, 1, `${mode}: ${malformed.stderr || malformed.stdout}`)
      assert.equal(malformed.stdout, '', `${mode} cannot emit an admissible report`)
      assert.equal(JSON.parse(malformed.stderr).code, 'RUST_COLLECTOR')
      assert.equal(existsSync(marker), false, `${mode} must stop before handler execution`)
    }
    const provisional = cli(project, 'rust', {
      ...env,
      BONSAI_TEST_NATIVE_CORRUPTION: 'blockedDuplicate',
    })
    assert.equal(provisional.status, 2, provisional.stderr || provisional.stdout)
    assert.equal(provisional.report.decision.status, 'incomplete')
    assert.ok(provisional.report.snapshot.source.problems.includes('Unsupported fixture graph'))
    assert.equal(provisional.report.snapshot.evidence, undefined)
    assert.equal(existsSync(marker), false)
  } finally {
    project.dispose()
  }
})

test('native binding-loader provenance follows exact archived implementations', {
  timeout: 60000,
}, async () => {
  const project = fixture({
    'handler.ts': "export function handle() { return { status: 'ok' } }\n",
  })
  try {
    cpSync(resolve('src'), join(project.root, 'src'), { recursive: true })
    cpSync(resolve('package.json'), join(project.root, 'package.json'))
    cpSync(resolve('bonsai.bindings.ts'), join(project.root, 'bonsai.bindings.ts'))
    const { inventory } = await import('../src/inventory.ts')
    project.files = inventory(project.root, ['src', 'package.json', 'bonsai.bindings.ts'])
    project.config.maintained = project.files
    project.config.bindings = 'bonsai.bindings.ts'
    const reference = analyzeSource(project.root, project.files, project.config.bindings)
    const native = await snapshot(project.root, project.config, false)
    assert.deepEqual(canonicalSource(native.source), canonicalSource(reference))
    assert.equal(native.source.bindingImports?.length, 1)
    const target = join(project.root, 'src/binding-target.ts')
    writeFileSync(target, readFileSync(target, 'utf8').replace('Object.freeze', 'Object.seal'))
    const modified = await snapshot(project.root, project.config, false)
    assert.equal(modified.source.bindingImports, undefined)
    assert.ok(
      modified.source.problems.some((problem) =>
        /^Dynamic import requires an adapter: src\/evidence\.ts#collectEvidence/.test(problem),
      ),
    )
  } finally {
    project.dispose()
  }
})
