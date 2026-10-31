import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshot } from '../src/project.ts'
import type { Config } from '../src/model.ts'

function fixture(handler: string) {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-imports-'))
  writeFileSync(join(root, 'package.json'), '{"type":"module"}')
  writeFileSync(join(root, 'handler.ts'), handler)
  writeFileSync(
    join(root, 'format.ts'),
    `export function format() { return { status: 'ok' } }
export function unused() { return 42 }
`,
  )
  writeFileSync(
    join(root, 'bindings.ts'),
    `import { handle } from './handler.ts'
export const actions = { 'handle': handle }
`,
  )
  writeFileSync(
    join(root, 'behavior.feature'),
    `Feature: Loading
Scenario: Handle
 When I invoke "handle" with {}
 Then response "status" equals "ok"
`,
  )
  const config: Config = {
    maintained: ['package.json', 'handler.ts', 'format.ts', 'bindings.ts', 'behavior.feature'],
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

test('literal dynamic imports trace selected named and aliased exports without rooting siblings', async () => {
  for (const declaration of [
    "const { format } = await import('./format.ts'); return format()",
    "const { format: render } = await import('./format.ts'); return render()",
    "const module = await import('./format.ts'); return module.format()",
    "const module = await import('./format.ts'); return module['format']()",
    "return (await import('./format.ts'))['format']()",
  ]) {
    const { root, config, dispose } = fixture(`export async function handle() { ${declaration} }`)
    try {
      const candidate = await snapshot(root, config, false)
      assert.deepEqual(candidate.source.problems, [])
      assert.ok(candidate.ancestry['format.ts#format']?.length)
      assert.ok(candidate.unrooted.includes('format.ts#unused'))
    } finally {
      dispose()
    }
  }
})

test('literal dynamic imports still require their local module in the inventory', async () => {
  const { root, config, dispose } = fixture(
    "export async function handle() { return (await import('./format.ts')).format() }",
  )
  try {
    config.maintained = config.maintained.filter((file) => file !== 'format.ts')
    const candidate = await snapshot(root, config, false)
    assert.ok(
      candidate.source.problems.some((problem) =>
        problem.includes('outside maintained inventory: format.ts'),
      ),
    )
  } finally {
    dispose()
  }
})

test('computed imports stay incomplete and identify the actual expression and source location', async () => {
  const { root, config, dispose } = fixture(`const modulePath = './format.ts'
export async function handle() { return (await import(modulePath)).format() }
`)
  try {
    const candidate = await snapshot(root, config, false)
    const problem = candidate.source.problems.find((problem) =>
      problem.startsWith('Dynamic import requires an adapter:'),
    )
    assert.match(problem ?? '', /handler\.ts#handle at handler\.ts:2:\d+ — import\(modulePath\)/)
    assert.ok(candidate.unrooted.includes('format.ts#format'))
  } finally {
    dispose()
  }
})

test('computed namespace selections remain incomplete instead of justifying every export', async () => {
  const { root, config, dispose } = fixture(
    "export async function handle(input: { name: 'format' | 'unused' }) { const module = await import('./format.ts'); return module[input.name]() }",
  )
  try {
    const candidate = await snapshot(root, config, false)
    assert.ok(
      candidate.source.problems.some((problem) =>
        problem.startsWith('Unsupported dynamic import selection:'),
      ),
    )
    assert.ok(candidate.unrooted.includes('format.ts#unused'))
  } finally {
    dispose()
  }
})
