import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compileContracts } from '../src/contracts.ts'
import { runEvidence } from '../src/evidence.ts'
import { fingerprint, inventory } from '../src/source.ts'
import type { Config } from '../src/model.ts'

test('verification loads and checks a measured handler without loading the TypeScript compiler', async () => {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/inventory-worker-'))
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    writeFileSync(
      join(root, 'handler.ts'),
      `import { createRequire } from 'node:module'
export function inspect() {
  const modules = Object.keys(createRequire(import.meta.url).cache)
  return { compilerLoaded: modules.some((file) => /[/\\\\]typescript[/\\\\]lib[/\\\\]typescript\\.js$/.test(file)) }
}
`,
    )
    writeFileSync(
      join(root, 'bindings.ts'),
      "import { inspect } from './handler.ts'\nexport const actions = { inspect }\n",
    )
    const text = `Feature: Verification worker
Scenario: Keep inventory independent of the compiler
 When I invoke "inspect" with {}
 Then response "compilerLoaded" equals false
`
    writeFileSync(join(root, 'worker.feature'), text)
    const contracts = compileContracts([{ file: 'worker.feature', text }])
    assert.deepEqual(contracts.problems, [])
    const config: Config = {
      maintained: ['package.json', 'handler.ts', 'bindings.ts', 'worker.feature'],
      bindings: 'bindings.ts',
      policy: {
        bootstrap: 1000,
        bootstrapSurface: 1,
        perDoubling: 0,
        hardLimit: 1000,
        maxFeedbackMs: 15000,
      },
    }
    const hash = fingerprint(root, inventory(root, config.maintained), config)
    const evidence = await runEvidence(root, config, contracts, hash, config.policy.maxFeedbackMs)
    assert.equal(evidence.complete, true)
    assert.equal(evidence.checks.length, 1)
    assert.deepEqual(
      evidence.checks.map((check) => check.status),
      ['passed'],
      JSON.stringify(evidence.checks),
    )
    assert.deepEqual(evidence.bindingImport, {
      adapter: 'project-bindings-v1',
      file: config.bindings,
      fingerprint: hash,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
