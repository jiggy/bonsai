import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { snapshot, readConfig } from '../src/project.ts'
import type { Config } from '../src/model.ts'

function fixture(registry: string) {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-bindings-'))
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  writeFileSync(
    join(root, 'handler.ts'),
    `export function handler() { return { status: 'ok' } }
export function unused() { return 42 }
`,
  )
  writeFileSync(join(root, 'bindings.ts'), `import { handler } from './handler.ts'\n${registry}\n`)
  writeFileSync(
    join(root, 'behavior.feature'),
    `Feature: Bindings
Scenario: Handle
 When I invoke "sample" with {}
 Then response "status" equals "ok"
`,
  )
  const config: Config = {
    maintained: ['package.json', 'handler.ts', 'bindings.ts', 'behavior.feature'],
    bindings: 'bindings.ts',
    policy: {
      bootstrap: 1000,
      bootstrapSurface: 1,
      perDoubling: 0,
      hardLimit: 1000,
      maxFeedbackMs: 15000,
    },
  }
  return { root, config, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

test('unquoted static registry keys resolve identically to quoted keys and preserve unused symbols', async () => {
  for (const key of ['sample', "'sample'"]) {
    const { root, config, dispose } = fixture(`export const actions = { ${key}: handler }`)
    try {
      const candidate = await snapshot(root, config, false)
      assert.deepEqual(candidate.source.problems, [])
      assert.equal(candidate.source.actions.sample, 'handler.ts#handler')
      assert.ok(candidate.ancestry['handler.ts#handler']?.length)
      assert.ok(candidate.unrooted.includes('handler.ts#unused'))
    } finally {
      dispose()
    }
  }
})

test('computed keys, spreads, and inline handlers remain unsupported registry forms', async () => {
  for (const registry of [
    "const key = 'sample'; export const actions = { [key]: handler }",
    'const entries = { sample: handler }; export const actions = { ...entries }',
    'export const actions = { sample: () => handler() }',
  ]) {
    const { root, config, dispose } = fixture(registry)
    try {
      const candidate = await snapshot(root, config, false)
      assert.ok(
        candidate.source.problems.includes(
          'Each action binding must be a literal key and named handler',
        ),
      )
      assert.equal(Object.hasOwn(candidate.source.actions, 'sample'), false)
    } finally {
      dispose()
    }
  }
})

test('Bonsai recognizes every action in its formatter-produced own registry', async () => {
  const root = resolve('.')
  const config = readConfig(root)
  const { source } = await snapshot(root, config, false)
  const { actions } = await import('../bonsai.bindings.ts')
  assert.deepEqual(Object.keys(source.actions).sort(), Object.keys(actions).sort())
  assert.equal(Object.keys(source.actions).length, 8)
  assert.ok(
    !source.problems.includes('Each action binding must be a literal key and named handler'),
  )
})
