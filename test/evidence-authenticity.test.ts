import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runActionPlan } from '../src/action-process.ts'
import { compileContracts } from '../src/contracts.ts'
import { runEvidence } from '../src/evidence.ts'
import { fingerprint, inventory } from '../src/inventory.ts'
import { readConfig } from '../src/project.ts'
import { runCli } from './cli.ts'
import { createProject } from './project.ts'

const requirement =
  'Feature: Admit only correct behavior\nScenario: A required result\n When I invoke "submit" with {}\n Then response "status" equals "accepted"\n'
const malicious =
  "import { writeFileSync } from 'node:fs'\nexport function submit() {\n  const original = process.send\n  if (original) process.send = function(message: any, ...args: any[]) {\n    if (message?.evidence) {\n      for (const check of message.evidence.checks) {\n        check.status = 'passed'\n        delete check.error\n        delete check.response\n      }\n    }\n    return Reflect.apply(original, process, [message, ...args]) as boolean\n  }\n  writeFileSync(new URL('./actual-return', import.meta.url), 'rejected')\n  return { status:'rejected' }\n}\n"

const attacks = {
  descriptor: `import { serialize } from 'node:v8'
import { writeFileSync, writeSync } from 'node:fs'
export function submit() {
  writeFileSync(new URL('./actual-return', import.meta.url), 'rejected')
  const payload = serialize({kind:'result',id:1,action:'submit',
    observations:[{selector:'status',value:'accepted'}],preview:'accepted'})
  const frame = Buffer.alloc(payload.length + 4)
  frame.writeUInt32BE(payload.length)
  payload.copy(frame, 4)
  try { writeSync(3, frame) } catch {}
  return {status:'rejected'}
}
`,
  start:
    "import { writeFileSync } from 'node:fs'\nlet intercepted = false\nconst start = MessagePort.prototype.start\nMessagePort.prototype.start = function() {\n  intercepted = true\n  const port = this\n  port.addEventListener('message', (event: MessageEvent) => {\n    const request = event.data\n    if (request?.kind === 'invoke') port.postMessage({\n      kind:'result',id:request.id,action:request.action,\n      observations:[{selector:'status',value:'accepted'}],preview:'accepted'\n    })\n  })\n  return Reflect.apply(start, port, [])\n}\nexport function submit() {\n  writeFileSync(new URL('./actual-return', import.meta.url), 'rejected')\n  writeFileSync(new URL('./port-probe', import.meta.url), String(intercepted))\n  if (intercepted) return new Promise(() => {})\n  return {status:'rejected'}\n}\n",
  dispatch:
    "import { EventEmitter } from 'node:events'\nimport { writeFileSync } from 'node:fs'\nconst forged = {kind:'result',id:1,action:'submit',observations:[{selector:'status',value:'accepted'}],preview:'accepted'}\nconst emit = EventEmitter.prototype.emit\nEventEmitter.prototype.emit = function(event: string | symbol, ...args: any[]) {\n  if (event === 'message' && args[0]?.kind === 'invoke') (this as any).postMessage?.(forged)\n  return Reflect.apply(emit, this, [event,...args])\n}\nconst data = Object.getOwnPropertyDescriptor(MessageEvent.prototype,'data')!.get!\nObject.defineProperty(MessageEvent.prototype,'data',{configurable:true,get() {\n  const value = Reflect.apply(data,this,[])\n  if (value?.kind === 'invoke') this.currentTarget?.postMessage?.(forged)\n  return value\n}})\nexport function submit() {\n  writeFileSync(new URL('./actual-return', import.meta.url),'rejected')\n  return {status:'rejected'}\n}\n",
  send: malicious,
  prototype:
    "import { serialize } from 'node:v8'\nimport { writeFileSync } from 'node:fs'\nexport function submit() {\n  Object.defineProperty(Object.prototype, 'observations', {\n    configurable: true,\n    set(records: any[]) {\n      Object.defineProperty(this, 'observations', {\n        configurable: true, writable: true,\n        value: records.map((record) => ({\n          ...record, value: record.value instanceof Uint8Array ? serialize('accepted') : 'accepted'\n        }))\n      })\n    }\n  })\n  writeFileSync(new URL('./actual-return', import.meta.url), 'rejected')\n  return { status: 'rejected' }\n}\n",
  heap: "import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'\nimport { writeHeapSnapshot, serialize } from 'node:v8'\nimport { createHmac } from 'node:crypto'\nimport { parentPort } from 'node:worker_threads'\nexport function submit() {\n  const path = new URL('./probe.heapsnapshot', import.meta.url).pathname\n  writeHeapSnapshot(path)\n  const heap = JSON.parse(readFileSync(path, 'utf8'))\n  unlinkSync(path)\n  const meta = heap.snapshot.meta\n  const width = meta.node_fields.length\n  const edgeWidth = meta.edge_fields.length\n  const count = meta.node_fields.indexOf('edge_count')\n  const name = meta.node_fields.indexOf('name')\n  const edgeName = meta.edge_fields.indexOf('name_or_index')\n  const target = meta.edge_fields.indexOf('to_node')\n  let edge = 0\n  let key: string | undefined\n  for (let node = 0; node < heap.nodes.length; node += width) {\n    for (let index = 0; index < heap.nodes[node + count]; index++, edge += edgeWidth) {\n      if (heap.strings[heap.edges[edge + edgeName]] !== 'key') continue\n      const value = heap.strings[heap.nodes[heap.edges[edge + target] + name]]\n      if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) key = value\n    }\n  }\n  writeFileSync(new URL('./actual-return', import.meta.url), 'rejected')\n  writeFileSync(new URL('./heap-probe', import.meta.url), JSON.stringify({\n    keyRecovered: key !== undefined, processIpc: typeof process.send\n  }))\n  const forged = {kind:'result', id:1, action:'submit',\n    observations:[{selector:'status',value:'accepted'}],preview:'accepted'}\n  parentPort?.postMessage(forged)\n  if (key && process.send) {\n    const payload = serialize({...forged,observations:[{selector:'status',value:serialize('accepted')}]})\n    const signature = createHmac('sha256',key).update('bonsai-action-response-v1:1:').update(payload).digest()\n    process.send({payload,signature})\n  }\n  return {status:'rejected'}\n}\n",
}

function fixture(handler = malicious) {
  return createProject({
    'package.json': '{"type":"module"}',
    'handler.ts': handler,
    'bindings.ts':
      'import { submit } from "./handler.ts"\nexport const actions = { submit: submit }\n',
    'required.feature': requirement,
  })
}

test('binding initialization cannot acquire the private port through start', async () => {
  const project = fixture(attacks.start)
  const config = readConfig(project.root)
  const hash = fingerprint(project.root, inventory(project.root, config.maintained), config)
  try {
    const results = await runActionPlan(
      project.root,
      config,
      hash,
      [
        {
          kind: 'invoke',
          id: 1,
          action: 'submit',
          input: {},
          selections: [{ selector: 'status', keys: ['status'] }],
        },
      ],
      5000,
    )
    const observations = results[0]!.observations
    assert.equal(readFileSync(join(project.root, 'actual-return'), 'utf8'), 'rejected')
    assert.deepEqual(observations, [{ selector: 'status', value: 'rejected' }])
    assert.equal(readFileSync(join(project.root, 'port-probe'), 'utf8'), 'false')
  } finally {
    project.dispose()
  }
})

test('a raw descriptor forgery cannot finish a handler that never settles', async () => {
  const project = fixture(
    attacks.descriptor.replace("return {status:'rejected'}", 'return new Promise(() => {})'),
  )
  try {
    const config = readConfig(project.root)
    const hash = fingerprint(project.root, inventory(project.root, config.maintained), config)
    await assert.rejects(
      runActionPlan(
        project.root,
        config,
        hash,
        [
          {
            kind: 'invoke',
            id: 1,
            action: 'submit',
            input: {},
            selections: [{ selector: 'status', keys: ['status'] }],
          },
        ],
        1500,
      ),
      /deadline/,
    )
    assert.equal(readFileSync(join(project.root, 'actual-return'), 'utf8'), 'rejected')
  } finally {
    project.dispose()
  }
})

for (const [attack, handler] of Object.entries(attacks)) {
  test(attack + ' cannot rewrite failed observations in either profile', async () => {
    for (const serial of [false, true]) {
      const project = fixture(handler)
      try {
        const config = readConfig(project.root)
        const contracts = compileContracts([{ file: 'required.feature', text: requirement }])
        const files = inventory(project.root, config.maintained, config.exclude)
        const hash = fingerprint(project.root, files, config)
        const evidence = await runEvidence(
          project.root,
          config,
          contracts,
          hash,
          15000,
          undefined,
          serial
            ? { profile: 'in-process-v1', workers: 1 }
            : { profile: 'isolated-scenarios-v1', workers: 1 },
        )
        assert.equal(readFileSync(join(project.root, 'actual-return'), 'utf8'), 'rejected')
        if (attack === 'start')
          assert.equal(readFileSync(join(project.root, 'port-probe'), 'utf8'), 'false')
        if (attack === 'heap')
          assert.deepEqual(JSON.parse(readFileSync(join(project.root, 'heap-probe'), 'utf8')), {
            keyRecovered: false,
            processIpc: 'undefined',
          })
        assert.equal(evidence.complete, true)
        assert.equal(evidence.fingerprint, hash)
        assert.deepEqual(
          evidence.checks.map((check) => check.status),
          ['failed'],
        )
        assert.deepEqual(
          evidence.checks.map((check) => check.id),
          contracts.checks.map((check) => check.id),
        )
      } finally {
        project.dispose()
      }
    }
  })

  test('the real CLI rejects ' + attack + ' evidence forgery', () => {
    const project = fixture(handler)
    try {
      const result = runCli(['check', '--root', project.root, '--json'])
      assert.equal(result.error, undefined)
      assert.equal(result.status, 1, result.stdout || result.stderr)
      const report = JSON.parse(result.stdout)
      assert.equal(report.decision.status, 'reject')
      assert.equal(report.snapshot.evidence.complete, true)
      assert.deepEqual(
        report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
        ['failed'],
      )
      assert.equal(readFileSync(join(project.root, 'actual-return'), 'utf8'), 'rejected')
      if (attack === 'start')
        assert.equal(readFileSync(join(project.root, 'port-probe'), 'utf8'), 'false')
      if (attack === 'heap')
        assert.deepEqual(JSON.parse(readFileSync(join(project.root, 'heap-probe'), 'utf8')), {
          keyRecovered: false,
          processIpc: 'undefined',
        })
    } finally {
      project.dispose()
    }
  })
}
