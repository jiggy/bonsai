import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { readConfig } from '../src/project.ts'
import { runCli } from './cli.ts'

const configFile = resolve('work/config-parity/bonsai.json')
const policy = {
  bootstrap: 400,
  bootstrapSurface: 1,
  perDoubling: 50,
  hardLimit: 1000,
  maxFeedbackMs: 15000,
}
const config = {
  maintained: ['src', 'features', 'bindings.ts', 'bonsai.json'],
  bindings: 'bindings.ts',
  policy,
}

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape)
  if (value === null || typeof value !== 'object') return value
  const prototype = Object.getPrototypeOf(value)
  return {
    entries: Object.keys(value).map((key) => [key, shape((value as Record<string, unknown>)[key])]),
    prototype: prototype === Object.prototype ? 'object' : shape(prototype),
  }
}

function referenceSyntaxError(text: string): string | undefined {
  const parsed = ts.parseConfigFileTextToJson(configFile, text)
  const error = parsed.error
  if (!error) return undefined
  const location =
    error.file && error.start !== undefined
      ? error.file.getLineAndCharacterOfPosition(error.start)
      : undefined
  return `Syntax error${location ? ` at line ${location.line + 1}, column ${location.character + 1}` : ''}: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`
}

test('configuration fast parsing preserves TypeScript JSON values and property semantics', () => {
  const standard = JSON.stringify(config)
  for (const text of [
    standard,
    JSON.stringify(config, null, 2),
    standard.replace('"bootstrap":400', '"bootstrap":0,"bootstrap":400'),
    standard.replace('"bootstrap":400', '"bootstrap":-0'),
    standard.replace('"perDoubling":50', '"perDoubling":0.125'),
    standard.replace('"hardLimit":1000', '"hardLimit":1e100'),
    standard.replace(
      '"bindings":"bindings.ts"',
      '"bindings":"bindings.ts","payload":[-12,-0,1e21,9007199254740993,1e-400,1e400,null,true]',
    ),
    standard.replace('"bindings":"bindings.ts"', '"bindings":"bindings.ts","__value":1'),
    standard.replace('"bindings":"bindings.ts"', '"bindings":"bindings.ts","___value":1'),
    standard.replace(
      '"bindings":"bindings.ts"',
      '"bindings":"bindings.ts","payload":{"__proto__":{"marker":true},"___value":2}',
    ),
    standard.replace(
      '"bindings":"bindings.ts"',
      '"bindings":"bindings.ts","__proto__":{"marker":true}',
    ),
    standard.replace(
      '"bindings":"bindings.ts"',
      '"bindings":"bindings.ts","\\u005f\\u005f\\u005fvalue":3',
    ),
    '\ufeff' + standard,
    '// JSONC remains supported\n' + standard.replace('"policy":{', '"policy":{/* budget */'),
    standard.replace('"maxFeedbackMs":15000}', '"maxFeedbackMs":15000,}'),
  ]) {
    const expected = ts.parseConfigFileTextToJson(configFile, text)
    assert.equal(expected.error, undefined, text)
    assert.deepEqual(
      shape(readConfig(resolve('.'), configFile, text)),
      shape(expected.config),
      text,
    )
  }
})

test('configuration fallback preserves exact syntax locations and root validation errors', () => {
  const standard = JSON.stringify(config, null, 2)
  for (const text of [
    'null',
    '[]',
    '[{}]',
    '42',
    'true',
    '"configuration"',
    '{\n  "maintained": ["src"]\n  "bindings": "bindings.ts"\n}',
    standard.replace('"bindings": "bindings.ts"', '"bindings": ]'),
    standard.replace('"maintained"', "'maintained'"),
    standard.replace('"maintained"', 'maintained'),
    standard + '\ntrailing',
    '{\n /* unfinished comment',
  ]) {
    const expected = referenceSyntaxError(text)
    assert.ok(expected, text)
    assert.throws(() => readConfig(resolve('.'), configFile, text), { message: expected }, text)
  }
  for (const text of ['', '{}', '{"maintained":null}', '{"maintained":[]}']) {
    assert.equal(referenceSyntaxError(text), undefined)
    assert.throws(() => readConfig(resolve('.'), configFile, text), {
      message: 'Configuration needs maintained paths and a bindings file',
    })
  }
  for (const text of [
    JSON.stringify({ ...config, policy: null }),
    JSON.stringify({ ...config, policy: { ...policy, bootstrap: -1 } }),
    JSON.stringify({ ...config, policy: { ...policy, maxFeedbackMs: 0 } }),
    JSON.stringify({ ...config, exclude: [null] }),
  ]) {
    assert.throws(() => readConfig(resolve('.'), configFile, text))
  }
})

test('native CLI loads TypeScript only inside its semantic worker', { timeout: 30000 }, () => {
  mkdirSync('work', { recursive: true })
  const root = mkdtempSync(resolve('work/lazy-native-'))
  cpSync(resolve('examples/checkout'), root, { recursive: true })
  const preload = join(root, 'typescript-load-guard.mjs')
  const loaded = join(root, 'native-worker-typescript-loads')
  writeFileSync(
    preload,
    `import { appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { plugin } from 'bun'
const worker = process.argv[1]?.endsWith('tsrs-worker.ts')
if (worker) {
  const require = createRequire(import.meta.url)
  process.on('beforeExit', () => {
    if (require.cache[require.resolve('typescript')]) appendFileSync(${JSON.stringify(loaded)}, 'native worker\\n')
  })
} else plugin({
  name: 'guard-parent-typescript-load',
  setup(build) {
    build.onLoad({ filter: /typescript[.]js$/ }, () => {
      throw new Error('PARENT_TYPESCRIPT_LOAD_FORBIDDEN')
    })
  },
})
`,
  )
  const environment = {
    ...process.env,
    BONSAI_ROOT: undefined,
    BONSAI_BASE: undefined,
    BONSAI_POLICY: undefined,
    BONSAI_NATIVE_BINARY: undefined,
    BUN_OPTIONS: `--preload ${pathToFileURL(preload).href}`,
    CI: '1',
    NO_COLOR: '1',
  }
  const run = (args: string[]) =>
    runCli([...args, '--json', '--debug'], {
      cwd: resolve('.'),
      env: environment,
      timeout: 20000,
    })
  const invoke = (args: string[]) => {
    const result = run(args)
    assert.equal(result.error, undefined, String(result.error))
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return JSON.parse(result.stdout)
  }
  try {
    const control = spawnSync(process.execPath, ['--eval', "await import('typescript')"], {
      cwd: resolve('.'),
      env: environment,
      encoding: 'utf8',
      timeout: 10000,
    })
    assert.notEqual(control.status, 0)
    assert.match(control.stderr, /PARENT_TYPESCRIPT_LOAD_FORBIDDEN/)
    assert.equal(invoke(['config', 'show', '--root', root]).config.bindings, 'bindings.ts')
    const checked = invoke(['check', '--root', root, '--engine', 'rust'])
    assert.equal(checked.decision.status, 'pass')
    assert.equal(checked.snapshot.analysis.backend, 'tsrs')
    assert.equal(checked.snapshot.evidence.complete, true)
    const explained = invoke([
      'explain',
      'src/checkout.ts#placeOrder',
      '--root',
      root,
      '--engine',
      'rust',
    ])
    assert.equal(explained.components[0].id, 'src/checkout.ts#placeOrder')
    assert.ok(readFileSync(loaded, 'utf8').split('\n').filter(Boolean).length >= 2)
    const reference = run(['check', '--root', root, '--engine', 'typescript'])
    assert.notEqual(reference.status, 0)
    assert.match(reference.stderr, /PARENT_TYPESCRIPT_LOAD_FORBIDDEN/)
    const file = join(root, 'bonsai.json')
    writeFileSync(file, '// Force the established JSONC parser\n' + readFileSync(file, 'utf8'))
    const jsonc = run(['config', 'show', '--root', root])
    assert.notEqual(jsonc.status, 0)
    assert.match(jsonc.stderr, /PARENT_TYPESCRIPT_LOAD_FORBIDDEN/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
