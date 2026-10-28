import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { availableParallelism } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { compileContracts } from '../src/contracts.ts'
import { runEvidence } from '../src/evidence.ts'
import { fingerprint, inventory } from '../src/inventory.ts'
import { readConfig } from '../src/project.ts'
import type { Config, Contracts, Evidence, Verification } from '../src/model.ts'
import { createProject } from './project.ts'

async function until(predicate: () => boolean, description: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    assert.ok(Date.now() < deadline, description)
    await delay(5)
  }
}

function identity(root: string, config: Config) {
  return fingerprint(root, inventory(root, config.maintained, config.exclude), config)
}

function fulfilled(evidence: Evidence, contracts: Contracts) {
  assert.equal(evidence.complete, true)
  assert.deepEqual(
    evidence.checks,
    contracts.checks.map((check) => ({ id: check.id, status: 'passed' })),
  )
}

function isolated(workers = 2): Verification {
  return { profile: 'isolated-scenarios-v1', workers }
}

test('serial verification shares scenario state; default isolated scenarios retain step order with fresh modules', async () => {
  const fixture = createProject({
    'package.json': '{"type":"module"}',
    'handler.ts': 'let count = 0\nexport function increment() { return { count: ++count } }',
    'bindings.ts': "import { increment } from './handler.ts'\nexport const actions = { increment }",
    'state.feature': '',
  })
  try {
    const contracts = (second: number, first = 1) => {
      const text = `Feature: Stateful execution
Scenario: Multiple actions retain their order
 When I invoke "increment" with {}
 Then response "count" equals ${first}
 When I invoke "increment" with {}
 Then response "count" equals 2
Scenario: Another scenario
 When I invoke "increment" with {}
 Then response "count" equals ${second}
`
      writeFileSync(join(fixture.root, 'state.feature'), text)
      return compileContracts([{ file: 'state.feature', text }])
    }
    const config = readConfig(fixture.root)
    for (let run = 0; run < 2; run++) {
      const required = contracts(3)
      const evidence = await runEvidence(
        fixture.root,
        config,
        required,
        identity(fixture.root, config),
        15000,
        undefined,
        { profile: 'in-process-v1', workers: 1 },
      )
      assert.equal(evidence.profile, 'in-process-v1')
      fulfilled(evidence, required)
    }
    for (const workers of [undefined, 1, 2]) {
      const required = contracts(1)
      const hash = identity(fixture.root, config)
      const evidence = await runEvidence(
        fixture.root,
        config,
        required,
        hash,
        15000,
        undefined,
        workers === undefined ? undefined : isolated(workers),
      )
      assert.equal(evidence.profile, 'isolated-scenarios-v1')
      fulfilled(evidence, required)
      assert.equal(evidence.fingerprint, hash)
      assert.deepEqual(evidence.bindingImport, {
        adapter: 'project-bindings-v1',
        file: config.bindings,
        fingerprint: hash,
      })
    }
    const required = contracts(1, 99)
    const failed = await runEvidence(
      fixture.root,
      config,
      required,
      identity(fixture.root, config),
      15000,
      undefined,
      isolated(1),
    )
    assert.equal(failed.complete, true)
    assert.deepEqual(
      failed.checks.map((check) => check.id),
      required.checks.map((check) => check.id),
    )
    assert.deepEqual(
      failed.checks.map((check) => check.status),
      ['failed', 'passed', 'passed'],
    )
  } finally {
    fixture.dispose()
  }
})

function blockingProject(count = 4, crash = false, descendants = false) {
  const text =
    'Feature: Independent blocking actions\n' +
    Array.from(
      { length: count },
      (_, id) => `Scenario: Case ${id}
 When I invoke "block" with {"id":${id}}
 Then response "id" equals ${id}
`,
    ).join('\n')
  const fixture = createProject({
    'package.json': '{"type":"module"}',
    'handler.ts': `import { existsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const wait = new Int32Array(new SharedArrayBuffer(4))
export function block(input: { id: number }) {
  const file = (name: string) => fileURLToPath(new URL(name, import.meta.url))
  writeFileSync(file('started-' + input.id), String(process.pid))
  ${descendants ? "spawnSync(process.execPath, [file('descendant.ts'), file('descendant-' + input.id)], { stdio: 'ignore' })" : ''}
  ${crash ? "if (input.id === 0) { while (!existsSync(file('started-1'))) Atomics.wait(wait, 0, 0, 5); process.exit(17) }" : ''}
  while (!existsSync(file('release-' + input.id))) Atomics.wait(wait, 0, 0, 5)
  writeFileSync(file('finished-' + input.id), 'done')
  return { id: input.id }
}`,
    'bindings.ts': "import { block } from './handler.ts'\nexport const actions = { block }",
    'descendant.ts': `import { writeFileSync } from 'node:fs'
writeFileSync(process.argv[2]!, String(process.pid))
const wait = new Int32Array(new SharedArrayBuffer(4))
while (true) Atomics.wait(wait, 0, 0, 1000)
`,
    'concurrent.feature': text,
  })
  const contracts = compileContracts([{ file: 'concurrent.feature', text }])
  const config = readConfig(fixture.root)
  const started = () => readdirSync(fixture.root).filter((name) => name.startsWith('started-'))
  const stopped = () => {
    for (const file of started()) {
      const pid = Number(readFileSync(join(fixture.root, file), 'utf8'))
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `Worker ${pid} is still alive`)
    }
  }
  return { ...fixture, contracts, config, started, stopped }
}

test('isolated verification queues larger scenarios first and retains authored checks and equal-size order', async () => {
  const fixture = blockingProject()
  const text = `Feature: Unequal independent journeys
Scenario: Earlier small case
 When I invoke "block" with {"id":0}
 Then response "id" equals 0
Scenario: Another small case
 When I invoke "block" with {"id":1}
 Then response "id" equals 1
Scenario: Later larger journey
 When I invoke "block" with {"id":2}
 Then response "id" equals 2
 When I invoke "block" with {"id":3}
 Then response "id" equals 3
`
  writeFileSync(join(fixture.root, 'concurrent.feature'), text)
  const contracts = compileContracts([{ file: 'concurrent.feature', text }])
  const cancellation = new AbortController()
  const pending = runEvidence(
    fixture.root,
    fixture.config,
    contracts,
    identity(fixture.root, fixture.config),
    15000,
    cancellation.signal,
    isolated(1),
  )
  void pending.catch(() => {})
  try {
    const started: string[] = []
    for (const id of [2, 3, 0, 1]) {
      await until(
        () => existsSync(join(fixture.root, `started-${id}`)),
        `The next action must be input ${id}`,
      )
      started.push(`started-${id}`)
      assert.deepEqual(fixture.started().sort(), [...started].sort())
      writeFileSync(join(fixture.root, `release-${id}`), 'go')
    }
    const evidence = await pending
    fulfilled(evidence, contracts)
    assert.equal(evidence.profile, 'isolated-scenarios-v1')
    const pids = fixture.started().map((file) => readFileSync(join(fixture.root, file), 'utf8'))
    assert.equal(new Set(pids).size, 3, 'Each scenario must have its own application process')
    fixture.stopped()
  } finally {
    cancellation.abort()
    await pending.catch(() => {})
    fixture.dispose()
  }
})

test('default verification uses available CPU capacity and never starts more workers than scenarios', async () => {
  const count = Math.min(6, availableParallelism() + 1)
  const active = Math.min(availableParallelism(), count)
  const fixture = blockingProject(count)
  const cancellation = new AbortController()
  const pending = runEvidence(
    fixture.root,
    fixture.config,
    fixture.contracts,
    identity(fixture.root, fixture.config),
    15000,
    cancellation.signal,
  )
  void pending.catch(() => {})
  try {
    await until(
      () => fixture.started().length === active,
      'The default must fill its CPU-sized scenario pool',
    )
    assert.deepEqual(
      fixture.started().sort(),
      Array.from({ length: active }, (_, id) => `started-${id}`).sort(),
    )
    for (let id = 0; id < count; id++) writeFileSync(join(fixture.root, `release-${id}`), 'go')
    const evidence = await pending
    fulfilled(evidence, fixture.contracts)
    assert.equal(evidence.profile, 'isolated-scenarios-v1')
    const pids = fixture.started().map((file) => readFileSync(join(fixture.root, file), 'utf8'))
    assert.equal(new Set(pids).size, count)
    fixture.stopped()
  } finally {
    cancellation.abort()
    await pending.catch(() => {})
    fixture.dispose()
  }
})

test('isolated verification overlaps synchronous actions, bounds workers, and reports contract order', async () => {
  const fixture = blockingProject()
  const cancellation = new AbortController()
  const pending = runEvidence(
    fixture.root,
    fixture.config,
    fixture.contracts,
    identity(fixture.root, fixture.config),
    15000,
    cancellation.signal,
    isolated(),
  )
  void pending.catch(() => {})
  try {
    await until(() => fixture.started().length === 2, 'Two synchronous actions must start together')
    assert.deepEqual(fixture.started().sort(), ['started-0', 'started-1'])
    // Keep case zero blocked while its peer finishes and receives further cases.
    // This proves the bound without a speed assertion and forces out-of-order completion.
    for (const id of [1, 2]) {
      writeFileSync(join(fixture.root, `release-${id}`), 'go')
      await until(
        () => existsSync(join(fixture.root, `started-${id + 1}`)),
        `Case ${id + 1} must replace the completed worker`,
      )
      assert.equal(
        fixture
          .started()
          .filter((file) => !existsSync(join(fixture.root, file.replace('started-', 'finished-'))))
          .length,
        2,
      )
    }
    writeFileSync(join(fixture.root, 'release-3'), 'go')
    await until(() => existsSync(join(fixture.root, 'finished-3')), 'The last case must finish')
    writeFileSync(join(fixture.root, 'release-0'), 'go')
    const evidence = await pending
    fulfilled(evidence, fixture.contracts)
    assert.equal(evidence.profile, 'isolated-scenarios-v1')
    const pids = fixture.started().map((file) => readFileSync(join(fixture.root, file), 'utf8'))
    assert.equal(new Set(pids).size, 4, 'Every scenario must use a fresh execution process')
    fixture.stopped()
  } finally {
    cancellation.abort()
    await pending.catch(() => {})
    fixture.dispose()
  }
})

test('isolated verification stops every worker on the shared deadline or cancellation', async () => {
  for (const mode of ['deadline', 'cancel'] as const) {
    const fixture = blockingProject()
    const cancellation = new AbortController()
    const pending = runEvidence(
      fixture.root,
      fixture.config,
      fixture.contracts,
      identity(fixture.root, fixture.config),
      mode === 'deadline' ? 1500 : 15000,
      cancellation.signal,
      isolated(),
    )
    void pending.catch(() => {})
    try {
      await until(() => fixture.started().length === 2, 'Both bounded workers must start')
      if (mode === 'cancel') cancellation.abort()
      await assert.rejects(pending, mode === 'deadline' ? /deadline expired/ : /interrupted/)
      assert.deepEqual(fixture.started().sort(), ['started-0', 'started-1'])
      fixture.stopped()
      assert.ok(!readdirSync(fixture.root).some((file) => file.startsWith('finished-')))
    } finally {
      cancellation.abort()
      await pending.catch(() => {})
      fixture.dispose()
    }
  }
})

test('a crashed isolated worker aborts its peer and leaves queued scenarios unstarted', async () => {
  const fixture = blockingProject(4, true)
  try {
    await assert.rejects(
      runEvidence(
        fixture.root,
        fixture.config,
        fixture.contracts,
        identity(fixture.root, fixture.config),
        15000,
        undefined,
        isolated(),
      ),
      /worker exited|complete report/i,
    )
    assert.deepEqual(fixture.started().sort(), ['started-0', 'started-1'])
    fixture.stopped()
  } finally {
    fixture.dispose()
  }
})

function noLiveProcess(pid: number) {
  try {
    process.kill(pid, 0)
    if (process.platform === 'linux') {
      // An orphan killed with its parent can remain as a nonrunning zombie
      // until the host's init reaps it; that is distinct from a live leak.
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')
    }
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH' || code === 'ENOENT') return true
    throw error
  }
}

test('isolated cancellation and deadlines stop descendants of synchronous handlers', {
  skip: process.platform === 'win32' && 'Process-group cleanup requires Unix',
}, async () => {
  for (const mode of ['deadline', 'cancel'] as const) {
    const fixture = blockingProject(4, false, true)
    const cancellation = new AbortController()
    // First observe live descendants: this cleanup test needs startup margin
    // before its private deadline, which still includes all worker startup.
    const feedbackMs = mode === 'deadline' ? 5000 : 15000
    const pending = runEvidence(
      fixture.root,
      fixture.config,
      fixture.contracts,
      identity(fixture.root, fixture.config),
      feedbackMs,
      cancellation.signal,
      isolated(),
    )
    void pending.catch(() => {})
    try {
      await until(
        () => [0, 1].every((id) => existsSync(join(fixture.root, `descendant-${id}`))),
        'Both synchronous handlers must launch real descendants',
        Math.min(5000, feedbackMs - 1000),
      )
      const descendants = [0, 1].map((id) =>
        Number(readFileSync(join(fixture.root, `descendant-${id}`), 'utf8')),
      )
      for (const pid of descendants) assert.equal(noLiveProcess(pid), false)
      if (mode === 'cancel') cancellation.abort()
      await assert.rejects(pending, mode === 'deadline' ? /deadline expired/ : /interrupted/)
      fixture.stopped()
      await until(
        () => descendants.every(noLiveProcess),
        'Cancelling a scenario must stop its process-group descendants',
      )
      assert.deepEqual(fixture.started().sort(), ['started-0', 'started-1'])
    } finally {
      cancellation.abort()
      await pending.catch(() => {})
      fixture.dispose()
    }
  }
})

test('isolated verification rejects incomplete, mismatched, and malformed shard reports', async () => {
  const fixture = createProject({
    'package.json': '{"type":"module"}',
    'bindings.ts': `import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const fingerprint = new URL(import.meta.url).searchParams.get('snapshot')
function forge(input: { mode: string }) {
  const evidence: any = {
    fingerprint,
    profile: 'in-process-v1',
    complete: true,
    elapsedMs: 0,
    bindingImport: { adapter: 'project-bindings-v1', file: 'bindings.ts', fingerprint },
    checks: [{ id: 'protocol.feature:0:1', status: 'passed' }],
  }
  switch (input.mode) {
    case 'incomplete': evidence.complete = false; break
    case 'profile': evidence.profile = 'isolated-scenarios-v1'; break
    case 'fingerprint': evidence.fingerprint = 'another-candidate'; break
    case 'receipt': delete evidence.bindingImport; break
    case 'foreign': evidence.checks[0].id = 'another-scenario'; break
    case 'duplicate': evidence.checks.push(evidence.checks[0]); break
    case 'missing': evidence.checks = []; break
    case 'status': evidence.checks[0].status = 'missing'; break
    case 'response-type': evidence.checks[0].status = 'failed'; evidence.checks[0].response = {}; break
    case 'response-size': evidence.checks[0].status = 'failed'; evidence.checks[0].response = 'x'.repeat(2049); break
    case 'passed-response': evidence.checks[0].response = 'unrelated response'; break
  }
  // Exercise the local worker protocol validator, not a hostile-code boundary.
  process.send?.({ evidence })
  return { status: 'ok' }
}
function later() {
  writeFileSync(fileURLToPath(new URL('./later', import.meta.url)), 'executed')
  return { status: 'ok' }
}
export const actions = { forge, later }
`,
    'protocol.feature': '',
  })
  try {
    const config = readConfig(fixture.root)
    for (const mode of [
      'incomplete',
      'profile',
      'fingerprint',
      'receipt',
      'foreign',
      'duplicate',
      'missing',
      'status',
      'response-type',
      'response-size',
      'passed-response',
    ]) {
      const text = `Feature: Worker reports
Scenario: Invalid shard
 When I invoke "forge" with {"mode":${JSON.stringify(mode)}}
 Then response "status" equals "ok"
Scenario: Queued scenario
 When I invoke "later" with {}
 Then response "status" equals "ok"
`
      writeFileSync(join(fixture.root, 'protocol.feature'), text)
      const contracts = compileContracts([{ file: 'protocol.feature', text }])
      await assert.rejects(
        runEvidence(
          fixture.root,
          config,
          contracts,
          identity(fixture.root, config),
          15000,
          undefined,
          isolated(1),
        ),
        /Invalid isolated scenario evidence|Invalid or duplicate isolated scenario check|Missing isolated scenario checks/,
        mode,
      )
      assert.equal(existsSync(join(fixture.root, 'later')), false, mode)
    }
  } finally {
    fixture.dispose()
  }
})
