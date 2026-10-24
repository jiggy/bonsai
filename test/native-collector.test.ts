import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compareCases } from '../native/tools/compare.ts'
import { snapshot } from '../src/project.ts'
import { countTokens } from '../src/source.ts'
import type { Config } from '../src/model.ts'

test('native TypeScript diagnostics and source facts match the reference fixture corpus', {
  timeout: 60000,
}, async () => {
  const report = await compareCases()
  assert.equal(report.mismatches, 0, JSON.stringify(report, null, 2))
  assert.equal(report.matched, 17)
  assert.ok(report.incomplete >= 4)
  assert.equal(report.nativeCompiler, 'tsrs')
  assert.equal(report.handlersRun, false)
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
    for (const engine of ['typescript', 'rust'] as const) {
      const candidate = await snapshot(root, config, true, undefined, undefined, engine)
      assert.deepEqual(candidate.source.problems, ['Unsupported source language: core.rs'])
      assert.equal(
        candidate.source.files.find((file) => file.file === 'core.rs')?.tokens,
        countTokens(rust),
      )
      assert.equal(candidate.evidence, undefined)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
