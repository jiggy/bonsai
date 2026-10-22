import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executable = resolve('src/cli.ts')
const example = resolve('examples/checkout')
const environment = {
  ...process.env,
  BONSAI_ROOT: undefined,
  BONSAI_BASE: undefined,
  BONSAI_POLICY: undefined,
  FORCE_COLOR: undefined,
  NO_COLOR: '1',
  CI: '1',
  COLUMNS: '200',
}

function run(args: string[], input?: string, overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [executable, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...environment, ...overrides },
    input,
  })
}

function runRecovery(invocation: string) {
  return spawnSync(
    'sh',
    [
      '-c',
      invocation.replace(/^bonsai\b/, '"$BONSAI_TEST_RUNTIME" "$BONSAI_TEST_CLI"') + ' --json',
    ],
    {
      encoding: 'utf8',
      timeout: 15000,
      env: {
        ...environment,
        BONSAI_TEST_RUNTIME: process.execPath,
        BONSAI_TEST_CLI: executable,
      },
    },
  )
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bonsai cli's contracts #"))
  cpSync(example, root, { recursive: true })
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function openInput(args: string[]) {
  const child = spawn(process.execPath, [executable, ...args], {
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 8000,
    killSignal: 'SIGKILL',
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (data) => {
    stdout += data
  })
  child.stderr.on('data', (data) => {
    stderr += data
  })
  child.stdin.on('error', () => {})
  const finished = new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
  }>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolveExit({ code, signal, stdout, stderr }))
  })
  return {
    child,
    finished,
    async dispose() {
      child.stdin.destroy()
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await finished
    },
  }
}

test('missing option values retain JSON errors in either flag order', () => {
  for (const args of [
    ['check', '--root', '--json'],
    ['check', '--json', '--root'],
    ['check', '--policy', '-j'],
    ['check', '--output', '--json'],
  ]) {
    const result = run(args)
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(JSON.parse(result.stderr).code, 'USAGE')
  }
})

test('help validates requested output modes and version honors pretty JSON', () => {
  for (const args of [
    ['help', '--json', '--markdown'],
    ['help', 'check', '--json', '--plain'],
    ['help', 'check', '--output', 'csv', '--json'],
  ]) {
    const result = run(args)
    assert.equal(result.status, 2, result.stdout)
    assert.equal(result.stdout, '')
    assert.equal(JSON.parse(result.stderr).code, 'USAGE')
  }
  const version = run(['version', '--json', '--pretty'])
  assert.equal(version.status, 0, version.stderr)
  assert.match(version.stdout, /^\{\n  "name": "bonsai",\n/)
  assert.equal(JSON.parse(version.stdout).name, 'bonsai')
  const help = run(['check', '--bad', '--help'])
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /USAGE/)
})

test('explain accepts equivalent relative and absolute paths with symbol suffixes', () => {
  const { root, dispose } = fixture()
  try {
    const baseline = run(['explain', 'src/checkout.ts', '--root', root, '--json'])
    assert.equal(baseline.status, 0, baseline.stderr)
    const components = JSON.parse(baseline.stdout).components
    for (const target of [
      './src/checkout.ts',
      'src/../src/checkout.ts',
      join(root, 'src/checkout.ts'),
    ]) {
      const result = run(['explain', target, '--root', root, '--json'])
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout).components, components)
    }
    for (const target of [
      './src/checkout.ts#placeOrder',
      `${join(root, 'src/checkout.ts')}#placeOrder`,
    ]) {
      const result = run(['explain', target, '--root', root, '--json'])
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(
        JSON.parse(result.stdout).components.map((component: { id: string }) => component.id),
        ['src/checkout.ts#placeOrder'],
      )
    }
  } finally {
    dispose()
  }
})

test('a copied recovery command preserves project, base, policy, and shell quoting', () => {
  const { root, dispose } = fixture()
  try {
    const policy = join(root, 'trusted policy.json')
    writeFileSync(policy, readFileSync(join(root, 'bonsai.json')))
    for (const args of [
      ['init', '-b', '#release', root],
      ['-C', root, 'add', '.'],
      [
        '-C',
        root,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'base',
      ],
    ])
      assert.equal(spawnSync('git', args).status, 0)
    const result = run([
      'explain',
      'missing.ts',
      '--root',
      root,
      '--base',
      '#release',
      '--policy',
      policy,
      '--json',
    ])
    assert.equal(result.status, 4, result.stderr)
    const invocation: string = JSON.parse(result.stderr).run
    assert.match(invocation, /^bonsai config show\b/)
    const recovery = runRecovery(invocation)
    assert.equal(recovery.status, 0, recovery.stderr)
    const configuration = JSON.parse(recovery.stdout)
    assert.equal(configuration.root, root)
    assert.equal(configuration.file, policy)
    assert.match(configuration.base, /^[a-f0-9]{40}$/)
    assert.equal(configuration.origin.root, '--root')
    assert.equal(configuration.origin.base, '--base')
    assert.equal(configuration.origin.policy, '--policy')
    const source = join(root, 'src/checkout.ts')
    writeFileSync(
      source,
      readFileSync(source, 'utf8') + '\nexport function unused() { return 1 }\n',
    )
    const rejected = run([
      'check',
      '--root',
      root,
      '--base',
      '#release',
      '--policy',
      policy,
      '--output',
      'human',
    ])
    assert.equal(rejected.status, 1, rejected.stderr)
    assert.equal(rejected.stdout, '')
    const next = rejected.stderr.match(/^\s*Next (?:→|->) (bonsai explain .+)$/m)
    assert.ok(next, rejected.stdout + rejected.stderr)
    const explained = runRecovery(next[1])
    assert.equal(explained.status, 0, explained.stderr)
    assert.ok(
      JSON.parse(explained.stdout).components.some(
        (component: { id: string }) => component.id === 'src/checkout.ts#unused',
      ),
    )
  } finally {
    dispose()
  }
})

test('copied recovery commands accept dash-prefixed files and trailing output flags', () => {
  const { root, dispose } = fixture()
  try {
    writeFileSync(
      join(root, '-feature.ts'),
      readFileSync(join(root, 'src/checkout.ts'), 'utf8') +
        '\nexport function unused() { return 1 }\n',
    )
    writeFileSync(
      join(root, 'bindings.ts'),
      "import { placeOrder } from './-feature.ts'\nexport const actions = { 'place-order': placeOrder }\n",
    )
    const policy = join(root, 'bonsai.json')
    const config = JSON.parse(readFileSync(policy, 'utf8'))
    config.maintained.push('-feature.ts')
    writeFileSync(policy, JSON.stringify(config))
    const rejected = run(['check', '--root', root, '--output', 'human'])
    assert.equal(rejected.status, 1, rejected.stderr)
    assert.equal(rejected.stdout, '')
    const next = rejected.stderr.match(/^\s*Next (?:→|->) (bonsai explain .+)$/m)
    assert.ok(next, rejected.stdout + rejected.stderr)
    assert.match(next[1], /-feature\.ts/)
    const explained = runRecovery(next[1])
    assert.equal(explained.status, 0, explained.stderr)
    assert.deepEqual(
      JSON.parse(explained.stdout).components.map((component: { id: string }) => component.id),
      ['-feature.ts#unused'],
    )
  } finally {
    dispose()
  }
})

test('deadlines stop commands with held-open policy and target stdin', async () => {
  for (const args of [
    ['config', 'show', '--root', example, '--policy', '-'],
    ['explain', '-', '--root', example],
  ]) {
    const started = Date.now()
    const running = openInput([...args, '--timeout', '0.4', '--json'])
    try {
      running.child.stdin.write(args[0] === 'config' ? '{' : 'src/checkout.ts\n')
      const result = await running.finished
      assert.equal(result.code, 1, result.stderr)
      assert.equal(result.signal, null)
      assert.equal(result.stdout, '')
      assert.equal(JSON.parse(result.stderr).code, 'TIMEOUT')
      assert.ok(Date.now() - started < 5000, 'stdin prevented the command deadline')
    } finally {
      await running.dispose()
    }
  }
})

test('SIGINT stops a command awaiting policy stdin', async () => {
  const running = openInput(['config', 'show', '--root', example, '--policy', '-', '--json'])
  try {
    running.child.stdin.write('{')
    await new Promise((done) => setTimeout(done, 500))
    running.child.kill('SIGINT')
    const result = await running.finished
    assert.equal(result.code, 130, result.stderr)
    assert.equal(result.signal, null)
    assert.equal(result.stdout, '')
    assert.equal(JSON.parse(result.stderr).code, 'SIGINT')
  } finally {
    await running.dispose()
  }
})

test('config show respects a deadline shorter than project startup', () => {
  const result = run(['config', 'show', '--root', example, '--timeout', '0.000001', '--json'])
  assert.equal(result.status, 1, result.stderr || result.stdout)
  assert.equal(result.stdout, '')
  assert.equal(JSON.parse(result.stderr).code, 'TIMEOUT')
})

test('a deadline expiring during report serialization cannot emit successful output', () => {
  const { root, dispose } = fixture()
  try {
    const preload = join(root, 'serialization-clock.js')
    writeFileSync(
      preload,
      [
        'const originalNow = Date.now',
        'const originalStringify = JSON.stringify',
        'let offset = 0',
        'Date.now = () => originalNow() + offset',
        'JSON.stringify = function (value, ...args) {',
        '  const result = originalStringify.call(this, value, ...args)',
        "  if (value && typeof value === 'object' && 'config' in value && 'origin' in value && 'root' in value)",
        '    offset += 120000',
        '  return result',
        '}',
        '',
      ].join('\n'),
    )
    const result = spawnSync(
      process.execPath,
      [
        '--preload',
        preload,
        executable,
        'config',
        'show',
        '--root',
        root,
        '--timeout',
        '60',
        '--json',
      ],
      { encoding: 'utf8', timeout: 15000, env: environment },
    )
    assert.equal(result.status, 1, result.stderr || result.stdout)
    assert.equal(result.stdout, '')
    assert.equal(JSON.parse(result.stderr).code, 'TIMEOUT')
  } finally {
    dispose()
  }
})

test('the command deadline stops a stalled Git subprocess', () => {
  const { root, dispose } = fixture()
  try {
    const directory = join(root, 'bin')
    mkdirSync(directory)
    const git = join(directory, 'git')
    writeFileSync(git, '#!/bin/sh\nexec sleep 5\n')
    chmodSync(git, 0o755)
    const started = Date.now()
    const result = run(
      ['config', 'show', '--root', root, '--base', 'HEAD', '--timeout', '1', '--json'],
      undefined,
      { PATH: directory + ':' + process.env.PATH },
    )
    assert.equal(result.status, 1, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(JSON.parse(result.stderr).code, 'TIMEOUT')
    assert.ok(Date.now() - started < 3500, 'Git prevented the command deadline')
  } finally {
    dispose()
  }
})

test('human explain limits details while explicit machine formats remain complete', () => {
  const { root, dispose } = fixture()
  try {
    const source = join(root, 'src/checkout.ts')
    writeFileSync(
      source,
      readFileSync(source, 'utf8') +
        Array.from(
          { length: 25 },
          (_, index) => `\nexport function extra${index}() { return ${index} }`,
        ).join(''),
    )
    const args = ['explain', 'src/checkout.ts', '--root', root]
    const json = run([...args, '--json', '--limit', '1'])
    assert.equal(json.status, 0, json.stderr)
    const ids: string[] = JSON.parse(json.stdout).components.map(
      (component: { id: string }) => component.id,
    )
    assert.equal(ids.length, 27)
    const plain = run([...args, '--plain', '--limit', '1'])
    assert.equal(plain.status, 0, plain.stderr)
    assert.equal(plain.stdout.trimEnd().split('\n').length, ids.length)
    for (const [limit, count] of [
      [undefined, 20],
      ['3', 3],
      ['0', ids.length],
    ] as const) {
      const result = run([...args, '--output', 'human', ...(limit ? ['--limit', limit] : [])])
      assert.equal(result.status, 0, result.stderr)
      const visible = result.stdout.split('\n').filter((line) => ids.includes(line))
      assert.deepEqual(visible, ids.slice(0, count))
      if (count < ids.length) assert.match(result.stdout, /--limit 0/)
    }
    for (const limit of ['', ' ', 'nope', '-1', '1.5']) {
      const result = run([...args, `--limit=${limit}`, '--json'])
      assert.equal(result.status, 2, result.stderr)
      assert.equal(JSON.parse(result.stderr).code, 'USAGE')
    }
    const checked = run(['check', '--root', root, '--limit', '1', '--json'])
    assert.equal(checked.status, 1, checked.stderr)
    assert.ok(JSON.parse(checked.stdout).snapshot.unrooted.length >= 25)
  } finally {
    dispose()
  }
})
