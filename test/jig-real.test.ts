import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { cliEnvironment, runCli } from './cli.ts'

// This opt-in smoke needs a qualified Jig host and registry access. Ordinary tests
// never install packages; an opted-in host or review failure must fail this test.
test('pinned Jig executes the selected current method and refuses stale reviewed code', {
  skip: process.env.BONSAI_JIG_SMOKE !== '1',
  timeout: 300000,
}, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bonsai-real-jig-')))
  const cache = mkdtempSync(join(tmpdir(), 'bonsai-jig-cache-'))
  const environment = cliEnvironment({
    PATH: [join(root, 'node_modules/.bin'), process.env.PATH].filter(Boolean).join(delimiter),
    BUN_INSTALL_CACHE_DIR: cache,
    BUN_OPTIONS: undefined,
    NODE_OPTIONS: undefined,
  })
  const put = (path: string, value: string | object) => {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value))
  }
  const run = (executable: string, args: string[], cwd = root) => {
    const result = spawnSync(executable, args, {
      cwd,
      env: environment,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    })
    assert.equal(result.error, undefined, String(result.error))
    assert.equal(result.signal, null, result.stderr)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return result
  }
  const bonsai = (args: string[]) => {
    const result = runCli([...args, '--root', root, '--json', '--timeout', '60'], {
      env: environment,
      timeout: 65000,
      maxBuffer: 16 * 1024 * 1024,
    })
    assert.equal(result.error, undefined, String(result.error))
    assert.equal(result.signal, null, result.stderr)
    return { exitCode: result.status, ...JSON.parse(result.stdout || result.stderr) }
  }
  const method = `import type { RunContext } from '@jigging/flow'
import { createMaterials } from './materials.ts'
export async function execute(run: RunContext) {
  const input = run.input as { problem: string }
  const materials = createMaterials(input.problem)
  return { outcome: 'done', output: { status: 'ready', problem: materials.problem } }
}
`
  try {
    put('package.json', {
      name: 'bonsai-real-jig-consumer',
      private: true,
      type: 'module',
      dependencies: { '@jigging/jig': '0.1.0-alpha.42', '@jigging/flow': '0.1.0-alpha.15' },
    })
    run(process.execPath, ['install', '--lockfile-only', '--ignore-scripts'])
    run(process.execPath, ['install', '--frozen-lockfile', '--ignore-scripts'])
    const installed = (name: string) =>
      JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'))
    assert.equal(installed('@jigging/jig').version, '0.1.0-alpha.42')
    assert.equal(installed('@jigging/flow').version, '0.1.0-alpha.15')
    const jig = join(root, 'node_modules/.bin/jig')

    put(
      'jig.ts',
      `import { defineJig, discover } from '@jigging/jig'
export default defineJig({ flows: discover('./flows'), bindings: discover('./bindings') })
`,
    )
    put(
      'bindings/pilot.ts',
      `import { defineBinding } from '@jigging/jig'
export default defineBinding({ package: 'flows/pilot' })
`,
    )
    put('flows/pilot/package.json', {
      name: 'bonsai-pilot-flow',
      private: true,
      type: 'module',
      dependencies: { '@jigging/flow': '0.1.0-alpha.15' },
    })
    put('flows/pilot/FLOW.meta.json', {
      name: 'bonsai-pilot',
      description: 'Prepare a publisher pilot.',
    })
    put('flows/pilot/FLOW.contract.json', {
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      input: {
        type: 'object',
        properties: { problem: { type: 'string' } },
        required: ['problem'],
        additionalProperties: false,
      },
      result: {
        type: 'object',
        properties: {
          outcome: { const: 'done' },
          output: {
            type: 'object',
            properties: { status: { type: 'string' }, problem: { type: 'string' } },
            required: ['status', 'problem'],
            additionalProperties: false,
          },
        },
        required: ['outcome', 'output'],
        additionalProperties: false,
      },
    })
    put(
      'flows/pilot/FLOW.ts',
      `import { handle } from '@jigging/flow'
import { execute } from './method.ts'
await handle(execute)
`,
    )
    put('flows/pilot/method.ts', method)
    put(
      'flows/pilot/materials.ts',
      `export function createMaterials(problem: string) { return { problem } }
`,
    )
    // Jig prepares this package with its own qualified runtime. Generate that
    // runtime's supported lock without putting node_modules into the Flow source.
    const jigRequire = createRequire(join(root, 'node_modules/@jigging/jig/package.json'))
    const runtimePackage =
      process.platform === 'linux'
        ? '@oven/bun-linux-x64-baseline'
        : process.arch === 'arm64'
          ? '@oven/bun-darwin-aarch64'
          : '@oven/bun-darwin-x64-baseline'
    const jigRuntime = join(
      dirname(jigRequire.resolve(`${runtimePackage}/package.json`)),
      'bin/bun',
    )
    run(jigRuntime, ['install', '--lockfile-only', '--ignore-scripts'], join(root, 'flows/pilot'))
    assert.equal(existsSync(join(root, 'flows/pilot/node_modules')), false)
    const flowLock = readFileSync(join(root, 'flows/pilot/bun.lock'))

    put(
      'handler.ts',
      `import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
writeFileSync(new URL('./application-loaded', import.meta.url), 'loaded')
export function pilot(input: unknown) {
  writeFileSync(new URL('./handler-executed', import.meta.url), 'executed')
  const child = spawnSync('jig', ['run', 'binding:pilot', '--input', JSON.stringify(input), '--json'], {
    cwd: new URL('./', import.meta.url), encoding: 'utf8', timeout: 25000,
  })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(child.stderr || child.stdout)
  const result = JSON.parse(child.stdout)
  if (result.status !== 'succeeded' || result.outcome !== 'done' || result.cleanup !== undefined)
    throw new Error(JSON.stringify(result))
  return result.output
}
`,
    )
    put(
      'bindings.ts',
      `import { pilot } from './handler.ts'
export const actions = { pilot: pilot }
`,
    )
    put(
      'pilot.feature',
      `Feature: Commission a useful pilot
  Scenario: Receive the selected application's result
    When I invoke "pilot" with {"problem":"daily practice"}
    Then response "status" equals "ready"
`,
    )
    put('bonsai.json', {
      maintained: [
        'handler.ts',
        'bindings.ts',
        'jig.ts',
        'bindings',
        'flows',
        'pilot.feature',
        'package.json',
        'bonsai.json',
      ],
      bindings: 'bindings.ts',
      policy: {
        bootstrap: 10000,
        bootstrapSurface: 1,
        perDoubling: 0,
        hardLimit: 10000,
        maxFeedbackMs: 30000,
      },
    })
    const rules = readFileSync(join(root, 'bonsai.json'))
    run(jig, ['review', '--yes'])
    assert.deepEqual(readFileSync(join(root, 'flows/pilot/bun.lock')), flowLock)
    const approval = readFileSync(join(root, 'jig.lock'))

    for (const target of [
      'flows/pilot/method.ts#execute',
      'flows/pilot/materials.ts#createMaterials',
    ]) {
      const explained = bonsai(['explain', target])
      assert.equal(explained.exitCode, 0, JSON.stringify(explained))
      assert.deepEqual(explained.problems, [])
      assert.equal(explained.components[0].id, target)
      assert.equal(explained.components[0].checks.length, 1)
      assert.equal(explained.components[0].contractPaths.length, 1)
      assert.equal(existsSync(join(root, 'application-loaded')), false)
      assert.equal(existsSync(join(root, 'handler-executed')), false)
    }
    assert.deepEqual(readFileSync(join(root, 'jig.lock')), approval)
    const direct = JSON.parse(
      run(jig, ['run', 'binding:pilot', '--input', '{"problem":"daily practice"}', '--json'])
        .stdout,
    )
    assert.equal(direct.status, 'succeeded')
    assert.equal(direct.outcome, 'done')
    assert.equal(direct.cleanup, undefined)
    assert.deepEqual(direct.output, { status: 'ready', problem: 'daily practice' })

    const control = bonsai(['check', '--serial', '--no-report'])
    assert.equal(control.exitCode, 0, JSON.stringify(control))
    assert.equal(control.decision.status, 'pass')
    assert.deepEqual(control.snapshot.source.problems, [])
    assert.deepEqual(control.snapshot.unrooted, [])
    assert.equal(control.snapshot.evidence.complete, true)
    assert.deepEqual(
      control.snapshot.evidence.checks.map((check: { status: string }) => check.status),
      ['passed'],
    )
    assert.equal(existsSync(join(root, 'handler-executed')), true)

    put('flows/pilot/method.ts', method.replace("status: 'ready'", "status: 'missing'"))
    rmSync(join(root, 'application-loaded'), { force: true })
    rmSync(join(root, 'handler-executed'), { force: true })
    const stale = bonsai(['check', '--serial', '--no-report'])
    assert.equal(stale.exitCode, 2, JSON.stringify(stale))
    assert.equal(stale.decision.status, 'incomplete')
    assert.equal(stale.snapshot.evidence, undefined)
    assert.equal(existsSync(join(root, 'application-loaded')), false)
    assert.equal(existsSync(join(root, 'handler-executed')), false)
    assert.deepEqual(readFileSync(join(root, 'jig.lock')), approval)

    // Approve the changed source explicitly; the same requirement must now fail
    // on its real returned value, independently of the stale-approval guard.
    run(jig, ['review', '--yes'])
    const fault = bonsai(['check', '--serial', '--no-report'])
    assert.equal(fault.exitCode, 1, JSON.stringify(fault))
    assert.equal(fault.decision.status, 'reject')
    assert.deepEqual(fault.snapshot.source.problems, [])
    assert.deepEqual(fault.snapshot.unrooted, [])
    assert.equal(fault.snapshot.evidence.complete, true)
    assert.deepEqual(
      fault.snapshot.evidence.checks.map((check: { status: string }) => check.status),
      ['failed'],
    )
    assert.equal(existsSync(join(root, 'handler-executed')), true)
    assert.deepEqual(readFileSync(join(root, 'bonsai.json')), rules)
    assert.deepEqual(readFileSync(join(root, 'flows/pilot/bun.lock')), flowLock)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
  }
})
