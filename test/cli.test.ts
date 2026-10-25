import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { version } from '../src/cli-interface.ts'
import { cliEnvironment, executable, runCli } from './cli.ts'

const example = resolve('examples/checkout')
function run(args: string[], env: NodeJS.ProcessEnv = {}, input?: string) {
  return runCli(args, {
    input,
    env: cliEnvironment({
      NO_COLOR: '',
      FORCE_COLOR: '',
      CI: process.env.CI,
      ...env,
    }),
  })
}
function fixture() {
  mkdirSync('work', { recursive: true })
  const root = mkdtempSync(resolve('work/cli-'))
  cpSync(example, root, { recursive: true })
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

test('help and version are available without loading a project', () => {
  for (const args of [
    [],
    ['-h'],
    ['--help'],
    ['help'],
    ['check', '--help'],
    ['check', '-vh'],
    ['help', 'explain'],
    ['config', 'show', '--help'],
    ['config'],
    ['completion', '--help'],
    ['version', '--help'],
  ]) {
    const result = run(args, { BONSAI_ROOT: '/missing' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /USAGE/)
    assert.match(result.stdout, /EXAMPLES/)
    assert.equal(result.stderr, '')
  }
  for (const args of [['--version'], ['-V'], ['version']])
    assert.equal(run(args).stdout, `bonsai ${version}\n`)
  assert.equal(JSON.parse(run(['version', '--json']).stdout).version, version)
  const metadata = JSON.parse(run(['help', 'check', '--json']).stdout)
  assert.equal(metadata.command, 'check')
  assert.ok(metadata.flags.root)
  assert.equal(metadata.flags.markdown, undefined)
  assert.equal(run(['check', '--bad', '--help']).status, 0)
  assert.ok(run(['check', '-h']).stdout.length < run(['check', '--help']).stdout.length)
})

test('usage errors are actionable, structured when requested, and do not leak traces', () => {
  for (const args of [
    ['chek'],
    ['constructor'],
    ['check', '--jsno'],
    ['check', 'extra'],
    ['explain', '--no-input'],
    ['version', '--base', 'HEAD'],
    ['check', '--output', 'csv'],
    ['check', '--json', '--plain'],
    ['check', '--timeout', 'NaN'],
    ['completion', 'unknown'],
  ]) {
    const result = run([...args, '--json'])
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    const error = JSON.parse(result.stderr)
    assert.equal(error.status, 'incomplete')
    assert.equal(typeof error.error, 'string')
    assert.ok(error.run)
    assert.equal(error.retryable, false)
    assert.equal(error.stack, undefined)
  }
  assert.match(run(['chek']).stderr, /Did you mean 'check'/)
  assert.match(run(['check', '--jsno']).stderr, /Did you mean '--json'/)
  assert.equal(run(['explain', '--interactive']).status, 2)
  const debug = JSON.parse(run(['check', '--root', '/missing', '--json', '--debug']).stderr)
  assert.ok(debug.stack)
})

test('early parse errors honor grouped JSON flags and attached output values', () => {
  for (const args of [
    ['check', '-jv', '--bad'],
    ['check', '-ojson', '--bad'],
    ['check', '-vojson', '--bad'],
    ['check', '--bad', '-jv'],
    ['check', '--bad', '-ojson'],
    ['check', '-jv', '--root'],
    ['check', '-ojson', '--root'],
  ]) {
    const result = run(args)
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    const error = JSON.parse(result.stderr)
    assert.equal(error.code, 'USAGE')
    assert.equal(error.exit_code, 2)
    assert.ok(error.error)
  }
  for (const args of [
    ['check', '--bad', '--', '-jv'],
    ['check', '--root=-jv', '--bad'],
    ['check', '-rjv', '--bad'],
    ['check', '-ojsonl', '--bad'],
  ]) {
    const result = run(args)
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Unknown flag/)
    assert.throws(() => JSON.parse(result.stderr))
  }
})

test('global options accept GNU ordering, equals syntax, combined shorts, and -- operands', () => {
  for (const args of [
    ['--json', 'explain', 'src/checkout.ts'],
    ['explain', '--json', 'src/checkout.ts'],
    ['explain', 'src/checkout.ts', '--json'],
    ['explain', '-jv', 'src/checkout.ts'],
  ]) {
    const result = run([...args, `--root=${example}`])
    assert.equal(result.status, 0, result.stderr)
    assert.ok(JSON.parse(result.stdout).components.length)
  }
  const delimited = run(['explain', '--root', example, '--json', '--', '--help'])
  assert.equal(delimited.status, 4)
  assert.match(JSON.parse(delimited.stderr).error, /--help/)
})

test('JSON reports retain their schema and stay compact in pipes; plain output is headerless', () => {
  const result = run(['check', '--root', example, '--json'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim().split('\n').length, 1)
  assert.equal(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.equal(report.decision.status, 'pass')
  assert.equal(report.snapshot.evidence.checks.length, 3)
  const plain = run(['check', '--root', example, '--plain'])
  assert.equal(plain.stdout, 'pass\t212\t400\t0\t1\t3\t3\t0\n')
  assert.equal(run(['check', '--root', example, '--quiet']).stdout, '')
  assert.ok(JSON.parse(run(['check', '--root', example, '-qj']).stdout).snapshot)
  assert.ok(run(['check', '--root', example, '-qv']).stdout)
  assert.ok(
    run(['check', '--root', example, '--json', '--pretty']).stdout.includes('\n  "decision"'),
  )
})

test('color controls are independent of data format and machine output never contains ANSI', () => {
  const args = ['check', '--root', example, '--output', 'human']
  assert.match(
    run(args, { FORCE_COLOR: '1', TERM: 'xterm', LANG: 'en_US.UTF-8' }).stdout,
    /\x1b\[32m/,
  )
  for (const env of [
    { NO_COLOR: '1' },
    { BONSAI_NO_COLOR: '1' },
    { TERM: 'dumb' },
    { FORCE_COLOR: '0' },
  ])
    assert.doesNotMatch(run(args, { FORCE_COLOR: '1', ...env }).stdout, /\x1b\[/)
  assert.doesNotMatch(run([...args, '--no-color'], { FORCE_COLOR: '1' }).stdout, /\x1b\[/)
  assert.doesNotMatch(
    run(['check', '--root', example, '--json'], { FORCE_COLOR: '1' }).stdout,
    /\x1b\[/,
  )
  assert.doesNotMatch(run(['check', '--root', example]).stdout, /\x1b\[/)
})

test('config shows precedence and JSONC policy input without running handlers', () => {
  const { root, dispose } = fixture()
  try {
    writeFileSync(join(root, 'src/checkout.ts'), `throw new Error('must not run')`)
    const result = run(['config', 'show', '--root', root, '--json'], { BONSAI_ROOT: '/missing' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).origin.root, '--root')
    const config = readFileSync(join(root, 'bonsai.json'), 'utf8').replace(
      '{',
      '{\n// JSONC comment\n',
    )
    const piped = run(['config', 'show', '--root', root, '--policy', '-', '--json'], {}, config)
    assert.equal(piped.status, 0, piped.stderr)
    assert.equal(JSON.parse(piped.stdout).file, 'stdin')
    const bad = run(
      ['config', 'show', '--root', root, '--policy', '-', '--json'],
      {},
      '{\n"bindings":\n}',
    )
    assert.equal(bad.status, 2)
    assert.match(JSON.parse(bad.stderr).error, /line/)
    assert.equal(run(['config', 'show', '--json'], { BONSAI_ROOT: root }).status, 0)
    assert.equal(run(['config', 'show'], { BONSAI_ROOT: '' }).status, 2)
  } finally {
    dispose()
  }
})

test('explain accepts piped targets and empty input, without running application code', () => {
  const result = run(
    ['explain', '-', '--root', example, '--json'],
    {},
    'src/checkout.ts\r\nsrc/checkout.ts\n',
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).components.length, 2)
  const empty = run(['explain', '-', '--root', example, '--plain'], {}, '')
  assert.equal(empty.status, 0, empty.stderr)
  assert.equal(empty.stdout, '')
  assert.equal(run(['explain', 'missing.ts', '--root', example]).status, 4)
  assert.equal(run(['explain', '-', '--policy', '-', '--root', example]).status, 2)
})

test('completion and generated documentation use the command registry', () => {
  for (const shell of ['bash', 'zsh', 'fish', 'powershell']) {
    const result = run(['completion', shell])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /explain/)
    assert.match(result.stdout, /no-color/)
  }
  const docs = run(['help', '--markdown'])
  assert.equal(docs.status, 0, docs.stderr)
  assert.match(docs.stdout, /## check/)
  assert.match(docs.stdout, /## config/)
})

test('signals stop verification workers and remove temporary base archives', async () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const { root, dispose } = fixture()
    const tmp = join(root, 'tmp')
    mkdirSync(tmp)
    const workerPid = join(root, 'worker.pid')
    writeFileSync(
      join(root, 'src/checkout.ts'),
      `import { writeFileSync } from 'node:fs'; export function placeOrder() { writeFileSync(${JSON.stringify(workerPid)}, String(process.pid)); while (true) {} }`,
    )
    for (const gitArgs of [
      ['init', '-b', 'main', root],
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
      assert.equal(spawnSync('git', gitArgs).status, 0)
    const child = spawn(
      process.execPath,
      [executable, 'check', '--root', root, '--base', 'HEAD', '--json'],
      {
        env: {
          ...process.env,
          BONSAI_ROOT: undefined,
          BONSAI_BASE: undefined,
          BONSAI_POLICY: undefined,
          TMPDIR: tmp,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stderr = ''
    child.stderr.on('data', (data) => {
      stderr += data
    })
    const finished = new Promise<number | null>((resolveExit) => child.on('exit', resolveExit))
    try {
      const deadline = Date.now() + 10000
      while (!existsSync(workerPid) && Date.now() < deadline)
        await new Promise((done) => setTimeout(done, 30))
      assert.ok(existsSync(workerPid), stderr)
      child.kill(signal)
      assert.equal(await finished, signal === 'SIGINT' ? 130 : 143)
      assert.equal(JSON.parse(stderr).code, signal)
      const pid = Number(readFileSync(workerPid, 'utf8'))
      let alive = true
      for (let i = 0; i < 50; i++) {
        try {
          process.kill(pid, 0)
        } catch {
          alive = false
          break
        }
        await new Promise((done) => setTimeout(done, 20))
      }
      assert.equal(alive, false, 'worker survived CLI interruption')
      assert.deepEqual(readdirSync(tmp), [])
    } finally {
      child.kill('SIGKILL')
      dispose()
    }
  }
})

test('timeout stops a long-running verification without producing a passing report', () => {
  const { root, dispose } = fixture()
  try {
    writeFileSync(join(root, 'src/checkout.ts'), 'export function placeOrder() { while (true) {} }')
    const result = run(['check', '--root', root, '--timeout', '0.2', '--json'])
    assert.equal(result.status, 1, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(JSON.parse(result.stderr).code, 'TIMEOUT')
  } finally {
    dispose()
  }
})
