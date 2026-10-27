import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalSource } from '../native/tools/client.ts'
import { collectRustSource } from '../src/collector.ts'
import { openNativeSession } from '../src/native-session.ts'
import { analyzeSource } from './reference.ts'

const repository = resolve('.')
const executable = resolve('src/cli.ts')
const require = createRequire(import.meta.url)

function fixture() {
  mkdirSync(resolve(repository, 'work'), { recursive: true })
  const root = mkdtempSync(resolve(repository, 'work/native-session-'))
  const marker = join(root, 'calls')
  const files = ['handler.ts', 'bindings.ts', 'sample.feature', 'bonsai.json', 'package.json']
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  writeFileSync(
    join(root, 'handler.ts'),
    [
      "import { appendFileSync } from 'node:fs'",
      'let sequence = 0',
      'export function sample() {',
      ' appendFileSync(' + JSON.stringify(marker) + ", 'call\\n')",
      ' return { sequence: ++sequence }',
      '}',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'bindings.ts'),
    "import { sample } from './handler.ts'\nexport const actions = { sample: sample }\n",
  )
  writeFileSync(
    join(root, 'sample.feature'),
    [
      'Feature: Stateful verification',
      'Scenario Outline: Repeat an action',
      ' When I invoke "sample" with {}',
      ' Then response "sequence" equals <sequence>',
      ' Examples:',
      ' | sequence |',
      ' | 1 |',
      ' | 2 |',
      ' | 3 |',
      '',
    ].join('\n'),
  )
  writeFileSync(
    join(root, 'bonsai.json'),
    JSON.stringify({
      maintained: files,
      bindings: 'bindings.ts',
      policy: {
        bootstrap: 10000,
        bootstrapSurface: 1,
        perDoubling: 0,
        hardLimit: 10000,
        maxFeedbackMs: 15000,
      },
    }),
  )
  return { root, marker, files, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function trace(root: string, name = 'worker-loads') {
  const log = join(root, name)
  const preload = join(root, name + '.mjs')
  writeFileSync(
    preload,
    [
      "import { appendFileSync } from 'node:fs'",
      "import { createRequire } from 'node:module'",
      "if (process.argv[1]?.endsWith('tsrs-worker.ts')) {",
      ' const require = createRequire(import.meta.url)',
      ' const write = process.stdout.write.bind(process.stdout)',
      ' let recorded = false',
      ' process.stdout.write = (chunk, ...args) => {',
      "  if (!recorded && require.cache[require.resolve('typescript')]) {",
      '   appendFileSync(' +
        JSON.stringify(log) +
        ", JSON.stringify({ pid: process.pid, shared: process.argv[2] === '--session' }) + '\\n')",
      '   recorded = true',
      '  }',
      '  return write(chunk, ...args)',
      ' }',
      '}',
      '',
    ].join('\n'),
  )
  return {
    options: '--preload ' + pathToFileURL(preload).href,
    records: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as { pid: number; shared: boolean })
        : [],
  }
}

async function context(options: string, binary?: string) {
  const keys = ['BUN_OPTIONS', 'BONSAI_NATIVE_BINARY', 'BONSAI_NATIVE_SESSION'] as const
  const previous = keys.map((key) => [key, process.env[key]] as const)
  process.env.BUN_OPTIONS = options
  if (binary === undefined) delete process.env.BONSAI_NATIVE_BINARY
  else process.env.BONSAI_NATIVE_BINARY = binary
  delete process.env.BONSAI_NATIVE_SESSION
  const session = await openNativeSession()
  return {
    ...session,
    restore: async () => {
      await session.close()
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    },
  }
}

async function cli(root: string, value: string, extra: NodeJS.ProcessEnv = {}, cwd = repository) {
  return await new Promise<{ status: number | null; stdout: string; stderr: string; report: any }>(
    (done, reject) => {
      const child = spawn(
        process.execPath,
        [executable, 'check', '--root', root, '--engine', 'rust', '--serial', '--json'],
        {
          cwd,
          env: {
            ...process.env,
            BONSAI_ROOT: undefined,
            BONSAI_BASE: undefined,
            BONSAI_POLICY: undefined,
            BONSAI_NATIVE_SESSION: value,
            CI: '1',
            NO_COLOR: '1',
            ...extra,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let stdout = ''
      let stderr = ''
      const deadline = setTimeout(() => child.kill('SIGKILL'), 20000)
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.once('error', reject)
      child.once('close', (status) => {
        clearTimeout(deadline)
        try {
          done({ status, stdout, stderr, report: JSON.parse(stdout || stderr) })
        } catch (error) {
          reject(new Error(String(error) + '\n' + stdout + stderr))
        }
      })
    },
  )
}

function passed(result: Awaited<ReturnType<typeof cli>>) {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.equal(result.report.decision.status, 'pass')
  assert.equal(result.report.snapshot.evidence.complete, true)
  assert.deepEqual(
    result.report.snapshot.evidence.checks.map((check: any) => check.status),
    ['passed', 'passed', 'passed'],
  )
}

test('a shared lexical worker preserves every action call and fresh application modules', {
  timeout: 30000,
}, async () => {
  const project = fixture()
  const loaded = trace(project.root)
  const session = await context(loaded.options)
  try {
    passed(await cli(project.root, session.value))
    passed(await cli(project.root, session.value))
    assert.equal(readFileSync(project.marker, 'utf8').trim().split('\n').length, 6)
    assert.equal(loaded.records().length, 1, 'Two checks must load the lexical module once')
    assert.equal(loaded.records()[0]!.shared, true)
    const first = loaded.records()[0]!.pid
    await session.close()
    const second = await openNativeSession()
    try {
      passed(await cli(project.root, second.value))
      assert.equal(loaded.records().length, 2, 'A new owner must use a new lexical process')
      assert.notEqual(loaded.records()[1]!.pid, first)
    } finally {
      await second.close()
    }
  } finally {
    await session.restore()
    project.dispose()
  }
})

test('warm native requests reread source, declarations, modules, and maintained roots', {
  timeout: 60000,
}, async () => {
  const project = fixture()
  const loaded = trace(project.root)
  const session = await context(loaded.options)
  process.env.BONSAI_NATIVE_SESSION = session.value
  const compare = async () => {
    const reference = analyzeSource(project.root, [...project.files].sort(), 'bindings.ts')
    const native = await collectRustSource(
      project.root,
      [...project.files].sort(),
      'bindings.ts',
      undefined,
      15000,
    )
    assert.deepEqual(canonicalSource(native.source), canonicalSource(reference))
    return native.source
  }
  try {
    writeFileSync(
      join(project.root, 'handler.ts'),
      'export function sample() { return { sequence: 1 } }\n',
    )
    assert.deepEqual((await compare()).problems, [])
    writeFileSync(
      join(project.root, 'handler.ts'),
      'export function sample() { const value: number = "wrong"; return { sequence: value } }\n',
    )
    assert.match((await compare()).problems.join('\n'), /not assignable/)
    writeFileSync(
      join(project.root, 'handler.ts'),
      'import { value } from "./dependency.ts"\nexport function sample() { return { sequence: value } }\n',
    )
    assert.match((await compare()).problems.join('\n'), /Cannot find module/)
    writeFileSync(join(project.root, 'dependency.ts'), 'export const value = 1\n')
    project.files.push('dependency.ts')
    assert.deepEqual((await compare()).problems, [])
    const declarations = join(project.root, 'node_modules/library')
    mkdirSync(declarations, { recursive: true })
    writeFileSync(join(declarations, 'package.json'), '{"types":"index.d.ts"}')
    writeFileSync(join(declarations, 'index.d.ts'), 'export declare const value: string\n')
    writeFileSync(
      join(project.root, 'handler.ts'),
      'import { value } from "library"\nexport function sample() { const text: string = value; return { sequence: text.length } }\n',
    )
    assert.deepEqual((await compare()).problems, [])
    writeFileSync(join(declarations, 'index.d.ts'), 'export declare const value: number\n')
    assert.match((await compare()).problems.join('\n'), /not assignable/)
    writeFileSync(join(declarations, 'index.d.ts'), 'export declare const value: string\n')
    project.files.splice(project.files.indexOf('dependency.ts'), 1)
    rmSync(join(project.root, 'dependency.ts'))
    assert.deepEqual((await compare()).problems, [])
    assert.equal(
      loaded.records().length,
      1,
      'All changed analyses must use the warm lexical worker',
    )
  } finally {
    await session.restore()
    project.dispose()
  }
})

test('session context preserves relative overrides and isolates changed runtime options', {
  timeout: 30000,
}, async () => {
  const project = fixture()
  const loaded = trace(project.root)
  const alternate = trace(project.root, 'alternate-worker-loads')
  const manifest = require.resolve('tsrs/package.json')
  const native = require(join(dirname(manifest), 'lib/getExePath.js')).default() as string
  const session = await context(loaded.options, relative(repository, native))
  try {
    const ownerCwd = process.cwd()
    const ownerBinary = process.env.BONSAI_NATIVE_BINARY
    const ownerOptions = process.env.BUN_OPTIONS
    try {
      process.chdir(project.root)
      process.env.BONSAI_NATIVE_BINARY = join(project.root, 'missing-owner-native')
      process.env.BUN_OPTIONS = alternate.options
      passed(
        await cli(
          project.root,
          session.value,
          {
            BUN_OPTIONS: loaded.options,
            BONSAI_NATIVE_BINARY: relative(project.root, native),
          },
          project.root,
        ),
      )
    } finally {
      process.chdir(ownerCwd)
      for (const [key, value] of [
        ['BONSAI_NATIVE_BINARY', ownerBinary],
        ['BUN_OPTIONS', ownerOptions],
      ] as const) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
    assert.equal(loaded.records().length, 1)
    assert.equal(
      loaded.records()[0]!.shared,
      true,
      'Caller-relative matching overrides must borrow the owner',
    )
    const missing = await cli(project.root, session.value, {
      BONSAI_NATIVE_BINARY: join(project.root, 'missing-native'),
    })
    assert.equal(missing.status, 1)
    assert.equal(missing.report.code, 'RUST_COLLECTOR')
    assert.equal(readFileSync(project.marker, 'utf8').trim().split('\n').length, 3)
    passed(await cli(project.root, session.value, { BUN_OPTIONS: alternate.options }))
    assert.equal(alternate.records().length, 1)
    assert.equal(
      alternate.records()[0]!.shared,
      false,
      'Different runtime options must use a fresh process',
    )
    assert.equal(loaded.records().length, 1, 'Foreign context must not replace the owner worker')
    passed(await cli(project.root, session.value))
    assert.equal(loaded.records().length, 1)
  } finally {
    await session.restore()
    project.dispose()
  }
})
