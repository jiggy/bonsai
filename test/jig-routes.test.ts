import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { inventory } from '../src/inventory.ts'
import { compileContracts } from '../src/contracts.ts'
import { buildSnapshot } from '../src/retention.ts'
import type { Config } from '../src/model.ts'
import { createJigRouteAdapter } from '../src/jig-routes.ts'
import { jigPackageDigest } from '../src/jig-evidence.ts'
import { createCompilerSession } from './compiler.ts'
import { runCli } from './cli.ts'
import { analyzeSource } from './reference.ts'

const behavior = `Feature: Named authoring route
Scenario: Commission the selected pilot
 When I invoke "pilot" with {}
 Then response "status" equals "ready"
`
const handler = `import { spawnSync } from 'node:child_process'
export function pilot(input: unknown) {
  const child = spawnSync('jig', ['run', 'binding:pilot', '--input', JSON.stringify(input), '--json'], {
    cwd: new URL('./', import.meta.url), encoding: 'utf8',
  })
  if (child.status !== 0) throw new Error(child.stderr)
  return JSON.parse(child.stdout)
}
`

function fixture(extra: Record<string, string> = {}) {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/jig-routes-'))
  const content = {
    'package.json': '{"private":true,"type":"module"}',
    'tsconfig.json': '{"compilerOptions":{}}',
    'handler.ts': handler,
    'bonsai.bindings.ts':
      "import { pilot } from './handler.ts'\nexport const actions = { pilot: pilot }\n",
    'sample.feature': behavior,
    'jig.ts':
      "import { defineJig, discover } from '@jigging/jig'\n" +
      "export default defineJig({ flows: discover('./flows'), bindings: discover('./bindings') })\n",
    'bindings/pilot.ts':
      "import { defineBinding } from '@jigging/jig'\n" +
      "export default defineBinding({ package: 'flows/pilot' })\n",
    'flows/pilot/FLOW.ts':
      "import { handle } from '@jigging/flow'\n" +
      "import { execute } from './method.ts'\nawait handle(execute)\n",
    'flows/pilot/method.ts':
      "import { ready } from './helper.ts'\n" +
      "export async function execute() { return { outcome: 'done', output: { status: ready() } } }\n" +
      "export function unused() { return 'unused' }\n",
    'flows/pilot/helper.ts': "export function ready() { return 'ready' }\n",
    'node_modules/@jigging/jig/package.json':
      '{"name":"@jigging/jig","version":"0.0.0-static-fixture","type":"module","types":"index.d.ts"}',
    'node_modules/@jigging/jig/index.d.ts':
      'export declare function discover(roots: string | string[]): unknown;\n' +
      'export declare function defineJig(value: unknown): unknown;\n' +
      'export declare function defineBinding(value: unknown): unknown;\n',
    'node_modules/@jigging/flow/package.json':
      '{"name":"@jigging/flow","version":"0.0.0-static-fixture","type":"module","types":"index.d.ts"}',
    'node_modules/@jigging/flow/index.d.ts':
      'export declare function handle(handler: () => Promise<unknown>): Promise<void>;\n',
    ...extra,
  }
  for (const [file, text] of Object.entries(content)) {
    mkdirSync(dirname(resolve(root, file)), { recursive: true })
    writeFileSync(resolve(root, file), text)
  }
  const config: Config = {
    maintained: [...Object.keys(content).filter((file) => !file.startsWith('node_modules/')), 'bonsai.json'],
    bindings: 'bonsai.bindings.ts',
    policy: {
      bootstrap: 20000, bootstrapSurface: 20, perDoubling: 2000,
      hardLimit: 30000, maxFeedbackMs: 15000,
    },
  }
  writeFileSync(resolve(root, 'bonsai.json'), JSON.stringify(config))
  return { root, config, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

const compiler = createCompilerSession()

function routes(project: ReturnType<typeof fixture>) {
  const files = project.config.maintained.filter((file) => !file.startsWith('node_modules/'))
  const program = compiler.program(files.filter((file) => /\.[cm]?ts$/.test(file)).map((file) => resolve(project.root, file)))
  const select = createJigRouteAdapter(project.root, files, program)
  const result: NonNullable<ReturnType<typeof select>>[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const route = select(node)
      if (route) result.push(route)
    }
    ts.forEachChild(node, visit)
  }
  visit(program.getSourceFile(resolve(project.root, 'handler.ts'))!)
  return result
}

function problem(project: ReturnType<typeof fixture>) {
  const result = routes(project)
  assert.equal(result.length, 1)
  assert.ok('problem' in result[0]!, JSON.stringify(result.map((entry) => 'file' in entry ? entry.file : entry.problem)))
  return result[0]!.problem
}

test('Jig route adapter resolves aliased imports and the selected literal authoring declarations', () => {
  const project = fixture({
    'handler.ts': handler.replace('spawnSync }', 'spawnSync as launch }').replace("spawnSync('jig'", "launch('jig'"),
    'jig.ts':
      "import { defineJig as project, discover as members } from '@jigging/jig'\n" +
      "export default project({ flows: members(['flows']), bindings: members(['bindings']) })\n",
    'bindings/pilot.ts':
      "import { defineBinding as binding } from '@jigging/jig'\n" +
      "export default binding({ package: './flows/pilot', settings: {copies: 2, locale: 'en'}, slots: {}, attachments: {} })\n",
  })
  try {
    const result = routes(project)
    assert.equal(result.length, 1)
    assert.ok('file' in result[0]!)
    assert.equal(result[0].file, 'flows/pilot/FLOW.ts')
    assert.deepEqual(result[0].selection, {
      route: 'binding:pilot', packagePath: 'flows/pilot',
      digest: jigPackageDigest(project.root, project.config.maintained, 'flows/pilot'),
      settings: { copies: 2, locale: 'en' },
    })
    assert.deepEqual(result[0].declarations.map((node) => relative(project.root, node.getSourceFile().fileName)),
      ['jig.ts', 'bindings/pilot.ts'])
    assert.ok(result[0].declarations.every(ts.isExportAssignment))
  } finally { project.dispose() }
})

test('Jig route adapter requires an explicit analyzed project cwd and rejects launch redirects', () => {
  const variants = [
    [handler.replace("cwd: new URL('./', import.meta.url), ", ''), /set cwd/],
    [handler.replace("new URL('./', import.meta.url)", "new URL('../', import.meta.url)"), /set cwd/],
    [handler.replace("cwd: new URL('./', import.meta.url)", "cwd: '.'"), /set cwd/],
    [handler.replace("encoding: 'utf8'", "encoding: 'utf8', env: process.env"), /unsupported Jig launch option: env/],
    [handler.replace("encoding: 'utf8'", "encoding: 'utf8', shell: true"), /unsupported Jig launch option: shell/],
    [handler.replace("encoding: 'utf8'", "encoding: 'utf8', ...{}"), /spreads/],
    [handler.replace("input: unknown", "input: unknown, URL: typeof globalThis.URL"), /set cwd/],
  ] as const
  for (const [source, expected] of variants) {
    const project = fixture({ 'handler.ts': source })
    try { assert.match(problem(project), expected) } finally { project.dispose() }
  }
  const project = fixture({
    'handler.ts': "import { fileURLToPath as path } from 'node:url'\n" +
      handler.replace("new URL('./', import.meta.url)", "path(new URL('./', import.meta.url))"),
  })
  try { assert.ok(routes(project).some((route) => 'file' in route)) } finally { project.dispose() }
})

test('Jig route adapter rejects computed routes and arguments without treating other commands as run routes', () => {
  for (const source of [
    handler.replace("'binding:pilot'", "String(input)"),
    handler.replace("'binding:pilot'", "'flow:flows/pilot'"),
    handler.replace("'--json'", "'--json', '--json'"),
    handler.replace("'--json'", "'--verification', 'strict'"),
    handler.replace("'--json'", "...['--json']"),
  ]) {
    const project = fixture({ 'handler.ts': source })
    try { assert.match(problem(project), /Unsupported Jig route:/) } finally { project.dispose() }
  }
  for (const source of [
    handler.replace("'run'", "'review'"),
    handler.replace("from 'node:child_process'", "from './fake.ts'"),
    handler.replace('input: unknown', 'input: unknown, spawnSync: any'),
  ]) {
    const project = fixture({
      'handler.ts': source,
      'fake.ts': 'export function spawnSync(...args: any[]) { return {status: 0, stdout: "{}", stderr: ""} }\n',
    })
    try { assert.deepEqual(routes(project), []) } finally { project.dispose() }
  }
})

test('Jig route adapter rejects missing, unmeasured and ambiguous bindings across discovery roots', () => {
  const project = fixture()
  try {
    project.config.maintained = project.config.maintained.filter((file) => file !== 'bindings/pilot.ts')
    assert.match(problem(project), /outside maintained inventory/)
  } finally { project.dispose() }
  const missing = fixture({ 'handler.ts': handler.replace("'binding:pilot'", "'binding:absent'") })
  try { assert.match(problem(missing), /missing binding:absent/) } finally { missing.dispose() }
  const duplicate = fixture({
    'jig.ts': "import {defineJig,discover} from '@jigging/jig'\n" +
      "export default defineJig({ flows: discover('flows'), bindings: discover(['bindings', 'other-bindings']) })\n",
    'other-bindings/pilot.ts': "import {defineBinding} from '@jigging/jig'\nexport default defineBinding({package:'flows/pilot'})\n",
  })
  try { assert.match(problem(duplicate), /ambiguous binding:pilot/) } finally { duplicate.dispose() }
})

test('Jig route adapter bounds authoring syntax and selected flow membership', () => {
  const variants: Record<string, string>[] = [
    { 'jig.ts': "import {defineJig,discover} from '@jigging/jig'\nconst roots = 'flows'; export default defineJig({flows:discover(roots),bindings:discover('bindings')})" },
    { 'jig.ts': "import {defineJig,discover} from '@jigging/jig'\nexport default defineJig({...{},flows:discover('flows'),bindings:discover('bindings')})" },
    { 'bindings/pilot.ts': "import {defineBinding} from '@jigging/jig'\nexport default defineBinding({package:'flows/pilot',slots:{child:'binding:other'}})" },
    { 'bindings/pilot.ts': "import {defineBinding} from '@jigging/jig'\nexport default defineBinding({package:'flows/pilot',package:'flows/other'})" },
    { 'bindings/pilot.ts': "import {defineBinding} from '@jigging/jig'\nexport default defineBinding({package:'../pilot'})" },
    { 'bindings/pilot.ts': "import {defineBinding} from '@jigging/jig'\nexport default defineBinding({package:'flows/nested/pilot'})" },
    { 'bindings/pilot.ts': "function defineBinding(value: unknown) { return value }; export default defineBinding({package:'flows/pilot'})" },
    { 'bindings/pilot.ts': "import {defineBinding} from '@jigging/jig'\nexport default defineBinding({package:'flows/pilot',settings:{__proto__:{}}})" },
    { 'bindings/pilot.ts': "import {defineBinding} from '@jigging/jig'\nexport default defineBinding({package:'flows/pilot',settings:{copies:1e400}})" },
    { 'flows/pilot/FLOW.py': 'print("not TypeScript")' },
  ]
  for (const content of variants) {
    const project = fixture(content)
    try { assert.match(problem(project), /Unsupported Jig route:/) } finally { project.dispose() }
  }
  const project = fixture()
  try {
    project.config.maintained = project.config.maintained.filter((file) => file !== 'flows/pilot/FLOW.ts')
    assert.match(problem(project), /route source outside maintained inventory/)
  } finally { project.dispose() }
  const unmeasured = fixture({ 'flows/pilot/bun.lock': '{"lockfileVersion":1}\n' })
  try {
    unmeasured.config.maintained = unmeasured.config.maintained.filter((file) => file !== 'flows/pilot/bun.lock')
    assert.match(problem(unmeasured), /Jig package file outside maintained inventory/)
  } finally { unmeasured.dispose() }
})

test('Jig route adapter does not follow symlinked declarations or cache a changed selection', () => {
  const project = fixture({
    'bindings/other.ts': "import {defineBinding} from '@jigging/jig'\nexport default defineBinding({package:'flows/pilot'})\n",
  })
  try {
    assert.ok(routes(project).some((route) => 'file' in route))
    writeFileSync(resolve(project.root, 'bindings/pilot.ts'),
      "import {defineBinding} from '@jigging/jig'\nexport default defineBinding({package:'flows/missing'})\n")
    assert.match(problem(project), /cannot inspect route path flows\/missing/)
    rmSync(resolve(project.root, 'bindings/pilot.ts'))
    symlinkSync('other.ts', resolve(project.root, 'bindings/pilot.ts'))
    assert.match(problem(project), /symlinked route path/)
  } finally { project.dispose() }
})

test('native named Jig ancestry selects its flow and helper without retaining unused methods or unrelated routes', async () => {
  const project = fixture({
    'bindings/unselected.ts': "import {defineBinding} from '@jigging/jig'\nexport default defineBinding({package:'flows/unselected'})\n",
    'flows/unselected/FLOW.ts': "import {handle} from '@jigging/flow'\nimport {other} from './method.ts'\nawait handle(other)\n",
    'flows/unselected/method.ts': "export async function other() { return {status:'unselected'} }\n",
  })
  try {
    const files = inventory(project.root, project.config.maintained)
    const reference = analyzeSource(project.root, files, project.config.bindings)
    const { collectRustSource } = await import('../src/collector.ts')
    const { canonicalSource } = await import('./native/client.ts')
    const { source } = await collectRustSource(project.root, files, project.config.bindings)
    assert.deepEqual(canonicalSource(source), canonicalSource(reference))
    assert.deepEqual(source.problems, [])
    const contracts = compileContracts([{ file: 'sample.feature', text: behavior }])
    const snapshot = buildSnapshot('fixture', contracts, source)
    assert.equal(snapshot.ancestry['flows/pilot/method.ts#execute']?.length, 1)
    assert.equal(snapshot.ancestry['flows/pilot/helper.ts#ready']?.length, 1)
    assert.equal(snapshot.jigRouteRequirements?.length, 1)
    assert.equal(snapshot.jigRouteRequirements?.[0]?.from, 'handler.ts#pilot')
    assert.equal(snapshot.jigRouteRequirements?.[0]?.packagePath, 'flows/pilot')
    assert.ok(snapshot.unrooted.includes('flows/pilot/method.ts#unused'))
    assert.ok(snapshot.unrooted.includes('flows/unselected/method.ts#other'))
    const selected = source.components.filter((component) => ['jig.ts', 'bindings/pilot.ts'].includes(component.file))
    assert.ok(selected.length >= 2)
    assert.ok(selected.every((component) => snapshot.ancestry[component.id]?.length === 1))
    assert.ok(source.relationships.some((edge) => edge.from === 'handler.ts#pilot' && edge.kind === 'entry-point' && edge.to.startsWith('flows/pilot/FLOW.ts#')))
    assert.equal(existsSync(resolve(project.root, 'executed')), false)
  } finally {
    project.dispose()
  }
})

test('native named Jig explain reports the selected method without executing authoring or the command', () => {
  const project = fixture({
    'jig.ts': "import {defineJig,discover} from '@jigging/jig'\n" +
      "throw new Error('Static explanation must not load this module')\n" +
      "export default defineJig({flows:discover('flows'),bindings:discover('bindings')})\n",
  })
  try {
    const result = runCli(['explain', 'flows/pilot/method.ts#execute', '--root', project.root, '--json'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.analysis.status, 'complete')
    assert.equal(report.components[0].checks.length, 1)
    assert.ok(report.components[0].contractPaths[0].components.includes('handler.ts#pilot'))
  } finally { project.dispose() }
})

test('native named Jig routes in uncontracted handlers and supporting tests cannot root production', async () => {
  const project = fixture({
    'handler.ts': handler.replace('export function pilot(', 'export function uncontracted(') +
      "\nexport function pilot() { return {status:'ready'} }\n",
    'support.test.ts': "import {pilot} from './handler.ts'\n" +
      handler.replace('export function pilot(', 'export function support(').replace(
        "  const child = spawnSync", "  pilot()\n  const child = spawnSync"),
  })
  try {
    const files = inventory(project.root, project.config.maintained)
    const { collectRustSource } = await import('../src/collector.ts')
    const { source } = await collectRustSource(project.root, files, project.config.bindings)
    assert.deepEqual(source.problems, [])
    const snapshot = buildSnapshot('fixture', compileContracts([{file:'sample.feature',text:behavior}]), source)
    assert.equal(snapshot.ancestry['support.test.ts#support']?.length, 1)
    assert.ok(snapshot.unrooted.includes('handler.ts#uncontracted'))
    assert.ok(snapshot.unrooted.includes('flows/pilot/method.ts#execute'))
    assert.ok(snapshot.unrooted.includes('flows/pilot/helper.ts#ready'))
    assert.deepEqual(snapshot.jigRouteRequirements, [])
  } finally { project.dispose() }
})

test('native named Jig analysis reports an unspecified project root without inventing entry ancestry', async () => {
  const project = fixture({ 'handler.ts': handler.replace("cwd: new URL('./', import.meta.url), ", '') })
  try {
    const files = inventory(project.root, project.config.maintained)
    const { collectRustSource } = await import('../src/collector.ts')
    const { source, analysis } = await collectRustSource(project.root, files, project.config.bindings)
    assert.equal(analysis.status, 'unsupported')
    assert.ok(source.problems.some((message) => /Unsupported Jig route: set cwd/.test(message)))
    assert.ok(source.relationships.every((edge) => edge.kind !== 'entry-point'))
  } finally { project.dispose() }
})
