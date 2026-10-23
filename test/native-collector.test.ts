import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { binaryPath } from '../native/tools/client.ts'
import { compareCases } from '../native/tools/compare.ts'
import { snapshot } from '../src/project.ts'
import { countTokens } from '../src/source.ts'
import type { Config } from '../src/model.ts'

// CI builds the prototype before Bun tests; Bun-only checkouts use native:compare explicitly.
test('native collector preserves structural facts without claiming TypeScript diagnostics', {
  skip: !existsSync(binaryPath()),
}, () => {
  const report = compareCases()
  assert.equal(report.mismatches, 0, JSON.stringify(report, null, 2))
  assert.ok(report.matched >= 11)
  assert.ok(report.unsupported >= 6)
  assert.equal(report.nativeTypeScriptDiagnostics, 'not-run')
  assert.equal(report.handlersRun, false)
})

test('native protocol rejects invalid requests and recovers for the next request', {
  skip: !existsSync(binaryPath()),
}, () => {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/native-protocol-'))
  try {
    writeFileSync(join(root, 'handler.ts'), 'export function handle() { return 42 }\n')
    writeFileSync(
      join(root, 'bindings.ts'),
      "import { handle } from './handler.ts'\nexport const actions = { handle: handle }\n",
    )
    const request = {
      protocol: 1,
      root,
      files: ['bindings.ts', 'handler.ts'],
      bindings: 'bindings.ts',
    }
    const input =
      [
        '{',
        JSON.stringify({ ...request, protocol: 2 }),
        JSON.stringify({ ...request, unknown: true }),
        JSON.stringify({ ...request, files: ['../outside.ts'] }),
        JSON.stringify(request),
      ].join('\n') + '\n'
    const result = spawnSync(binaryPath(), [], { input, encoding: 'utf8', timeout: 30000 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    const responses = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.equal(responses.length, 5)
    for (const response of responses.slice(0, 4)) {
      assert.equal(response.protocol, 1)
      assert.equal(typeof response.error, 'string')
      assert.equal(response.source, undefined)
    }
    assert.match(responses[3].error, /escapes root/)
    assert.equal(responses[4].structuralComplete, true)
    assert.equal(responses[4].typescriptDiagnostics, 'not-run')
    assert.deepEqual(responses[4].source.actions, { handle: 'handler.ts#handle' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('maintained Rust source is charged and blocks unsupported ancestry before verification', async () => {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/native-inventory-'))
  try {
    const rust = 'pub fn unused() -> u32 { 42 }\n'
    writeFileSync(join(root, 'core.rs'), rust)
    writeFileSync(
      join(root, 'handler.ts'),
      "export function handle() { throw new Error('must not run') }\n",
    )
    writeFileSync(
      join(root, 'bindings.ts'),
      "import { handle } from './handler.ts'\nexport const actions = { handle: handle }\n",
    )
    writeFileSync(
      join(root, 'behavior.feature'),
      'Feature: Inventory\nScenario: Handle\n When I invoke "handle" with {}\n Then response "value" equals 42\n',
    )
    const config: Config = {
      maintained: ['core.rs', 'handler.ts', 'bindings.ts', 'behavior.feature'],
      bindings: 'bindings.ts',
      policy: {
        bootstrap: 1000,
        bootstrapSurface: 1,
        perDoubling: 0,
        hardLimit: 1000,
        maxFeedbackMs: 15000,
      },
    }
    const candidate = await snapshot(root, config)
    assert.deepEqual(candidate.source.problems, ['Unsupported source language: core.rs'])
    assert.equal(
      candidate.source.files.find((file) => file.file === 'core.rs')?.tokens,
      countTokens(rust),
    )
    assert.equal(candidate.evidence, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
