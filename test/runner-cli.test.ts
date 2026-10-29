import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkSupportingSuite } from '../features/support/runners.ts'
import { compileContracts } from '../src/contracts.ts'
import { fingerprint } from '../src/inventory.ts'
import { sameExecutionIdentity } from '../src/identity.ts'
import { runEvidence } from '../src/evidence.ts'
import { parseSnapshot } from '../src/snapshot-schema.ts'
import { readConfig } from '../src/project.ts'
import { createProject } from './project.ts'
import { runCli } from './cli.ts'
import { assumedIdentity } from './identity-fixture.ts'

test('real CLI supporting evidence stays distinct, versioned and bound to its execution context', () => {
  const report = checkSupportingSuite({ case: 'passed' })
  assert.equal(report.exitCode, 0)
  const snapshot = parseSnapshot(JSON.stringify(report.snapshot))
  assert.equal(snapshot.schema, 'bonsai-snapshot-v1')
  assert.equal(snapshot.evidence?.schema, 'bonsai-evidence-v2')
  assert.equal(snapshot.evidence?.checks.length, 1)
  assert.equal(snapshot.runnerEvidence?.length, 1)
  const supporting = snapshot.runnerEvidence![0]!
  assert.equal(supporting.adapter, 'vitest-json')
  assert.equal(supporting.status, 'passed')
  assert.equal(supporting.total, 1)
  assert.equal(supporting.fingerprint, snapshot.fingerprint)
  assert.equal(sameExecutionIdentity(snapshot.identity, supporting.identity), true)
  assert.equal(sameExecutionIdentity(snapshot.identity, snapshot.evidence?.identity), true)
})

test('read-only inspection never launches configured supporting commands', () => {
  const project = createProject({
    'app.ts': "export function ready() { return { status: 'ok' } }\n",
    'bindings.ts': "import { ready } from './app.ts'\nexport const actions = { ready: ready }\n",
    'ready.feature':
      'Feature: Ready\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
  })
  try {
    const config = readConfig(project.root)
    config.runners = [
      {
        id: 'unit',
        adapter: 'vitest-json',
        report: 'output.json',
        command: [
          process.execPath,
          '-e',
          "require('node:fs').writeFileSync('runner-ran', 'unexpected')",
        ],
      },
    ]
    writeFileSync(join(project.root, 'bonsai.json'), JSON.stringify(config))
    const result = runCli(['explain', 'app.ts#ready', '--root', project.root, '--json'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(existsSync(join(project.root, 'runner-ran')), false)
    assert.equal(existsSync(join(project.root, 'output.json')), false)
  } finally {
    project.dispose()
  }
})

test('a different expected checker identity blocks the worker before loading its binding', async () => {
  const text =
    'Feature: Ready\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n'
  const project = createProject({
    'bindings.ts':
      "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('./binding-loaded', import.meta.url), 'unexpected')\nexport function ready() { return { status: 'ok' } }\nexport const actions = { ready: ready }\n",
    'ready.feature': text,
  })
  try {
    const config = readConfig(project.root)
    const contracts = compileContracts([{ file: 'ready.feature', text }])
    await assert.rejects(
      runEvidence(
        project.root,
        config,
        contracts,
        fingerprint(project.root, project.files, config),
        15000,
        undefined,
        { profile: 'in-process-v1', workers: 1 },
        assumedIdentity,
      ),
      /checker or toolchain identity changed/,
    )
    assert.equal(existsSync(join(project.root, 'binding-loaded')), false)
  } finally {
    project.dispose()
  }
})
