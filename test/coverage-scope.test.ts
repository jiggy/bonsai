import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { compileContracts } from '../src/contracts.ts'
import { collectRustSource } from '../src/collector.ts'
import { evaluate } from '../src/policy.ts'
import { buildSnapshot } from '../src/retention.ts'
import {
  runSupportingVerification,
  runnerViolations,
  validRunnerEvidence,
  validateRunnerRequirements,
} from '../src/runners.ts'
import type { RunnerEvidence, RunnerRequirement } from '../src/runners.ts'
import type { Source } from '../src/model.ts'
import { runtimeCoverageScope } from '../src/runtime-scope.ts'
import ts from 'typescript'
import { assumedIdentity } from './identity-fixture.ts'
import { createProject } from './project.ts'
import { runCli } from './cli.ts'
import { analyzeSource } from './reference.ts'

const metrics = ['lines', 'branches', 'functions', 'statements'] as const
function coverage(total = 1, covered = total) {
  return Object.fromEntries(
    metrics.map((metric) => [metric, { total, covered, skipped: 0 }]),
  ) as NonNullable<RunnerEvidence['coverage']>
}
const requirement: RunnerRequirement = {
  id: 'unit',
  adapter: 'vitest-json',
  command: ['unused'],
  report: '.bonsai/tests.json',
  coverage: { report: '.bonsai/coverage.json', lines: 80, scope: 'maintained-production' },
}
function source(): Source {
  return {
    files: [
      { file: 'app.ts', tokens: 0, executable: true, kind: 'production' },
      { file: 'rules.ts', tokens: 0, executable: true, kind: 'production' },
      { file: 'types.ts', tokens: 0, executable: false, kind: 'production' },
      { file: 'unit.test.ts', tokens: 0, executable: true, kind: 'test' },
      { file: 'bindings.ts', tokens: 0, executable: true, kind: 'binding' },
    ],
    components: [],
    relationships: [],
    actions: { ready: 'app.ts#ready' },
    problems: [],
  }
}
// Assumed facts isolate evaluator scope checks from process and native collector tests below.
function candidate() {
  const contracts = compileContracts([
    {
      file: 'ready.feature',
      text: 'Feature: Ready\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
    },
  ])
  const snapshot = buildSnapshot('candidate', contracts, source())
  snapshot.identity = assumedIdentity
  snapshot.evidence = {
    schema: 'bonsai-evidence-v2',
    identity: assumedIdentity,
    fingerprint: 'candidate',
    profile: 'isolated-scenarios-v1',
    complete: true,
    elapsedMs: 1,
    checks: contracts.checks.map(({ id }) => ({ id, status: 'passed' })),
  }
  snapshot.runners = [structuredClone(requirement)]
  snapshot.runnerEvidence = [
    {
      schema: 'bonsai-runner-evidence-v1',
      identity: assumedIdentity,
      fingerprint: 'candidate',
      id: 'unit',
      adapter: 'vitest-json',
      complete: true,
      status: 'passed',
      elapsedMs: 1,
      exitCode: 0,
      reportHash: 'a'.repeat(64),
      coverageReportHash: 'b'.repeat(64),
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      problems: [],
      coverage: coverage(2),
      coverageFiles: ['app.ts', 'rules.ts'].map((file) => ({ file, counts: coverage() })),
    },
  ]
  return snapshot
}
const policy = {
  bootstrap: 1000,
  bootstrapSurface: 1,
  perDoubling: 0,
  hardLimit: 1000,
  maxFeedbackMs: 15000,
}

test('scoped coverage is recomputed against independent source classification, not a serialized pass', () => {
  assert.equal(evaluate(undefined, candidate(), policy).status, 'pass')
  for (const mutate of [
    (s: ReturnType<typeof candidate>) => {
      s.runnerEvidence![0]!.coverageFiles!.pop()
    },
    (s: ReturnType<typeof candidate>) => {
      delete s.source.files[1]!.executable
    },
    (s: ReturnType<typeof candidate>) => {
      delete s.source.files[1]!.kind
    },
    (s: ReturnType<typeof candidate>) => {
      delete s.runnerEvidence![0]!.coverageFiles
    },
    (s: ReturnType<typeof candidate>) => {
      s.runnerEvidence![0]!.coverageFiles![1]!.file = 'foreign.ts'
    },
    (s: ReturnType<typeof candidate>) => {
      s.runnerEvidence![0]!.coverage = coverage(200)
    },
  ]) {
    const s = candidate()
    mutate(s)
    assert.equal(evaluate(undefined, s, policy).status, 'incomplete')
  }
  const below = candidate()
  below.runnerEvidence![0]!.coverageFiles![1]!.counts = coverage(1, 0)
  below.runnerEvidence![0]!.coverage = coverage(2, 1)
  below.runnerEvidence![0]!.status = 'failed'
  assert.equal(evaluate(undefined, below, policy).status, 'reject')
  assert.equal(evaluate(undefined, below, policy).ceiling, 1000)
})

test('legacy coverage remains aggregate-only and scoped shapes reject malformed facts', () => {
  const s = candidate()
  delete s.runners![0]!.coverage!.scope
  delete s.runnerEvidence![0]!.coverageFiles
  for (const file of s.source.files) {
    delete file.executable
    delete file.kind
  }
  assert.equal(evaluate(undefined, s, policy).status, 'pass')
  assert.throws(() =>
    validateRunnerRequirements([
      {
        ...requirement,
        coverage: {
          ...requirement.coverage!,
          scope: 'report-selected',
        },
      },
    ]),
  )
  const evidence = candidate().runnerEvidence![0]!
  for (const files of [
    [{ file: '../app.ts', counts: coverage() }],
    [
      { file: 'app.ts', counts: coverage() },
      { file: 'app.ts', counts: coverage() },
    ],
    [{ file: 'app.ts', counts: coverage(-1) }],
  ])
    assert.equal(validRunnerEvidence({ ...evidence, coverageFiles: files }), false)
})

const report = {
  success: true,
  numTotalTests: 1,
  numPassedTests: 1,
  numFailedTests: 0,
  numPendingTests: 0,
  numTodoTests: 0,
  numTotalTestSuites: 1,
  numPassedTestSuites: 1,
  numFailedTestSuites: 0,
  numPendingTestSuites: 0,
  testResults: [
    {
      name: 'unit.test.ts',
      status: 'passed',
      assertionResults: [{ fullName: 'readiness', status: 'passed' }],
    },
  ],
}
test('fresh per-file reports cannot omit, alias, or inflate required production coverage', async () => {
  const fixture = createProject({
    'app.ts': 'export const ready = 1\n',
    'rules.ts': 'export const rule = 1\n',
    'types.ts': 'export type Ready = number\n',
    'unit.test.ts': 'export const test = 1\n',
    'bindings.ts': 'export const actions = {}\n',
  })
  try {
    mkdirSync(join(fixture.root, '.bonsai'))
    const execute = async (files: Record<string, unknown>) => {
      const item: RunnerRequirement = {
        ...requirement,
        command: [
          process.execPath,
          '-e',
          "const fs=require('node:fs');fs.writeFileSync('.bonsai/tests.json'," +
            JSON.stringify(JSON.stringify(report)) +
            ");fs.writeFileSync('.bonsai/coverage.json'," +
            JSON.stringify(JSON.stringify({ total: coverage(10000), ...files })) +
            ')',
        ],
      }
      return (
        await runSupportingVerification(
          fixture.root,
          [item],
          'candidate',
          10000,
          undefined,
          source(),
        )
      )[0]!
    }
    const complete = await execute({ 'app.ts': coverage(), 'rules.ts': coverage() })
    assert.equal(complete.status, 'passed', JSON.stringify(complete))
    assert.deepEqual(complete.coverage, coverage(2))
    const omitted = await execute({ 'app.ts': coverage() })
    assert.equal(omitted.status, 'incomplete')
    assert.match(omitted.problems.join('\n'), /omits required production file: rules.ts/)
    const inflated = await execute({
      'app.ts': coverage(2, 1),
      'rules.ts': coverage(2, 0),
      'unit.test.ts': coverage(10000),
    })
    assert.equal(inflated.status, 'failed')
    assert.deepEqual(inflated.coverage, coverage(4, 1))
    const aliased = await execute({
      'app.ts': coverage(),
      [join(fixture.root, 'app.ts')]: coverage(),
      'rules.ts': coverage(),
    })
    assert.equal(aliased.status, 'incomplete')
    assert.match(aliased.problems.join('\n'), /repeats a file through an alias/)
    const missing = await execute({
      'app.ts': coverage(),
      'rules.ts': coverage(),
      'missing.ts': coverage(),
    })
    assert.equal(missing.status, 'incomplete')
    const mapped = await execute({
      'app.ts': coverage(),
      'rules.ts': coverage(),
      'file:///foreign.ts': coverage(),
    })
    assert.equal(mapped.status, 'incomplete')
    const zero = await execute({ 'app.ts': coverage(), 'rules.ts': coverage(0) })
    assert.equal(zero.status, 'passed', 'a zero-statement file is not automatically missing')
  } finally {
    fixture.dispose()
  }
})

test('native and reference classify runtime production separately from erased types and supporting code', async () => {
  const fixtureSources: Record<string, string> = {
    'app.ts': 'export function ready() { return 1 }\n',
    'types.ts': 'export interface Ready { value: number }\nexport type Status = string\n',
    'namespace-types.ts': 'export namespace Types { export type Status = string }\n',
    'namespace-nested-types.ts':
      'export namespace Outer { export namespace Types { export interface Ready { value: number } } }\n',
    'namespace-dotted-types.ts': 'export namespace Outer.Types { export type Status = string }\n',
    'local-interface-export.ts': 'interface Status { ready: boolean }; export { Status }\n',
    'local-type-export.ts': 'type Status = string; export { Status as State }\n',
    'classes.ts': 'export default class Default {}\nexport class Named {}\n',
    'local-default-type-export.ts': "import type Default from './classes.ts'; export { Default }\n",
    'local-named-type-export.ts':
      "import type { Named as Ready } from './classes.ts'; export { Ready as Status }\n",
    'local-inline-type-export.ts':
      "import { type Named as Ready } from './classes.ts'; export { Ready }\n",
    'local-namespace-type-export.ts':
      "import type * as Types from './classes.ts'; export { Types }\n",
    'local-value-export.ts': 'const ready = 1; export { ready as status }\n',
    'local-declared-value-export.ts': 'declare const ready: number; export { ready }\n',
    'namespace-ambient-const.ts': 'export namespace N { export declare const x: number }\n',
    'namespace-ambient-function.ts': 'export namespace N { export declare function x(): number }\n',
    'namespace-ambient-class.ts': 'export namespace N { export declare class X {} }\n',
    'namespace-values.ts': 'export namespace Values { export const ready = 1 }\n',
    'namespace-nested-values.ts':
      'export namespace Outer { export namespace Values { export const ready = 1 } }\n',
    'namespace-dotted-values.ts': 'export namespace Outer.Values { export const ready = 1 }\n',
    'ambient.d.ts': 'declare const externallyDeclaredCoverageScopeValue: number\n',
    'declared.ts': 'export declare function declared(): number\n',
    'imports.ts':
      "import type { Ready } from './types.ts'\nexport type { Status } from './types.ts'\n",
    'side-effect.ts': "import './app.ts'\n",
    'empty-import.ts': "import {} from './app.ts'\n",
    'empty-export.ts': "export {} from './app.ts'\n",
    'empty-type-import.ts': "import type {} from './types.ts'\n",
    'empty-type-export.ts': "export type {} from './types.ts'\n",
    'unused-import.ts': "import { Named } from './classes.ts'\n",
    'type-position-import.ts': "import { Named } from './classes.ts'; type Shape = Named\n",
    'module-only.ts': 'export {}\n',
    'named-types.ts':
      "import { type Ready } from './types.ts'\nexport { type Status } from './types.ts'\n",
    'unit.test.ts': "import { ready } from './app.ts'\nexport const result = ready()\n",
    'bindings.ts': "import { ready } from './app.ts'\nexport const actions = { ready: ready }\n",
  }
  const fixture = createProject(fixtureSources)
  try {
    const native = (await collectRustSource(fixture.root, fixture.files, 'bindings.ts')).source
    const reference = analyzeSource(fixture.root, fixture.files, 'bindings.ts')
    assert.deepEqual(native.problems, [])
    assert.deepEqual(reference.problems, [])
    assert.deepEqual(native.files, reference.files)
    const erasedForms = [
      'namespace-types.ts',
      'namespace-nested-types.ts',
      'local-interface-export.ts',
      'local-type-export.ts',
      'local-default-type-export.ts',
      'local-named-type-export.ts',
      'local-inline-type-export.ts',
      'local-namespace-type-export.ts',
      'unused-import.ts',
      'type-position-import.ts',
      'local-declared-value-export.ts',
    ]
    const runtimeForms = [
      'namespace-dotted-types.ts',
      'namespace-ambient-const.ts',
      'namespace-ambient-function.ts',
      'namespace-ambient-class.ts',
      'namespace-values.ts',
      'namespace-nested-values.ts',
      'namespace-dotted-values.ts',
      'local-value-export.ts',
    ]
    const transpiledFiles = [...erasedForms, ...runtimeForms]
    const transpiled = spawnSync(
      process.execPath,
      [
        '-e',
        'const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", macro: {}, trimUnusedImports: true });' +
          'process.stdout.write(JSON.stringify(' +
          JSON.stringify(transpiledFiles.map((file) => fixtureSources[file])) +
          '.map(source => transpiler.transformSync(source))))',
      ],
      { encoding: 'utf8' },
    )
    assert.equal(transpiled.status, 0, transpiled.stderr)
    const emitted = JSON.parse(transpiled.stdout) as string[]
    for (const [index, text] of emitted.entries()) {
      const file = transpiledFiles[index]!
      assert.equal(
        text.replace(/export\s*\{\s*\}\s*;?/g, '').trim().length > 0,
        runtimeForms.includes(file),
        file,
      )
    }
    for (const file of [
      'types.ts',
      ...erasedForms,
      'ambient.d.ts',
      'declared.ts',
      'imports.ts',
      'named-types.ts',
      'empty-type-import.ts',
      'empty-type-export.ts',
      'module-only.ts',
    ])
      assert.equal(native.files.find((entry) => entry.file === file)!.executable, false, file)
    const requiredFiles = [
      'app.ts',
      'side-effect.ts',
      'empty-import.ts',
      'empty-export.ts',
      'classes.ts',
      ...runtimeForms,
    ]
    for (const file of requiredFiles)
      assert.equal(native.files.find((entry) => entry.file === file)!.executable, true, file)
    const evidence = candidate().runnerEvidence![0]!
    evidence.coverageFiles = requiredFiles.map((file) => ({ file, counts: coverage() }))
    evidence.coverage = coverage(requiredFiles.length)
    assert.deepEqual(runnerViolations(requirement, evidence, native), {
      status: 'passed',
      problems: [],
    })
    // Every emitted namespace form must remain a required per-file obligation.
    for (const missing of runtimeForms) {
      const omitted = {
        ...evidence,
        coverageFiles: evidence.coverageFiles!.filter((file) => file.file !== missing),
        coverage: coverage(requiredFiles.length - 1),
      }
      const result = runnerViolations(requirement, omitted, native)
      assert.equal(result.status, 'incomplete', missing)
      assert.ok(
        result.problems.some((problem) =>
          problem.endsWith('omits required production file: ' + missing),
        ),
        missing,
      )
    }
    evidence.coverageFiles = evidence.coverageFiles.filter(
      (file) => file.file !== 'local-value-export.ts',
    )
    evidence.coverage = coverage(requiredFiles.length - 1)
    const omittedValue = runnerViolations(requirement, evidence, native)
    assert.equal(omittedValue.status, 'incomplete')
    assert.match(
      omittedValue.problems.join('\n'),
      /omits required production file: local-value-export.ts/,
    )
    assert.equal(native.files.find((entry) => entry.file === 'unit.test.ts')!.kind, 'test')
    assert.equal(native.files.find((entry) => entry.file === 'bindings.ts')!.kind, 'binding')
    assert.ok(native.files.every((entry) => Number.isSafeInteger(entry.tokens)))
  } finally {
    fixture.dispose()
  }
})

test('unsupported Bun contexts leave scoped coverage incomplete instead of inventing false facts', () => {
  for (const config of [
    { extends: './base.json' },
    { compilerOptions: { verbatimModuleSyntax: true } },
    { compilerOptions: { preserveValueImports: true } },
    { compilerOptions: { importsNotUsedAsValues: 'preserve' } },
    { compilerOptions: { experimentalDecorators: true } },
    { compilerOptions: { emitDecoratorMetadata: true } },
  ]) {
    const fixture = createProject({
      'app.ts': 'export const ready = 1\n',
      'tsconfig.json': JSON.stringify(config),
    })
    try {
      const ast = ts.createSourceFile(
        join(fixture.root, 'app.ts'),
        'export const ready = 1',
        ts.ScriptTarget.Latest,
        true,
      )
      const measured = source()
      measured.files[0]!.executable = runtimeCoverageScope(fixture.root, fixture.files)(ast)
      assert.equal(measured.files[0]!.executable, undefined, JSON.stringify(config))
      const result = runnerViolations(requirement, candidate().runnerEvidence![0], measured)
      assert.equal(result.status, 'incomplete')
      assert.match(result.problems.join('\n'), /no executable classification: app.ts/)
      const legacy = structuredClone(requirement)
      delete legacy.coverage!.scope
      assert.equal(
        runnerViolations(legacy, candidate().runnerEvidence![0], measured).status,
        'passed',
      )
    } finally {
      fixture.dispose()
    }
  }
  const fixture = createProject({ 'app.ts': 'export const ready = 1\n' })
  try {
    const ast = ts.createSourceFile(
      join(fixture.root, 'app.ts'),
      'export const ready = 1',
      ts.ScriptTarget.Latest,
      true,
    )
    for (const argument of [
      '--tsconfig-override=other.json',
      '-r./preload.ts',
      '--define FLAG=true',
      '"--preload" "./preload.ts"',
    ]) {
      const original = process.env.BUN_OPTIONS
      try {
        process.env.BUN_OPTIONS = argument
        assert.equal(runtimeCoverageScope(fixture.root, fixture.files)(ast), undefined, argument)
      } finally {
        if (original === undefined) delete process.env.BUN_OPTIONS
        else process.env.BUN_OPTIONS = original
      }
    }
    const options = process.env.BUN_OPTIONS
    try {
      for (const argument of ['--conditions=react', '/tmp/example-random-path']) {
        process.env.BUN_OPTIONS = argument
        assert.equal(runtimeCoverageScope(fixture.root, fixture.files)(ast), true, argument)
      }
    } finally {
      if (options === undefined) delete process.env.BUN_OPTIONS
      else process.env.BUN_OPTIONS = options
    }
    const invalid = ts.createSourceFile(
      join(fixture.root, 'app.ts'),
      'export =',
      ts.ScriptTarget.Latest,
      true,
    )
    assert.equal(runtimeCoverageScope(fixture.root, fixture.files)(invalid), undefined)
    const deadBranch = ts.createSourceFile(
      join(fixture.root, 'app.ts'),
      'if (false) { console.log(1) }',
      ts.ScriptTarget.Latest,
      true,
    )
    assert.equal(runtimeCoverageScope(fixture.root, fixture.files)(deadBranch), true)
    for (const text of [
      "import macro = require('macro:./macro.ts')",
      "export { generate } from 'macro:./macro.ts'",
      "const result = import('macro:./macro.ts')",
      "const result = require('macro:./macro.ts')",
      "const result = import('./macro.ts', { with: { type: 'macro' } })",
    ]) {
      const ast = ts.createSourceFile(
        join(fixture.root, 'app.ts'),
        text,
        ts.ScriptTarget.Latest,
        true,
      )
      assert.equal(runtimeCoverageScope(fixture.root, fixture.files)(ast), undefined, text)
    }
    writeFileSync(join(fixture.root, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}')
    assert.equal(
      runtimeCoverageScope(fixture.root, fixture.files)(ast),
      undefined,
      'unmeasured config',
    )
    assert.equal(runtimeCoverageScope(fixture.root, [...fixture.files, 'tsconfig.json'])(ast), true)
    writeFileSync(join(fixture.root, 'bunfig.toml'), '')
    assert.equal(
      runtimeCoverageScope(fixture.root, [...fixture.files, 'tsconfig.json'])(ast),
      undefined,
    )
  } finally {
    fixture.dispose()
  }
})

test('macro classification and real explain never execute candidate macro modules', async () => {
  for (const keyword of ['with', 'assert']) {
    const macroSource =
      "import { generate } from './macro.ts' " +
      keyword +
      " { type: 'macro' }\nexport const result = generate()\n"
    const fixture = createProject({
      'package.json': '{"type":"module"}',
      'app.ts': macroSource,
      'macro.ts':
        "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('./macro-ran', import.meta.url), 'loaded')\nexport function generate() { return 1 }\n",
      'bindings.ts': 'export const actions = {}\n',
    })
    try {
      const marker = join(fixture.root, 'macro-ran')
      const control = spawnSync(
        process.execPath,
        [
          '-e',
          'new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(' +
            JSON.stringify(macroSource) +
            ')',
        ],
        { cwd: fixture.root, encoding: 'utf8' },
      )
      assert.equal(control.status, 0, control.stderr)
      assert.equal(existsSync(marker), true)
      rmSync(marker)
      const native = (await collectRustSource(fixture.root, fixture.files, 'bindings.ts')).source
      assert.equal(native.files.find((file) => file.file === 'app.ts')!.executable, undefined)
      assert.equal(existsSync(marker), false)
      const inspection = runCli(['explain', 'app.ts', '--root', fixture.root, '--json'])
      assert.ok(
        inspection.status === 0 || inspection.status === 2,
        inspection.stderr || inspection.stdout,
      )
      assert.equal(existsSync(marker), false)
    } finally {
      fixture.dispose()
    }
  }
})

test('runtime scope agrees with actual evidence-worker import elision and empty module loads', () => {
  for (const [clause, loaded] of [
    ["import { Shape } from './shape.ts'", false],
    ["import { type Shape } from './shape.ts'", false],
    ["import {} from './shape.ts'", true],
    ["export {} from './shape.ts'", true],
    ["import { Shape } from './shape.ts'; export { Shape as PublicShape }", true],
  ] as const) {
    const fixture = createProject({
      'package.json': '{"type":"module"}',
      'bindings.ts':
        "import './imports.ts'\nimport { ready } from './app.ts'\nexport const actions = { ready: ready }\n",
      'app.ts': "export function ready() { return { status: 'ok' } }\n",
      'imports.ts': clause + '\n',
      'shape.ts':
        "import { writeFileSync } from 'node:fs'\nexport class Shape {}\nwriteFileSync(new URL('./shape-loaded', import.meta.url), 'loaded')\n",
      'ready.feature':
        'Feature: Readiness\nScenario: Read the application\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
    })
    try {
      const result = runCli(['check', '--root', fixture.root, '--json'])
      const report = JSON.parse(result.stdout)
      assert.deepEqual(report.snapshot.source.problems, [], result.stderr)
      assert.equal(report.snapshot.evidence.complete, true, result.stdout)
      assert.ok(
        report.snapshot.evidence.checks.every(
          (check: { status: string }) => check.status === 'passed',
        ),
      )
      assert.equal(existsSync(join(fixture.root, 'shape-loaded')), loaded, clause)
      assert.equal(
        report.snapshot.source.files.find((file: { file: string }) => file.file === 'imports.ts')
          .executable,
        loaded,
        clause,
      )
    } finally {
      fixture.dispose()
    }
  }
})

test('certain runtime declarations skip emission while ambiguous and unsafe inputs retain their guards', () => {
  type Transpiler = { transformSync(text: string): string }
  const runtime = (
    globalThis as unknown as {
      Bun: { Transpiler: new (options: Record<string, unknown>) => Transpiler }
    }
  ).Bun
  const NativeTranspiler = runtime.Transpiler
  const descriptor = Object.getOwnPropertyDescriptor(runtime, 'Transpiler')
  const canWrap = descriptor
    ? descriptor.configurable || ('writable' in descriptor && descriptor.writable)
    : Object.isExtensible(runtime)
  const transformed: string[] = []
  const fixture = createProject({ 'app.ts': 'export function ready() { return 1 }\n' })
  const baseline = new NativeTranspiler({
    loader: 'ts',
    target: 'bun',
    macro: {},
    treeShaking: false,
    deadCodeElimination: false,
    trimUnusedImports: true,
  })
  try {
    if (canWrap)
      Object.defineProperty(runtime, 'Transpiler', {
        configurable: descriptor?.configurable ?? true,
        enumerable: descriptor?.enumerable ?? true,
        writable: true,
        value: class {
          inner: Transpiler
          constructor(options: Record<string, unknown>) {
            this.inner = new NativeTranspiler(options)
          }
          transformSync(text: string) {
            transformed.push(text)
            return this.inner.transformSync(text)
          }
        },
      })
    console.log(JSON.stringify({ runtimeScopeInstrumentation: !!canWrap }))
    const classify = runtimeCoverageScope(fixture.root, fixture.files)
    const cases: { text: string; expected: boolean | undefined; fast?: boolean }[] = [
      { text: 'export function ready() { return 1 }', expected: true, fast: true },
      { text: 'export default class Ready {}', expected: true, fast: true },
      { text: 'export const ready = 1', expected: true, fast: true },
      { text: 'export let ready: number', expected: true, fast: true },
      { text: 'ready()', expected: true, fast: true },
      { text: 'export namespace Types { export type Ready = string }', expected: false },
      { text: 'export declare function ready(): number', expected: false },
      { text: 'export declare class Ready {}', expected: false },
      { text: 'export declare const ready: number', expected: false },
      { text: 'export const ready =', expected: undefined },
      {
        text: "const ready = import('./macro.ts', { with: { type: 'macro' } })",
        expected: undefined,
      },
    ]
    for (const { text, expected, fast } of cases) {
      const ast = ts.createSourceFile(
        join(fixture.root, 'app.ts'),
        text,
        ts.ScriptTarget.Latest,
        true,
      )
      const before = transformed.length
      assert.equal(classify(ast), expected, text)
      if (canWrap)
        assert.equal(transformed.length - before, fast || expected === undefined ? 0 : 1, text)
      if (expected !== undefined) {
        // Observe the original Bun API independently of the counting wrapper.
        const emitted = ts.createSourceFile(
          'emitted.js',
          baseline.transformSync(text),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.JS,
        )
        assert.equal(
          emitted.statements.some(
            (statement) =>
              !ts.isEmptyStatement(statement) &&
              !(
                ts.isExportDeclaration(statement) &&
                !statement.moduleSpecifier &&
                statement.exportClause &&
                ts.isNamedExports(statement.exportClause) &&
                statement.exportClause.elements.length === 0
              ),
          ),
          expected,
          text,
        )
      }
    }
  } finally {
    if (canWrap) {
      if (descriptor) Object.defineProperty(runtime, 'Transpiler', descriptor)
      else Reflect.deleteProperty(runtime, 'Transpiler')
    }
    fixture.dispose()
  }
})
