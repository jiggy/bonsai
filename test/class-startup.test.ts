import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { executesAtEntry } from '../src/subprocess.ts'
import { collectRustSource } from '../src/collector.ts'
import { compileContracts } from '../src/contracts.ts'
import { buildSnapshot } from '../src/retention.ts'
import { inventory } from '../src/inventory.ts'
import { analyzeSource } from './reference.ts'
import { canonicalSource } from './native/client.ts'
import { createProject } from './project.ts'
import { runCli } from './cli.ts'

test('class startup classification follows definition-time effects rather than dormant bodies', () => {
  for (const [text, expected] of [
    ['class Startup { static { boot() } }', true],
    ['class Startup { static { throw "unavailable" } }', true],
    ['class Startup { static value = boot() }', true],
    ['class Startup { [name()]() {} }', true],
    ['class Startup { [name()] = 1 }', true],
    ['class Startup extends base() {}', true],
    ['@decorate class Startup {}', true],
    ['class Startup { @decorate method() {} }', true],
    ['class Startup { constructor(@decorate value: number) {} }', true],
    ['class Startup { method(@decorate value: number) {} }', true],
    ['const Startup = class { static { boot() } }', true],
    ['const Startup = class { static value = boot() }', true],
    ['class Dormant { method() { boot() } }', false],
    ['class Dormant { constructor() { boot() } }', false],
    ['class Dormant { value = boot() }', false],
    ['class Dormant { static value = 1 }', false],
    ['class Dormant { static method() { boot() } }', false],
    ['class Dormant { static get value() { return boot() } }', false],
    ['class Dormant { static value = () => boot() }', false],
    ['class Dormant { static { const value = 1 } }', false],
    ['class Dormant { static { function later() { boot() } } }', false],
    ['const Dormant = class { value = boot() }', false],
    ['function dormant() { class Startup { static { boot() } } }', false],
  ] as const) {
    const ast = ts.createSourceFile('child.ts', text, ts.ScriptTarget.Latest, true)
    const statement = ast.statements[0]!
    const node = ts.isVariableStatement(statement)
      ? statement.declarationList.declarations[0]!
      : statement
    assert.equal(executesAtEntry(node), expected, text)
  }
})

test('native child entry tracing includes class startup while inert class siblings remain unrooted', async () => {
  const feature = `Feature: Child startup
Scenario: Read the child result
 When I invoke "launch" with {}
 Then response "status" equals "ok"
`
  const project = createProject({
    'package.json': '{"type":"module"}',
    'bindings.ts':
      "import { launch } from './handler.ts'\nexport const actions = { launch: launch }\n",
    'handler.ts': `import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
export function launch() {
 const child = spawnSync(process.execPath, [fileURLToPath(new URL('./child.ts', import.meta.url))], { encoding: 'utf8' })
 return JSON.parse(child.stdout)
}
`,
    'child.ts': `function answer() { return { status: 'ok' } }
class Startup { static { process.stdout.write(JSON.stringify(answer())) } }
function dormant() { return 42 }
export class Inert { value = dormant(); method() { return dormant() } }
export const literal = class { static label = 'unused' }
`,
    'child.feature': feature,
  })
  try {
    const files = inventory(project.root, project.files)
    const reference = analyzeSource(project.root, files, 'bindings.ts')
    const contracts = compileContracts([{ file: 'child.feature', text: feature }])
    const snapshot = buildSnapshot('class-startup', contracts, reference)
    assert.deepEqual(reference.problems, [])
    assert.ok(snapshot.ancestry['child.ts#Startup']?.length)
    assert.ok(snapshot.ancestry['child.ts#answer']?.length)
    for (const id of ['child.ts#Inert', 'child.ts#dormant', 'child.ts#literal'])
      assert.ok(snapshot.unrooted.includes(id), id)
    const native = await collectRustSource(project.root, files, 'bindings.ts')
    assert.deepEqual(canonicalSource(native.source), canonicalSource(reference))
    assert.deepEqual(
      buildSnapshot('class-startup', contracts, native.source).ancestry,
      snapshot.ancestry,
    )
  } finally {
    project.dispose()
  }
})

test('the native CLI executes child class startup and verifies its declared result', () => {
  const project = createProject({
    'package.json': '{"type":"module"}\n',
    'bindings.ts': "import { live } from './app.ts'\nexport const actions = { live: live }\n",
    'app.ts': `import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export function live() {
 writeFileSync(new URL('./handler-ran', import.meta.url), 'executed')
 const child = spawnSync(process.execPath, [fileURLToPath(new URL('./child.ts', import.meta.url))], { encoding: 'utf8' })
 if (child.status !== 0) throw new Error(child.stderr)
 return JSON.parse(child.stdout)
}
`,
    'child.ts': `function result() { return { status: 'ok' } }
class Startup { static { process.stdout.write(JSON.stringify(result())) } }
`,
    'orders.feature': `Feature: A supported operation
Scenario: Observe its result
 When I invoke "live" with {}
 Then response "status" equals "ok"
`,
  })
  try {
    const result = runCli(['check', '--root', project.root, '--json'])
    assert.equal(result.error, undefined, String(result.error))
    assert.equal(result.signal, null, result.stderr)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.decision.status, 'pass')
    assert.equal(existsSync(join(project.root, 'handler-ran')), true)
    assert.equal(report.snapshot.evidence.complete, true)
    assert.deepEqual(
      report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
      ['passed'],
    )
  } finally {
    project.dispose()
  }
})
