import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  utimesSync,
  realpathSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { cliEnvironment, runCli } from './cli.ts'
import { snapshot, readConfig } from '../src/project.ts'
import { inventory, fingerprint } from '../src/inventory.ts'
import { pythonProgram } from '../src/python-program.ts'
import { collectPythonSource } from '../src/python.ts'
import { Timer } from '../src/timing.ts'

const feature =
  'Feature: Orders\nScenario: Accept an order\n When I invoke "place-order" with {"quantity":1}\n Then response "status" equals "accepted"\n'
const binding = 'from orders import place_order\nactions = {"place-order": place_order}\n'
const handler =
  'def place_order(request):\n    return {"status": "accepted" if request["quantity"] > 0 else "rejected"}\n'
function fixture(sources: Record<string, string> = {}, policy: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-python-'))
  const files = {
    'bindings.py': binding,
    'orders.py': handler,
    'orders.feature': feature,
    ...sources,
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  const config = {
    maintained: [...Object.keys(files), 'bonsai.json'],
    bindings: 'bindings.py',
    policy: {
      bootstrap: 100000,
      bootstrapSurface: 1,
      perDoubling: 0,
      hardLimit: 100000,
      maxFeedbackMs: 15000,
      ...policy,
    },
  }
  writeFileSync(join(root, 'bonsai.json'), JSON.stringify(config))
  return { root, config, dispose: () => rmSync(root, { recursive: true, force: true }) }
}
function check(root: string, serial = false, env = cliEnvironment()) {
  const result = runCli(['check', '--root', root, '--json', ...(serial ? ['--serial'] : [])], {
    env,
    timeout: 20000,
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.equal(result.error, undefined)
  const report = JSON.parse(result.stdout)
  return { result, report }
}
function assertStatus(root: string, expected: string, serial = false) {
  const { result, report } = check(root, serial)
  assert.equal(report.decision.status, expected, result.stdout + result.stderr)
  assert.equal(result.status, expected === 'pass' ? 0 : expected === 'reject' ? 1 : 2)
  return report
}

// Trusted test instrumentation observes execution without granting candidate file access.
function profile(file: string, name: string, body: string) {
  return (
    'import os as _probe_os, sys as _probe_sys\n' +
    'def _bonsai_probe(frame, event, arg):\n' +
    '    if event == "call" and frame.f_code.co_filename == ' +
    JSON.stringify(realpathSync(file)) +
    ' and frame.f_code.co_name == ' +
    JSON.stringify(name) +
    ':\n' +
    '        _probe_sys.setprofile(None)\n' +
    body
      .split('\n')
      .map((line) => '        ' + line)
      .join('\n') +
    '\n_probe_sys.setprofile(_bonsai_probe)\n'
  )
}
function instrument(root: string, probe: string) {
  const binary = spawnSync(
    process.env.BONSAI_PYTHON_BINARY ?? 'python3',
    ['-I', '-S', '-c', 'import sys; print(sys.executable)'],
    { encoding: 'utf8' },
  )
  assert.equal(binary.status, 0, binary.stderr)
  const python = binary.stdout.trim()
  const wrapper = join(root, 'trusted-python-probe')
  writeFileSync(
    wrapper,
    '#!' +
      python +
      '\nimport os, sys\nargs = sys.argv[1:]\ni = args.index("-c")\nargs[i + 1] = ' +
      JSON.stringify(probe) +
      ' + args[i + 1]\nos.execv(' +
      JSON.stringify(python) +
      ', [' +
      JSON.stringify(python) +
      '] + args)\n',
    { mode: 0o755 },
  )
  return cliEnvironment({ BONSAI_PYTHON_BINARY: wrapper })
}

test('native Python-only CLI checks real responses without selecting a TypeScript binary', () => {
  const project = fixture()
  try {
    const { result, report } = check(
      project.root,
      false,
      cliEnvironment({ BONSAI_NATIVE_BINARY: '/missing/never-needed-tsrs' }),
    )
    assert.equal(report.decision.status, 'pass', result.stdout + result.stderr)
    assert.equal(result.status, 0)
    assert.equal(report.snapshot.identity.compiler.name, 'python')
    for (const [key, value] of Object.entries({
      engine: 'python',
      backend: 'python-ast',
      status: 'complete',
    }))
      assert.equal(report.snapshot.analysis[key], value)
    assert.deepEqual(
      report.snapshot.evidence.checks.map((check: any) => check.status),
      ['passed'],
    )
    assert.equal(report.snapshot.evidence.bindingImport.file, 'bindings.py')
    assert.equal(
      report.snapshot.source.files.some((file: any) => file.file.endsWith('.ts')),
      false,
    )
  } finally {
    project.dispose()
  }
})

test('wrong Python values cannot author passing evidence in either execution profile', () => {
  const project = fixture({
    'orders.py':
      'def place_order(request):\n    return {"status":"rejected","checks":[{"status":"passed"}],"complete":True}\n',
  })
  try {
    for (const serial of [false, true]) {
      const report = assertStatus(project.root, 'reject', serial)
      assert.equal(report.snapshot.evidence.complete, true)
      assert.equal(report.snapshot.evidence.checks[0].status, 'failed')
      assert.ok(report.snapshot.evidence.checks[0].response.includes('rejected'))
    }
  } finally {
    project.dispose()
  }
})

test('analysis and explain never import application startup; native execution follows imports and aliases', async () => {
  const project = fixture()
  const marker = join(project.root, 'started')
  const env = instrument(
    project.root,
    profile(
      join(project.root, 'orders.py'),
      '<module>',
      'with open(' + JSON.stringify(marker) + ', "w") as stream:\n    stream.write("started")',
    ),
  )
  try {
    const source = await snapshot(project.root, readConfig(project.root), false)
    assert.deepEqual(source.source.problems, [])
    assert.equal(existsSync(marker), false)
    assert.equal(source.source.actions['place-order'], 'orders.py#place_order')
    const explained = runCli(
      ['explain', 'orders.py#place_order', '--root', project.root, '--json'],
      { env },
    )
    assert.equal(explained.status, 0, explained.stdout + explained.stderr)
    assert.equal(existsSync(marker), false)
    const { report } = check(project.root, false, env)
    assert.equal(report.decision.status, 'pass')
    assert.equal(existsSync(marker), true)
  } finally {
    project.dispose()
  }
})

test('unselected registered Python handlers stay unrooted and fully charged', () => {
  const project = fixture({
    'bindings.py':
      'from orders import place_order, unused\nactions = {"place-order":place_order,"unused":unused}\n',
    'orders.py': handler + '\ndef unused(request):\n    return {"unneeded":True}\n',
  })
  try {
    const report = assertStatus(project.root, 'reject')
    assert.ok(report.snapshot.unrooted.includes('orders.py#unused'))
    assert.ok(report.snapshot.ancestry['orders.py#place_order'].length > 0)
    assert.ok(
      report.snapshot.source.files.find((file: any) => file.file === 'orders.py').tokens > 30,
    )
  } finally {
    project.dispose()
  }
})

test('ambiguous names, decorators, dynamic imports, closures, and foreign source stop before execution', () => {
  const cases = [
    'from orders import place_order\nfrom orders import place_order\n',
    'from builtins import eval as run\ndef place_order(request):\n    return run("1")\n',
    'run = eval\ndef place_order(request):\n    return run("1")\n',
    '@print\ndef place_order(request):\n    return {"status":"accepted"}\n',
    'def place_order(request):\n    return __import__("json")\n',
    'def place_order(request):\n    return [item for item in request]\n',
    'def place_order(request):\n    return request.get("status")\n',
    'if True:\n    import json\ndef place_order(request):\n    return {"status":"accepted"}\n',
  ]
  for (const code of cases) {
    const project = fixture({ 'orders.py': code })
    try {
      const report = assertStatus(project.root, 'incomplete')
      assert.ok(report.snapshot.source.problems.length > 0)
      assert.equal(report.snapshot.evidence, undefined)
    } finally {
      project.dispose()
    }
  }
  const project = fixture({ 'extra.rs': 'fn unused() {}' })
  try {
    const report = assertStatus(project.root, 'incomplete')
    assert.ok(report.snapshot.source.files.find((file: any) => file.file === 'extra.rs').tokens > 0)
  } finally {
    project.dispose()
  }
})

test('Python lexical cost charges literal payloads and comments and ignores indentation width', async () => {
  const project = fixture({
    'orders.py':
      'payload = "' + 'x'.repeat(65536) + '"\n# ' + 'comment '.repeat(100) + '\n' + handler,
  })
  try {
    const before = await snapshot(project.root, readConfig(project.root), false)
    const file = before.source.files.find((file) => file.file === 'orders.py')!
    assert.ok(file.tokens > 16400)
    writeFileSync(
      join(project.root, 'orders.py'),
      readFileSync(join(project.root, 'orders.py'), 'utf8').replace('    return', '        return'),
    )
    const after = await snapshot(project.root, readConfig(project.root), false)
    assert.equal(after.source.files.find((file) => file.file === 'orders.py')!.tokens, file.tokens)
  } finally {
    project.dispose()
  }
})

test('Python structural requirements remain incomplete until their metric is implemented', () => {
  const project = fixture({}, { structural: { metric: 'control-depth-v1', maxDepth: 4 } })
  try {
    const report = assertStatus(project.root, 'incomplete')
    assert.ok(report.snapshot.source.problems.join('\n').includes('control-depth-v1'))
    assert.equal(report.snapshot.evidence, undefined)
  } finally {
    project.dispose()
  }
})

test('initialization preserves Python bindings and proposes a native Python starter without executing it', () => {
  for (const existing of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), 'bonsai-python-init-'))
    try {
      writeFileSync(join(root, 'orders.py'), handler)
      const bytes = 'raise RuntimeError("initialization imported candidate")\n'
      if (existing) writeFileSync(join(root, 'bindings.py'), bytes)
      const result = runCli(['init', '--root', root, '--json'])
      assert.equal(result.status, 0, result.stdout + result.stderr)
      const config = readConfig(root)
      assert.equal(config.bindings, existing ? 'bindings.py' : 'bonsai_bindings.py')
      assert.equal(
        readFileSync(join(root, config.bindings), 'utf8'),
        existing
          ? bytes
          : '# Connect named handlers from your application to your contracts.\n# from your_module import your_handler\n# actions = {"your-action": your_handler}\nactions = {}\n',
      )
      assert.equal(existsSync(join(root, 'bonsai.bindings.ts')), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('Python serial state is shared and isolated scenarios start fresh', () => {
  const second = feature.replace('Scenario: Accept an order', 'Scenario: Accept another order')
  const project = fixture({
    'orders.py':
      'state = [0]\ndef place_order(request):\n    state[0] += 1\n    return {"status":"accepted" if state[0] == 1 else "rejected"}\n',
    'orders.feature': feature + '\n' + second.replace('Feature: Orders\n', ''),
  })
  try {
    assertStatus(project.root, 'pass')
    const report = assertStatus(project.root, 'reject', true)
    assert.deepEqual(
      report.snapshot.evidence.checks.map((check: any) => check.status),
      ['passed', 'failed'],
    )
  } finally {
    project.dispose()
  }
})

test('excluded Python lockfile presence and bytes remain fingerprint inputs', () => {
  const project = fixture()
  try {
    const config = readConfig(project.root)
    const files = inventory(project.root, config.maintained, config.exclude)
    const absent = fingerprint(project.root, files, config)
    writeFileSync(join(project.root, 'uv.lock'), 'version = 1\n')
    const added = fingerprint(project.root, files, config)
    writeFileSync(join(project.root, 'uv.lock'), 'version = 2\n')
    assert.notEqual(fingerprint(project.root, files, config), added)
    assert.notEqual(added, absent)
    assert.ok(!files.includes('uv.lock'))
  } finally {
    project.dispose()
  }
})

test('owned modules execute measured source even when a valid stale pyc returns the passing value', () => {
  const project = fixture({
    'orders.py': 'def place_order(request):\n    return {"status":"accepted"}\n',
  })
  const path = join(project.root, 'orders.py')
  try {
    const runtime = process.env.BONSAI_PYTHON_BINARY ?? 'python3'
    utimesSync(path, 1700000000, 1700000000)
    const compiled = spawnSync(
      runtime,
      [
        '-I',
        '-S',
        '-B',
        '-c',
        'import py_compile,sys; py_compile.compile(sys.argv[1],doraise=True)',
        path,
      ],
      { encoding: 'utf8' },
    )
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
    writeFileSync(path, readFileSync(path, 'utf8').replace('accepted', 'rejected'))
    utimesSync(path, 1700000000, 1700000000)
    const control = spawnSync(
      runtime,
      [
        '-I',
        '-S',
        '-B',
        '-c',
        'import sys; sys.path.insert(0,sys.argv[1]); import orders; print(orders.place_order({})["status"])',
        project.root,
      ],
      { encoding: 'utf8' },
    )
    assert.equal(control.stdout.trim(), 'accepted')
    const report = assertStatus(project.root, 'reject')
    assert.ok(report.snapshot.evidence.checks[0].response.includes('rejected'))
  } finally {
    project.dispose()
  }
})

test('explicit TypeScript engine compatibility is rejected for a Python consumer', () => {
  const project = fixture()
  try {
    const result = runCli(['check', '--root', project.root, '--engine', 'rust', '--json'])
    assert.equal(result.status, 2)
    assert.ok(JSON.parse(result.stderr).error.includes('Python'))
    assert.equal(result.stdout, '')
  } finally {
    project.dispose()
  }
})

test('JSON serialization errors fail observations rather than inventing results', () => {
  const project = fixture({
    'orders.py': 'def place_order(request):\n    return {"status":set([1])}\n',
  })
  try {
    const report = assertStatus(project.root, 'reject')
    assert.ok(report.snapshot.evidence.checks[0].error.includes('not JSON serializable'))
  } finally {
    project.dispose()
  }
})

test('Python verification rejects maintained source changed during handler execution', () => {
  const project = fixture()
  const source = join(project.root, 'orders.py')
  const env = instrument(
    project.root,
    profile(
      source,
      'place_order',
      'with open(' + JSON.stringify(source) + ', "w") as stream:\n    stream.write("changed")',
    ),
  )
  try {
    const { report } = check(project.root, false, env)
    assert.equal(report.decision.status, 'incomplete')
    assert.ok(
      report.snapshot.source.problems.includes('Maintained files changed during verification'),
    )
  } finally {
    project.dispose()
  }
})

test('both profiles enforce the deadline and terminate an actually started Python handler', async () => {
  for (const serial of [false, true]) {
    const project = fixture(
      {
        'orders.py':
          'import time\ndef place_order(request):\n    time.sleep(30)\n    return {"status":"accepted"}\n',
      },
      { maxFeedbackMs: 2000 },
    )
    const marker = join(project.root, 'pid')
    const env = instrument(
      project.root,
      profile(
        join(project.root, 'orders.py'),
        'place_order',
        'with open(' +
          JSON.stringify(marker) +
          ', "w") as stream:\n    stream.write(str(_probe_os.getpid()))',
      ),
    )
    try {
      const { report } = check(project.root, serial, env)
      assert.equal(report.decision.status, 'incomplete')
      assert.ok(report.snapshot.source.problems.join('\n').includes('deadline'))
      assert.equal(existsSync(marker), true)
      const pid = Number(readFileSync(marker, 'utf8').trim())
      assert.ok(pid > 1)
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    } finally {
      project.dispose()
    }
  }
})

test('ordinary lazy standard-library imports remain available without a complete dependency-attestation claim', () => {
  const project = fixture({
    'orders.py':
      'from datetime import datetime as calendar\ndef place_order(request):\n    date = calendar.strptime("2020", "%Y")\n    return {"status":"accepted" if date.year == 2020 else "rejected"}\n',
  })
  try {
    assertStatus(project.root, 'pass')
  } finally {
    project.dispose()
  }
})

test('inert module aliases and unused defaults do not grant callback-body startup ancestry', async () => {
  const project = fixture({
    'orders.py':
      handler +
      '\ndef dormant(request):\n    return {"status":"unneeded"}\nalias = dormant\ndef unused(request=dormant):\n    return request\n',
  })
  try {
    const result = await snapshot(project.root, readConfig(project.root), false)
    assert.deepEqual(result.source.problems, [])
    assert.ok(result.unrooted.includes('orders.py#dormant'))
    assert.ok(result.unrooted.includes('orders.py#alias'))
    assert.ok(result.unrooted.includes('orders.py#unused'))
  } finally {
    project.dispose()
  }
})

test('implicit Python test initialization cannot give dead helpers production subjects', () => {
  const project = fixture({
    'orders.py': handler + '\ndef dormant(request):\n    return {"status":"unneeded"}\n',
    'test_cases.py':
      'from orders import place_order, dormant\ndef supported_case():\n    return place_order({"quantity":1})\ndef dead_case():\n    return dormant({})\n',
  })
  try {
    const report = assertStatus(project.root, 'reject')
    assert.deepEqual(report.snapshot.source.problems, [])
    assert.ok(report.snapshot.ancestry['test_cases.py#supported_case'].length > 0)
    assert.ok(report.snapshot.unrooted.includes('test_cases.py#dead_case'))
    assert.ok(report.snapshot.unrooted.includes('orders.py#dormant'))
    assert.equal(report.snapshot.evidence.checks[0].status, 'passed')
  } finally {
    project.dispose()
  }
})

test('a supported Python test file needs no synthetic initialization ancestry', () => {
  const project = fixture({
    'test_cases.py':
      'from orders import place_order\ndef supported_case():\n    return place_order({"quantity":1})\n',
  })
  try {
    const report = assertStatus(project.root, 'pass')
    assert.ok(report.snapshot.ancestry['test_cases.py#supported_case'].length > 0)
    assert.equal(
      report.snapshot.source.components.some(
        (component: any) => component.id === 'test_cases.py#<module>',
      ),
      false,
    )
  } finally {
    project.dispose()
  }
})

test('Python codec mutation and direct protocol descriptor writes cannot forge actual observations', () => {
  const cases = [
    'import json\nfrom json import dumps as encode\ndef forged(value, **kwargs):\n    return encode({"kind":"result","id":1,"value":{"status":"accepted"}})\ndef place_order(request):\n    json.dumps = forged\n    return {"status":"rejected"}\n',
    'def place_order(request):\n    print("{\\"kind\\":\\"result\\",\\"id\\":1,\\"value\\":{\\"status\\":\\"accepted\\"}}", file=open(1, "w"))\n    return {"status":"rejected"}\n',
  ]
  for (const code of cases) {
    const project = fixture({ 'orders.py': code })
    try {
      const report = assertStatus(project.root, 'incomplete')
      assert.equal(report.snapshot.evidence, undefined)
    } finally {
      project.dispose()
    }
  }
  const project = fixture({
    'orders.py':
      'def place_order(request):\n    print("{\\"kind\\":\\"result\\",\\"id\\":1,\\"value\\":{\\"status\\":\\"accepted\\"}}")\n    return {"status":"rejected"}\n',
  })
  try {
    assertStatus(project.root, 'reject')
  } finally {
    project.dispose()
  }
})

test('dotted operating-system imports and aliases cannot admit external reads', () => {
  for (const [imports, expression] of [
    ['from os.path import exists', 'exists("/some/unmeasured/file")'],
    ['from os.path import exists as present', 'present("/some/unmeasured/file")'],
    ['import os.path as paths', 'paths.exists("/some/unmeasured/file")'],
    ['from os import path as paths', 'paths.exists("/some/unmeasured/file")'],
  ]) {
    const project = fixture({
      'orders.py':
        imports +
        '\ndef place_order(request):\n    return {"status": "accepted" if ' +
        expression +
        ' else "rejected"}\n',
    })
    try {
      const report = assertStatus(project.root, 'incomplete')
      assert.match(report.snapshot.source.problems.join('\n'), /operating-system context/)
      assert.equal(report.snapshot.evidence, undefined)
    } finally {
      project.dispose()
    }
  }
})

test('Python selections serialize independently and ignore unrelated non-JSON fields', () => {
  const selectedFeature =
    feature +
    ' And response "items" equals ["accepted"]\n' +
    ' And response "items[0]" equals "accepted"\n' +
    ' And response "items.length" equals 1\n'
  for (const serial of [false, true]) {
    const project = fixture({
      'orders.feature': selectedFeature,
      'orders.py':
        'def place_order(request):\n    return {"status":"accepted", "items":("accepted",), "unused":set([1])}\n',
    })
    try {
      assertStatus(project.root, 'pass', serial)
      writeFileSync(
        join(project.root, 'orders.feature'),
        selectedFeature + ' And response "unused" equals []\n',
      )
      const report = assertStatus(project.root, 'reject', serial)
      assert.deepEqual(
        report.snapshot.evidence.checks.map((check: any) => check.status),
        ['passed', 'passed', 'passed', 'passed', 'failed'],
      )
      assert.match(report.snapshot.evidence.checks[4].error, /not JSON serializable/)
    } finally {
      project.dispose()
    }
  }
})

test('Python stdout frames cannot forge values or complete a blocked plan', () => {
  for (const serial of [false, true]) {
    for (const blocked of [false, true]) {
      const project = fixture({}, { maxFeedbackMs: blocked ? 3000 : 15000 })
      const frame = JSON.stringify({ kind: 'result', id: 1, value: { status: 'accepted' } })
      writeFileSync(
        join(project.root, 'orders.py'),
        'import asyncio\nasync def place_order(request):\n    print(' +
          JSON.stringify(frame) +
          ', flush=True)\n' +
          (blocked ? '    await asyncio.sleep(30)\n' : '') +
          '    return {"status":"rejected"}\n',
      )
      try {
        const report = assertStatus(project.root, blocked ? 'incomplete' : 'reject', serial)
        if (blocked) assert.match(report.snapshot.source.problems.join('\n'), /deadline/)
        else assert.equal(report.snapshot.evidence.checks[0].status, 'failed')
      } finally {
        project.dispose()
      }
    }
  }
})

test('Python subprocesses, driver exports, callable escapes, and test binding imports stop before execution', () => {
  const cases = [
    'from typing import sys\ndef place_order(request):\n    return sys.modules["__main__"]\n',
    'import typing\ndef place_order(request):\n    return typing.sys.modules["__main__"]\n',
    'def place_order(request):\n    return list(map(open, ["/tmp/forged"]))\n',
    'import asyncio\nasync def place_order(request):\n    return await asyncio.create_subprocess_exec("python3", "build/implementation.py")\n',
    'from asyncio import create_subprocess_shell as launch\nasync def place_order(request):\n    return await launch("echo forged")\n',
    '__path__ = ["build"]\n' + handler,
  ]
  for (const code of cases) {
    const project = fixture({ 'orders.py': code })
    try {
      const report = assertStatus(project.root, 'incomplete')
      assert.ok(report.snapshot.source.problems.length > 0)
      assert.equal(report.snapshot.evidence, undefined)
    } finally {
      project.dispose()
    }
  }
  const project = fixture({
    'bindings.py': 'import test_setup\n' + binding,
    'test_setup.py': 'from orders import place_order\n',
  })
  try {
    const report = assertStatus(project.root, 'incomplete')
    assert.match(report.snapshot.source.problems.join('\n'), /production imports of test modules/)
    assert.equal(report.snapshot.evidence, undefined)
  } finally {
    project.dispose()
  }
})

test('eager Python module annotations receive initialization ancestry', () => {
  const project = fixture({
    'orders.py':
      'def startup():\n    return "annotation"\nvalue: startup() = 1\n' +
      handler.replace('request["quantity"] > 0', 'value == 1'),
  })
  try {
    const report = assertStatus(project.root, 'pass')
    assert.ok(report.snapshot.ancestry['orders.py#startup'].length > 0)
    assert.ok(report.snapshot.ancestry['orders.py#value'].length > 0)
  } finally {
    project.dispose()
  }
})

test('Python startup deadline retains measured inventory and interrupted timings', () => {
  const project = fixture({}, { maxFeedbackMs: 1 })
  try {
    const report = assertStatus(project.root, 'incomplete')
    assert.ok(
      report.snapshot.source.files.some(
        (file: any) => file.file === 'orders.py' && file.tokens > 0,
      ),
    )
    assert.equal(report.snapshot.evidence, undefined)
    assert.match(
      report.snapshot.source.problems.join('\n'),
      /Python analysis interrupted.*deadline/,
    )
    assert.equal(
      report.snapshot.timing.stages.find((stage: any) => stage.name === 'source').status,
      'interrupted',
    )
  } finally {
    project.dispose()
  }
})

test('TypeScript bindings cannot silently admit maintained Python code as data', () => {
  const project = fixture({
    'orders.feature': feature.replace('"place-order"', '"ready"').replace('"accepted"', '"ok"'),
    'app.ts': 'export function ready() { return { status: "ok" } }',
    'bindings.ts': "import { ready } from './app.ts'\nexport const actions = { ready: ready }\n",
  })
  try {
    const config = { ...project.config, bindings: 'bindings.ts' }
    writeFileSync(join(project.root, 'bonsai.json'), JSON.stringify(config))
    const report = assertStatus(project.root, 'incomplete')
    assert.match(
      report.snapshot.source.problems.join('\n'),
      /Unsupported source language: orders.py/,
    )
    assert.ok(
      report.snapshot.source.files.some(
        (file: any) => file.file === 'orders.py' && file.tokens > 0,
      ),
    )
    assert.equal(report.snapshot.evidence, undefined)
    assert.equal(report.snapshot.source.controlDepth.complete, false)
  } finally {
    project.dispose()
  }
})

function embedded(request: unknown, probe = '') {
  return spawnSync(
    process.env.BONSAI_PYTHON_BINARY ?? 'python3',
    ['-I', '-S', '-B', '-X', 'utf8', '-c', probe + pythonProgram],
    { input: JSON.stringify(request) + '\n', encoding: 'utf8', timeout: 10000 },
  )
}

test('Python source loader freezes every analyzed module before candidate initialization', () => {
  const project = fixture({
    'bindings.py': 'import startup\n' + binding,
    'startup.py': '',
    'orders.py': handler.replace('accepted', 'rejected'),
  })
  const path = join(project.root, 'orders.py')
  const probe = profile(
    join(project.root, 'startup.py'),
    '<module>',
    'with open(' +
      JSON.stringify(path) +
      ', "w") as stream:\n    stream.write(' +
      JSON.stringify(handler) +
      ')',
  )
  try {
    const analyzed = embedded({
      mode: 'analyze',
      root: project.root,
      files: project.config.maintained.slice().sort(),
      bindings: 'bindings.py',
    })
    assert.equal(analyzed.status, 0, analyzed.stderr)
    const frame = JSON.parse(analyzed.stdout)
    assert.deepEqual(frame.source.problems, [])
    const result = join(project.root, 'completed')
    const ran = embedded(
      {
        mode: 'actions',
        root: project.root,
        bindings: 'bindings.py',
        digests: frame.digests,
        compiler: frame.compiler,
        result,
        operations: [
          {
            id: 1,
            action: 'place-order',
            input: { quantity: 1 },
            selections: [{ selector: 'status', keys: ['status'] }],
          },
        ],
      },
      probe,
    )
    assert.equal(ran.status, 0, ran.stderr)
    assert.equal(
      JSON.parse(readFileSync(result, 'utf8')).results[0].observations[0].value,
      'rejected',
    )
    assert.match(readFileSync(path, 'utf8'), /accepted/)
    rmSync(result)
    const drift = embedded({
      mode: 'actions',
      root: project.root,
      bindings: 'bindings.py',
      digests: frame.digests,
      compiler: frame.compiler,
      result,
      operations: [],
    })
    assert.notEqual(drift.status, 0)
    assert.match(drift.stderr, /source changed after analysis/)
    assert.equal(existsSync(result), false)
  } finally {
    project.dispose()
  }
})

test('Python finder refuses fallback through unmeasured package search paths', () => {
  const project = fixture({
    'bindings.py': 'from pkg.native import place_order\nactions = {"place-order": place_order}\n',
    'pkg/__init__.py': '',
  })
  const foreign = join(project.root, 'build', 'pkg')
  mkdirSync(foreign, { recursive: true })
  writeFileSync(join(foreign, 'native.py'), handler)
  writeFileSync(
    join(project.root, 'pkg/__init__.py'),
    '__path__ = [' + JSON.stringify(foreign) + ']\n',
  )
  try {
    const analyzed = embedded({
      mode: 'analyze',
      root: project.root,
      files: project.config.maintained.slice().sort(),
      bindings: 'bindings.py',
    })
    assert.equal(analyzed.status, 0, analyzed.stderr)
    const frame = JSON.parse(analyzed.stdout)
    const result = join(project.root, 'completed')
    const ran = embedded({
      mode: 'actions',
      root: project.root,
      bindings: 'bindings.py',
      digests: frame.digests,
      compiler: frame.compiler,
      result,
      operations: [],
    })
    assert.notEqual(ran.status, 0)
    assert.match(ran.stderr, /outside measured source and installed stdlib/)
    assert.equal(existsSync(result), false)
  } finally {
    project.dispose()
  }
})

test('interrupted Python collection retains inventory without inventing identity or evidence', async () => {
  const project = fixture()
  try {
    for (const timeout of [0, 1]) {
      const timer = new Timer()
      const collected = await collectPythonSource(
        project.root,
        project.config.maintained.slice().sort(),
        'bindings.py',
        undefined,
        timeout,
        timer,
      )
      assert.equal(collected.interrupted, true)
      assert.equal(collected.identity, undefined)
      assert.equal(collected.pythonSources, undefined)
      assert.ok(collected.source.files.find((file) => file.file === 'orders.py')!.tokens > 0)
      assert.match(collected.source.problems.join('\n'), /Python analysis interrupted.*deadline/)
      assert.equal(timer.report().stages[0]!.status, 'interrupted')
    }
  } finally {
    project.dispose()
  }
})

test('embedded Python analysis rejects capability escapes and preserves eager initialization edges', () => {
  const project = fixture()
  try {
    for (const code of [
      'from typing import sys\n' + handler,
      'import typing\ndef place_order(request):\n    return typing.sys.modules["__main__"]\n',
      'def place_order(request):\n    return list(map(open, ["/tmp/result"]))\n',
      'from asyncio import create_subprocess_exec as start\nasync def place_order(request):\n    return await start("build/implementation")\n',
      'import asyncio\nasync def place_order(request):\n    return await asyncio.create_subprocess_shell("forged")\n',
      '__path__ = ["build"]\n' + handler,
    ]) {
      writeFileSync(join(project.root, 'orders.py'), code)
      const result = embedded({
        mode: 'analyze',
        root: project.root,
        files: project.config.maintained.slice().sort(),
        bindings: 'bindings.py',
      })
      assert.equal(result.status, 0, result.stderr)
      assert.ok(JSON.parse(result.stdout).source.problems.length > 0, code)
    }
    writeFileSync(
      join(project.root, 'orders.py'),
      'def startup():\n    return "annotation"\nvalue: startup() = 1\n' + handler,
    )
    const result = embedded({
      mode: 'analyze',
      root: project.root,
      files: project.config.maintained.slice().sort(),
      bindings: 'bindings.py',
    })
    assert.equal(result.status, 0, result.stderr)
    const source = JSON.parse(result.stdout).source
    assert.deepEqual(source.problems, [])
    assert.ok(
      source.relationships.some(
        (edge: any) => edge.from === 'orders.py#<module>' && edge.to === 'orders.py#value',
      ),
    )
    assert.ok(
      source.relationships.some(
        (edge: any) => edge.from === 'orders.py#value' && edge.to === 'orders.py#startup',
      ),
    )
  } finally {
    project.dispose()
  }
})

test('maintained Python lookalikes cannot resolve to preloaded driver or standard modules', () => {
  for (const name of ['sys', '__main__', 'importlib', 'pathlib']) {
    const project = fixture({
      [name + '.py']: 'modules = {}\n',
      'orders.py': 'import ' + name + '\n' + handler,
    })
    try {
      const result = embedded({
        mode: 'analyze',
        root: project.root,
        files: project.config.maintained.slice().sort(),
        bindings: 'bindings.py',
      })
      assert.equal(result.status, 0, result.stderr)
      assert.match(
        JSON.parse(result.stdout).source.problems.join('\n'),
        /owned module shadows a standard module/,
      )
    } finally {
      project.dispose()
    }
  }
})

test('Python generator and coroutine frames cannot expose driver globals or builtins', () => {
  for (const code of [
    'def values():\n    yield 1\ndef place_order(request):\n    generator = values()\n    return generator.gi_frame.f_builtins\n',
    'async def pending():\n    return 1\ndef place_order(request):\n    coroutine = pending()\n    return coroutine.cr_frame.f_globals\n',
  ]) {
    const project = fixture({ 'orders.py': code })
    try {
      const result = embedded({
        mode: 'analyze',
        root: project.root,
        files: project.config.maintained.slice().sort(),
        bindings: 'bindings.py',
      })
      assert.equal(result.status, 0, result.stderr)
      assert.match(
        JSON.parse(result.stdout).source.problems.join('\n'),
        /unresolved attribute access/,
      )
    } finally {
      project.dispose()
    }
  }
})

test('Python package from-list imports resolve test submodules before admission', () => {
  const project = fixture({
    'pkg/__init__.py': '',
    'pkg/test_setup.py': 'from orders import state\nstate[0] = "accepted"\n',
    'bindings.py': 'from pkg import test_setup as setup\n' + binding,
    'orders.py':
      'state = ["rejected"]\ndef place_order(request):\n    return {"status":state[0]}\n',
  })
  try {
    const result = embedded({
      mode: 'analyze',
      root: project.root,
      files: project.config.maintained.slice().sort(),
      bindings: 'bindings.py',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(
      JSON.parse(result.stdout).source.problems.join('\n'),
      /production imports of test modules/,
    )
  } finally {
    project.dispose()
  }
})

test('Python selected integers fail before JSON can silently round them', () => {
  for (const value of [
    '9007199254740993',
    '-9007199254740993',
    '{"nested":[9007199254740993]}',
    '9007199254740991',
  ]) {
    const project = fixture({
      'orders.py': 'def place_order(request):\n    return {"status":' + value + '}\n',
    })
    try {
      const analyzed = embedded({
        mode: 'analyze',
        root: project.root,
        files: project.config.maintained.slice().sort(),
        bindings: 'bindings.py',
      })
      assert.equal(analyzed.status, 0, analyzed.stderr)
      const frame = JSON.parse(analyzed.stdout)
      assert.deepEqual(frame.source.problems, [])
      const result = join(project.root, 'completed')
      const ran = embedded({
        mode: 'actions',
        root: project.root,
        bindings: 'bindings.py',
        digests: frame.digests,
        compiler: frame.compiler,
        result,
        operations: [
          {
            id: 1,
            action: 'place-order',
            input: {},
            selections: [{ selector: 'status', keys: ['status'] }],
          },
        ],
      })
      assert.equal(ran.status, 0, ran.stderr)
      const observation = JSON.parse(readFileSync(result, 'utf8')).results[0].observations[0]
      if (value === '9007199254740991') assert.equal(observation.value, Number.MAX_SAFE_INTEGER)
      else {
        assert.match(observation.error, /exact JSON safe integer range/)
        assert.equal('value' in observation, false)
      }
    } finally {
      project.dispose()
    }
  }
})

test('a rounded Python integer cannot satisfy a different real CLI observation', () => {
  for (const serial of [false, true]) {
    const project = fixture({
      'orders.py': 'def place_order(request):\n    return {"status":9007199254740993}\n',
      'orders.feature': feature.replace('"accepted"', '9007199254740992'),
    })
    try {
      const report = assertStatus(project.root, 'reject', serial)
      assert.match(report.snapshot.evidence.checks[0].error, /exact JSON safe integer range/)
    } finally {
      project.dispose()
    }
  }
})

test('Python UTF-7 cookies cannot hide executable lines from UTF-8 analysis', () => {
  const project = fixture()
  const marker = join(project.root, 'hidden-startup')
  const payload = '# coding: utf-7\n# +AAo-open(' + JSON.stringify(marker) + ', "w")\n' + handler
  try {
    // CPython byte compilation interprets the encoded newline as executable code.
    writeFileSync(join(project.root, 'orders.py'), payload)
    for (const serial of [false, true]) {
      const report = assertStatus(project.root, 'incomplete', serial)
      assert.match(report.snapshot.source.problems.join('\n'), /requires UTF-8 encoding/)
      assert.equal(report.snapshot.evidence, undefined)
      assert.equal(existsSync(marker), false)
    }
    const analyzed = embedded({
      mode: 'analyze',
      root: project.root,
      files: project.config.maintained.slice().sort(),
      bindings: 'bindings.py',
    })
    assert.equal(analyzed.status, 0, analyzed.stderr)
    const frame = JSON.parse(analyzed.stdout)
    const result = join(project.root, 'completed')
    const ran = embedded({
      mode: 'actions',
      root: project.root,
      bindings: 'bindings.py',
      digests: frame.digests,
      compiler: frame.compiler,
      result,
      operations: [],
    })
    assert.notEqual(ran.status, 0)
    assert.match(ran.stderr, /requires UTF-8 encoding/)
    assert.equal(existsSync(marker), false)
    assert.equal(existsSync(result), false)
    for (const cookie of ['# coding: latin-1', '#!/usr/bin/python\n# coding: utf-7']) {
      writeFileSync(join(project.root, 'orders.py'), cookie + '\n' + handler)
      const checked = embedded({
        mode: 'analyze',
        root: project.root,
        files: project.config.maintained.slice().sort(),
        bindings: 'bindings.py',
      })
      assert.equal(checked.status, 0, checked.stderr)
      assert.match(JSON.parse(checked.stdout).source.problems.join('\n'), /requires UTF-8 encoding/)
    }
    for (const prefix of [
      '',
      '# coding: utf-8\n',
      '# coding: UTF_8\n',
      '# coding: utf8\n',
      '# coding: cp65001\n',
      '\uFEFF',
    ]) {
      writeFileSync(join(project.root, 'orders.py'), prefix + handler)
      assertStatus(project.root, 'pass')
    }
  } finally {
    project.dispose()
  }
})

test('Python OS mutations cannot consume excluded path state', () => {
  const project = fixture()
  const oracle = join(project.root, 'orders.py.oracle')
  try {
    for (const operation of ['mkdir', 'remove', 'unlink', 'rmdir', 'rename', 'replace']) {
      for (const imported of [false, true]) {
        const code =
          (imported ? 'from os import ' + operation + ' as mutate' : 'import os as system') +
          '\ndef place_order(request):\n    ' +
          (imported ? 'mutate' : 'system.' + operation) +
          '(__file__ + ".oracle"' +
          (['rename', 'replace'].includes(operation) ? ', __file__ + ".moved"' : '') +
          ')\n    return {"status":"accepted"}\n'
        writeFileSync(join(project.root, 'orders.py'), code)
        const analyzed = embedded({
          mode: 'analyze',
          root: project.root,
          files: project.config.maintained.slice().sort(),
          bindings: 'bindings.py',
        })
        assert.equal(analyzed.status, 0, analyzed.stderr)
        assert.match(
          JSON.parse(analyzed.stdout).source.problems.join('\n'),
          /operating-system context|unsupported standard-library/,
        )
      }
    }
    writeFileSync(
      join(project.root, 'orders.py'),
      'import os\ndef place_order(request):\n    try:\n        os.remove(__file__ + ".oracle")\n        return {"status":"accepted"}\n    except OSError:\n        return {"status":"rejected"}\n',
    )
    for (const present of [true, false]) {
      if (present) writeFileSync(oracle, 'excluded input')
      else rmSync(oracle, { force: true })
      for (const serial of [false, true]) {
        const report = assertStatus(project.root, 'incomplete', serial)
        assert.match(report.snapshot.source.problems.join('\n'), /operating-system context/)
        assert.equal(report.snapshot.evidence, undefined)
        assert.equal(existsSync(oracle), present)
      }
    }
  } finally {
    project.dispose()
  }
})

test('relative Python from-list modules and allowlisted regex compilation execute normally', () => {
  const project = fixture({
    'bindings.py': 'from pkg.orders import place_order\nactions = {"place-order":place_order}\n',
    'pkg/__init__.py': '',
    'pkg/orders.py':
      'from . import helper\ndef place_order(request):\n    return helper.calculate(request)\n',
    'pkg/helper.py':
      'import re\ndef calculate(request):\n    return {"status":"accepted" if re.compile("accepted") else "rejected"}\n',
    'orders.py': '',
  })
  rmSync(join(project.root, 'orders.py'))
  project.config.maintained = project.config.maintained.filter((file) => file !== 'orders.py')
  writeFileSync(join(project.root, 'bonsai.json'), JSON.stringify(project.config))
  try {
    assertStatus(project.root, 'pass')
    writeFileSync(
      join(project.root, 'pkg/helper.py'),
      'from re import compile as pattern\ndef calculate(request):\n    return {"status":"accepted" if pattern("accepted") else "rejected"}\n',
    )
    assertStatus(project.root, 'pass')
    writeFileSync(
      join(project.root, 'pkg/orders.py'),
      'from . import test_setup\ndef place_order(request):\n    return test_setup.calculate(request)\n',
    )
    writeFileSync(
      join(project.root, 'pkg/test_setup.py'),
      'def calculate(request):\n    return {"status":"accepted"}\n',
    )
    project.config.maintained.push('pkg/test_setup.py')
    writeFileSync(join(project.root, 'bonsai.json'), JSON.stringify(project.config))
    const blocked = assertStatus(project.root, 'incomplete')
    assert.match(blocked.snapshot.source.problems.join('\n'), /imports of test modules/)
  } finally {
    project.dispose()
  }
})

test('Python write-only opens cannot use excluded file state as a contract oracle', () => {
  for (const mode of ['x', 'w', 'a']) {
    const project = fixture()
    const path = join(project.root, 'excluded-oracle')
    writeFileSync(
      join(project.root, 'orders.py'),
      'def place_order(request):\n    try:\n        open(' +
        JSON.stringify(path) +
        ', ' +
        JSON.stringify(mode) +
        ')\n        return {"status":"rejected"}\n    except:\n        return {"status":"accepted"}\n',
    )
    try {
      for (const present of [true, false]) {
        if (present) writeFileSync(path, 'unmeasured')
        else rmSync(path, { force: true })
        for (const serial of [false, true]) {
          const report = assertStatus(project.root, 'incomplete', serial)
          assert.match(
            report.snapshot.source.problems.join('\n'),
            /external resource reads and writes/,
          )
          assert.equal(report.snapshot.evidence, undefined)
          assert.equal(existsSync(path), present)
          if (present) assert.equal(readFileSync(path, 'utf8'), 'unmeasured')
        }
      }
    } finally {
      project.dispose()
    }
  }
})

test('Python allowlisted scalar constants remain data through imports and aliases', () => {
  for (const code of [
    'import math, string\ndef place_order(request):\n    return {"pi":math.pi,"digits":string.digits}\n',
    'from math import pi as circle\nfrom string import digits as decimal_digits\ndef place_order(request):\n    return {"pi":circle,"digits":decimal_digits}\n',
  ]) {
    const project = fixture({
      'orders.py': code,
      'orders.feature':
        'Feature: Standard constants\nScenario: Read scalar data\n When I invoke "place-order" with {}\n Then response "pi" equals 3.141592653589793\n And response "digits" equals "0123456789"\n',
    })
    try {
      assertStatus(project.root, 'pass')
    } finally {
      project.dispose()
    }
  }
})

test('fully qualified allowlisted Python calls preserve their resolved identity', () => {
  const project = fixture({
    'orders.py':
      'import datetime\ndef place_order(request):\n    date = datetime.datetime.strptime("2020", "%Y")\n    return {"year":date.year}\n',
    'orders.feature':
      'Feature: Calendar data\nScenario: Parse a year\n When I invoke "place-order" with {}\n Then response "year" equals 2020\n',
  })
  try {
    assertStatus(project.root, 'pass')
  } finally {
    project.dispose()
  }
})

test('Python import aliases cannot redirect package context into test modules', () => {
  const project = fixture({
    'orders.py': '',
    'bindings.py': 'from pkg.orders import place_order\nactions={"place-order":place_order}\n',
    'pkg/__init__.py': '',
    'pkg/orders.py':
      'from redirect import destination as __package__\nfrom . import helper\ndef place_order(request):\n    context = __package__\n    return {"status":helper.status() if context else "rejected"}\n',
    'pkg/helper.py': 'import evilpkg\ndef status():\n    return "rejected"\n',
    'redirect.py': 'destination = "evilpkg.tests"\n',
    'evilpkg/__init__.py': '',
    'evilpkg/tests/__init__.py': '',
    'evilpkg/tests/helper.py':
      'from pkg.helper import status as declared_status\ndef status():\n    declared_status()\n    return "accepted"\n',
  })
  rmSync(join(project.root, 'orders.py'))
  project.config.maintained = project.config.maintained.filter((file) => file !== 'orders.py')
  writeFileSync(join(project.root, 'bonsai.json'), JSON.stringify(project.config))
  try {
    for (const serial of [false, true]) {
      const report = assertStatus(project.root, 'incomplete', serial)
      assert.match(
        report.snapshot.source.problems.join('\n'),
        /imports cannot overwrite module metadata: __package__/,
      )
      assert.equal(report.snapshot.evidence, undefined)
    }
    for (const alias of [
      '__name__',
      '__file__',
      '__spec__',
      '__loader__',
      '__builtins__',
      '__path__',
    ]) {
      writeFileSync(join(project.root, 'pkg/orders.py'), 'import math as ' + alias + '\n' + handler)
      const result = embedded({
        mode: 'analyze',
        root: project.root,
        files: project.config.maintained.slice().sort(),
        bindings: 'bindings.py',
      })
      assert.equal(result.status, 0, result.stderr)
      assert.match(
        JSON.parse(result.stdout).source.problems.join('\n'),
        /imports cannot overwrite module metadata/,
      )
    }
  } finally {
    project.dispose()
  }
})
