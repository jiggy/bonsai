import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export type FixtureCase = {
  name: string
  files: Record<string, string>
  bindings: string
  feature: string
  inventory?: string[]
  expect?: 'parity' | 'unsupported'
  expectedProblem?: string
}

const feature = `Feature: Collection
Scenario: Handle
 When I invoke "handle" with {}
 Then response "status" equals "ok"
`
const binding = `import { handle } from './handler.ts'
export const actions = { 'handle': handle }
`
const files = (sources: Record<string, string>) => ({
  'package.json': '{"type":"module"}\n',
  'behavior.feature': feature,
  'bindings.ts': binding,
  ...sources,
})

export const cases: FixtureCase[] = [
  {
    name: 'script-globals-remain-visible-across-files',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'package.json': '{"type":"commonjs"}\n',
      'handler.ts': 'export function handle() { return { status: sharedStatus() } }\n',
      'globals.d.ts': 'declare function sharedStatus(): string\n',
    }),
  },
  {
    name: 'local-primitive-path-aliases-retain-subprocess-entry',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts': `import { spawnSync as launch } from 'node:child_process'
import { fileURLToPath as pathOf } from 'node:url'
export function handle(input: unknown) {
  const entry = pathOf(new URL('./entry.ts', import.meta.url))
  const alias = entry
  launch(process.execPath, [alias])
  return { status: 'ok' }
}
`,
      'entry.ts': "function start() { return 'started' }\nstart()\n",
    }),
  },
  {
    name: 'namespace-reexport-alias-and-external-properties',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts': `import * as operations from './exports.ts'
import * as defaults from './default.ts'
export function handle() { return { status: operations.exposed().toLowerCase(), other: defaults.default() } }
`,
      'exports.ts': "export { original as exposed } from './implementation.ts'\n",
      'default.ts': "export default function originalDefault() { return 'OK' }\n",
      'implementation.ts':
        "export function original() { return 'OK' }\nexport function unused() { return 'unused' }\n",
    }),
  },
  {
    name: 'checkout',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts': `export function validQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity > 0
}

export function handle(input: { quantity: number }) {
  return { status: validQuantity(input.quantity) ? 'ok' : 'rejected' }
}
`,
    }),
  },
  {
    name: 'import-alias-and-unused-sibling',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts': `import { format as render } from './format.ts'
export function handle() { return render() }
`,
      'format.ts': `export function format() { return { status: 'ok' } }
export function unused() { return 42 }
`,
    }),
  },
  {
    name: 'dead-cycle-and-uncontracted-registration',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'bindings.ts': `import { handle, other } from './handler.ts'
export const actions = { handle: handle, other: other }
`,
      'handler.ts': `export function handle() { return { status: 'ok' } }
export function other(): number { return second() }
export function second(): number { return other() }
`,
    }),
  },
  {
    name: 'tests-cannot-root-unused-production',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts': `export function handle() { return { status: 'ok' } }
export function unused() { return 42 }
`,
      'handler.test.ts': `import { handle, unused } from './handler.ts'
export function testSubject() { handle(); return unused() }
`,
    }),
  },
  {
    name: 'lexical-shadow-and-property-names',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts': `export function hidden() { return 42 }
export function objectName() { return 42 }
export function handle(hidden: number = 1) {
  const object = { objectName: hidden }
  return { status: object.objectName > 0 ? 'ok' : 'rejected' }
}
`,
    }),
  },
  {
    name: 'shorthand-property-reference-parity',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts': `const value = 1
export function handle() { return { status: 'ok', value } }
`,
    }),
  },
  {
    name: 'destructuring-assignment-reference-parity',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts': `let shorthandValue = 1
let defaultValue = 1
let explicitValue = 1
export function handle() {
  ({ shorthandValue } = { shorthandValue: 2 })
  ;({ defaultValue = 2 } = {})
  ;({ x: explicitValue } = { x: 2 })
  return { status: 'ok' }
}
`,
    }),
  },
  {
    name: 'type-only-reference',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts': `import type { Input } from './types.ts'
export function handle(input: Input) { return { status: input.status } }
`,
      'types.ts': `export type Input = { status: string }
export type Unused = { ignored: number }
`,
    }),
  },
  {
    name: 'unicode-comment-and-literal-cost',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts': `// café λ 中文 é
export const greeting = 'héllo 🌳'
export function handle() { return { status: greeting.length > 0 ? 'ok' : 'rejected' } }
`,
    }),
  },
  {
    name: 'namespace-selected-export',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts': `import * as handlers from './format.ts'
export function handle() { return handlers.format() }
`,
      'format.ts': `export function format() { return { status: 'ok' } }
export function unused() { return 42 }
`,
    }),
  },
  {
    name: 'unicode-top-level-offset-and-line-terminators',
    bindings: 'bindings.ts',
    feature,
    files: files({
      'handler.ts':
        "// 🌳 café\r\nexport function handle() { return { status: 'ok' } }\rvoid 0\u2028const marker = 1\u2029",
    }),
  },
  {
    name: 'computed-import',
    bindings: 'bindings.ts',
    feature,
    expect: 'unsupported',
    expectedProblem: 'Dynamic import requires an adapter:',
    files: files({
      'handler.ts': `const modulePath = './format.ts'
export async function handle() { return (await import(modulePath)).format() }
`,
      'format.ts': `export function format() { return { status: 'ok' } }
`,
    }),
  },
  {
    name: 'spread-registration',
    bindings: 'bindings.ts',
    feature,
    expect: 'unsupported',
    expectedProblem: 'Each action binding must be a literal key and named handler',
    files: files({
      'handler.ts': `export function handle() { return { status: 'ok' } }
`,
      'bindings.ts': `import { handle } from './handler.ts'
const entries = { handle: handle }
export const actions = { ...entries }
`,
    }),
  },
  {
    name: 'unused-missing-named-import',
    bindings: 'bindings.ts',
    feature,
    expect: 'unsupported',
    expectedProblem: 'Cannot resolve local export: types.ts#missing',
    files: files({
      'handler.ts': `import { missing } from './types.ts'
export function handle() { return { status: 'ok' } }
`,
      'types.ts': `export type Existing = { value: string }
`,
    }),
  },
  {
    name: 'decorator',
    bindings: 'bindings.ts',
    feature,
    expect: 'unsupported',
    expectedProblem: 'Unsupported decorator:',
    files: files({
      'handler.ts': `function decorate(value: any) { return value }
@decorate
export class Handler {}
export function handle() { return { status: 'ok', value: Handler } }
`,
    }),
  },
  {
    name: 'ambient-global-declaration',
    bindings: 'bindings.ts',
    feature,
    expect: 'unsupported',
    expectedProblem: 'Unsupported ambient declaration scope:',
    files: files({
      'global.d.ts': 'declare const shared: number\n',
      'handler.ts': `export function handle() { return shared }
`,
    }),
  },
  {
    name: 'dependency-outside-inventory',
    bindings: 'bindings.ts',
    feature,
    expect: 'unsupported',
    expectedProblem: 'Local dependency outside maintained inventory: format.ts',
    inventory: ['package.json', 'behavior.feature', 'bindings.ts', 'handler.ts'],
    files: files({
      'handler.ts': `import { format } from './format.ts'
export function handle() { return format() }
`,
      'format.ts': `export function format() { return { status: 'ok' } }
`,
    }),
  },
]

export function materializeFixture(fixture: FixtureCase) {
  // Repository ancestry supplies the same installed Node types to both collectors.
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/native-compare-'))
  for (const [file, contents] of Object.entries(fixture.files)) {
    const target = resolve(root, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }
  return {
    root,
    files: [...(fixture.inventory ?? Object.keys(fixture.files))].sort(),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}
