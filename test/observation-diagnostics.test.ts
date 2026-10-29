import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { compileContracts } from '../src/contracts.ts'
import { runEvidence } from '../src/evidence.ts'
import { checkReport } from '../src/check-report.ts'
import { fingerprint, inventory } from '../src/inventory.ts'
import type { Snapshot } from '../src/model.ts'
import { evaluate } from '../src/policy.ts'
import { readConfig } from '../src/project.ts'
import { cliEnvironment, executable, runCli } from './cli.ts'
import { createProject } from './project.ts'
import { characters } from './terminal.ts'

const requirement = `Feature: Observe a command result
Scenario: An expected result
 When I invoke "probe" with {}
 Then response "exitCode" equals 0
 And response "decision.status" equals "pass"
 And response "decision.ceiling" equals 100
`

function fixture(handler: string, text = requirement) {
  return createProject({
    'package.json': '{"type":"module"}',
    'handler.ts': handler,
    'bindings.ts':
      "import { probe } from './handler.ts'\nexport const actions = { 'probe': probe }\n",
    'result.feature': text,
  })
}

async function evidence(root: string) {
  const config = readConfig(root)
  const files = inventory(root, config.maintained, config.exclude)
  const text = readFileSync(join(root, 'result.feature'), 'utf8')
  const contracts = compileContracts([{ file: 'result.feature', text }])
  return runEvidence(root, config, contracts, fingerprint(root, files, config), 15000)
}

test('a rejected observation retains the nested CLI cause without repeating its response for every field', () => {
  const project = fixture(`import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const entry = ${JSON.stringify(executable)}
export function probe() {
 const root = fileURLToPath(new URL('./missing-project', import.meta.url))
 const result = spawnSync(process.execPath, [entry, 'config', 'show', '--root', root, '--json'], { encoding:'utf8' })
 if (result.error) throw result.error
 return { exitCode: result.status, ...JSON.parse(result.stdout || result.stderr) }
}
`)
  try {
    const machine = runCli(['check', '--root', project.root, '--json'])
    assert.equal(machine.error, undefined)
    assert.equal(machine.status, 1, machine.stdout || machine.stderr)
    assert.equal(machine.stderr, '')
    const report = JSON.parse(machine.stdout)
    assert.equal(report.snapshot.evidence.complete, true)
    const checks = report.snapshot.evidence.checks
    assert.equal(checks.length, 3)
    assert.deepEqual(
      checks.map((check: { status: string }) => check.status),
      ['failed', 'failed', 'failed'],
    )
    for (const check of checks) {
      assert.match(check.response, /Configuration not found/)
      assert.match(check.response, /missing-project/)
      assert.match(check.response, /CONFIG/)
      assert.match(check.response, /run:/)
    }
    assert.match(checks[0].error, /2 !== 0/)
    assert.match(checks[1].error, /Missing response field: decision.status/)

    for (const extra of [['--quiet'], ['--verbose']]) {
      const result = runCli(['check', '--root', project.root, '--output', 'human', ...extra], {
        env: cliEnvironment({
          FORCE_COLOR: '1',
          NO_COLOR: '',
          COLUMNS: '32',
          TERM: 'xterm-256color',
        }),
      })
      assert.equal(result.status, 1, result.stderr)
      assert.equal(result.stdout, '')
      const plain = stripVTControlCharacters(result.stderr)
      assert.match(plain.replace(/\s+/g, ' '), /3 required observations failed/)
      assert.equal(plain.match(/Returned:/g)?.length, 1)
      assert.match(plain.replace(/\s+/g, ' '), /Configuration not found/)
      assert.match(plain, /bonsai\.json/)
      assert.doesNotMatch(plain, /Restore the required handler behavior/)
      assert.match(plain.replace(/\s+/g, ' '), /returned response|returned cause/i)
      const visible = characters(result.stderr)
      const start = visible
        .map((character) => character.value)
        .join('')
        .indexOf('3 required')
      assert.ok(start >= 0)
      for (const character of visible
        .slice(start, start + '3 required'.length)
        .filter((character) => character.value.trim())) {
        assert.equal(character.color, 31)
        assert.equal(character.dim, false)
      }
    }
  } finally {
    project.dispose()
  }
})

test('normal error-valued responses can pass and thrown actions still report their actual cause', async () => {
  const text = `Feature: Expected errors are observable results
Scenario: A normal returned error
 When I invoke "probe" with {"throws":false}
 Then response "status" equals "incomplete"
 And response "error" equals "The requested item is absent"
Scenario: A thrown action
 When I invoke "probe" with {"throws":true}
 Then response "status" equals "ok"
 And response "error" equals "none"
Scenario: A later required action still runs
 When I invoke "probe" with {"throws":false}
 Then response "status" equals "incomplete"
`
  const project = fixture(
    `export function probe(input: { throws: boolean }) {
 if (input.throws) throw new Error('The child command did not start')
 return { status:'incomplete', error:'The requested item is absent' }
}
`,
    text,
  )
  try {
    const result = await evidence(project.root)
    assert.equal(result.complete, true)
    assert.deepEqual(
      result.checks.map((check) => check.status),
      ['passed', 'passed', 'failed', 'failed', 'passed'],
    )
    for (const check of result.checks.filter((check) => check.status === 'passed'))
      assert.equal(Object.hasOwn(check, 'response'), false)
    for (const check of result.checks.filter((check) => check.status === 'failed')) {
      assert.match(check.error!, /The child command did not start/)
      assert.equal(Object.hasOwn(check, 'response'), false)
    }
  } finally {
    project.dispose()
  }
})

test('response previews stay bounded and do not run accessors, custom inspectors, or proxy traps', async () => {
  const project = fixture(`import { writeFileSync } from 'node:fs'
export function probe() {
 const touched = () => writeFileSync(new URL('./inspected', import.meta.url), 'unexpected')
 const response: Record<string | symbol, unknown> = { status:'blocked', message:'😀'.repeat(10000) }
 response.self = response
 Object.defineProperty(response, 'dangerous', { enumerable:true, get() { touched(); return 'unexpected' } })
 response[Symbol.for('nodejs.util.inspect.custom')] = () => { touched(); return 'unexpected' }
 response.proxy = new Proxy({}, { ownKeys() { touched(); return [] } })
 return response
}
`)
  try {
    const result = await evidence(project.root)
    assert.equal(result.complete, true)
    assert.ok(result.checks.every((check) => check.status === 'failed'))
    for (const check of result.checks as { response?: string }[]) {
      assert.equal(typeof check.response, 'string')
      assert.ok(Buffer.byteLength(check.response!) <= 2048)
      assert.match(check.response!, /Circular|reference/i)
      assert.doesNotMatch(check.response!, /\uFFFD/)
    }
    assert.equal(existsSync(join(project.root, 'inspected')), false)
  } finally {
    project.dispose()
  }
})

test('response previews visibly mark field, array, depth, and visit truncation below the text limit', async () => {
  const text = `Feature: Bounded diagnostic previews
Scenario Outline: A response with more data than the preview
 When I invoke "probe" with {"kind":"<kind>"}
 Then response "missing" equals true
 Examples:
 | kind |
 | fields |
 | array |
 | depth |
 | visits |
`
  const project = fixture(
    `export function probe(input: {kind: string}) {
 if (input.kind === 'fields') return Object.fromEntries(Array.from({length:9}, (_,index) => ['v' + index, index]))
 if (input.kind === 'array') return Array.from({length:6}, (_,index) => index)
 if (input.kind === 'depth') return { a:{ b:{ c:1 } } }
 return Object.fromEntries(Array.from({length:8}, (_,index) => ['v' + index, { a:1,b:2,c:3,d:4,e:5,f:6,g:7,h:8 }]))
}
`,
    text,
  )
  try {
    const result = await evidence(project.root)
    assert.equal(result.complete, true)
    assert.equal(result.checks.length, 4)
    for (const check of result.checks) {
      assert.equal(check.status, 'failed')
      assert.ok(check.response!.length < 512)
      assert.match(check.response!, /…$/)
    }
  } finally {
    project.dispose()
  }
})

test('large incidental symbols, integers, and property names do not hide a short returned cause', async () => {
  const project = fixture(`export function probe() {
 const key = 'incidental-' + 'k'.repeat(10000)
 return {
  symbol:Symbol('description-'.repeat(10000)),
  integer:10n ** 10000n,
  [key]:'irrelevant',
  error:'The nested command could not read its configuration',
  run:'Repair the missing configuration'
 }
}
`)
  try {
    const result = await evidence(project.root)
    assert.equal(result.complete, true)
    for (const check of result.checks) {
      assert.equal(check.status, 'failed')
      assert.ok(Buffer.byteLength(check.response!) <= 2048)
      assert.match(check.response!, /The nested command could not read its configuration/)
      assert.match(check.response!, /Repair the missing configuration/)
      assert.match(check.response!, /\[Symbol\]/)
      assert.match(check.response!, /\[BigInt\]/)
      assert.match(check.response!, /…$/)
    }
  } finally {
    project.dispose()
  }
})

test('failure grouping distinguishes repeated action occurrences and bounds shown observations', async () => {
  const text = `Feature: Separate returned contexts
Scenario: Two calls of the same action
 When I invoke "probe" with {"tag":"first"}
 Then response "status" equals "ok"
 And response "missing" equals true
 When I invoke "probe" with {"tag":"second"}
 Then response "status" equals "ok"
 And response "missing" equals true
`
  const project = fixture(
    `export function probe(input: {tag:string}) {
 return { status:'blocked', context:input.tag }
}
`,
    text,
  )
  try {
    const result = await evidence(project.root)
    const contracts = compileContracts([{ file: 'result.feature', text }])
    // Presentation receives the real evidence; full source analysis is exercised
    // by the nested-CLI test above, rather than duplicated in this unit regression.
    const snapshot: Snapshot = {
      schema: 'bonsai-snapshot-v1',
      identity: result.identity,
      fingerprint: result.fingerprint,
      contracts,
      source: {
        files: [],
        components: [],
        relationships: [],
        actions: { probe: 'handler.ts#probe' },
        problems: [],
      },
      ancestry: {},
      unrooted: [],
      evidence: result,
    }
    const decision = evaluate(undefined, snapshot, readConfig(project.root).policy)
    const report = (limit: number) =>
      checkReport(snapshot, decision, {
        bindings: 'bindings.ts',
        verbose: false,
        limit,
        invocation: (words) => words.join(' '),
      })
        .lines.map((line) => (typeof line === 'string' ? line : line.text))
        .join('\n')
    const complete = report(0)
    assert.equal(complete.match(/Returned:/g)?.length, 2)
    assert.match(complete, /context: 'first'/)
    assert.match(complete, /context: 'second'/)
    const limited = report(1)
    assert.equal(limited.match(/Returned:/g)?.length, 1)
    assert.match(limited, /3 more failed observations/)
    assert.doesNotMatch(limited, /context: 'second'/)
    assert.deepEqual(
      result.checks.map((check) => check.id),
      contracts.checks.map((check) => check.id),
    )
    assert.ok(result.checks.every((check) => check.status === 'failed'))
  } finally {
    project.dispose()
  }
})
