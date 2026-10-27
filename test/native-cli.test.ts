import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { stripVTControlCharacters } from 'node:util'
import { analyzeSource } from './reference.ts'
import { cliEnvironment, executable, runCli } from './cli.ts'
import { createProject } from './project.ts'
import { characters, hasPty, quote } from './terminal.ts'

const repository = resolve('.')
const require = createRequire(import.meta.url)
let native: string | undefined
try {
  const manifest = require.resolve('tsrs/package.json')
  const getExePath = require(join(dirname(manifest), 'lib/getExePath.js')).default
  native = getExePath()
} catch {
  // Unsupported platforms can still exercise enum/help and mocked runtime failures.
}
const hasNative = native !== undefined && existsSync(native)
const canRunMocks = process.platform !== 'win32'

function fixture(
  options: { broken?: boolean; unused?: boolean; budget?: number; handler?: string } = {},
) {
  return createProject(
    {
      'package.json': '{"type":"module"}',
      'handler.ts':
        options.handler ??
        [
          'export function sample(input: { quantity: number }) {',
          ` return { status: ${options.broken ? "'accepted'" : "input.quantity > 0 ? 'accepted' : 'rejected'"} }`,
          '}',
          ...(options.unused ? ['export function unused() { return 42 }'] : []),
          '',
        ].join('\n'),
      'bindings.ts':
        "import { sample } from './handler.ts'\nexport const actions = { sample: sample }\n",
      'sample.feature':
        'Feature: Sample\nScenario Outline: Submit\n When I invoke "sample" with {"quantity": <quantity>}\n Then response "status" equals "<status>"\n Examples:\n | quantity | status |\n | 1 | accepted |\n | 0 | rejected |\n',
    },
    {
      bootstrap: options.budget ?? 10000,
      hardLimit: options.budget ?? 10000,
    },
    'bonsai-native-cli-',
  )
}

function environment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return cliEnvironment({
    BONSAI_NATIVE_BINARY: native,
    TSRS_BINARY: undefined,
    BONSAI_NO_COLOR: '',
    NO_COLOR: '',
    FORCE_COLOR: '',
    TERM: 'xterm-256color',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    COLUMNS: '80',
    ...extra,
  })
}

function cli(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv
    cwd?: string
    executable?: string
    tty?: boolean
    redirect?: string
  } = {},
) {
  const command = [process.execPath, options.executable ?? executable, ...args]
  const settings = {
    cwd: options.cwd ?? repository,
    env: environment(options.env),
    input: '',
    encoding: 'utf8' as const,
    timeout: 25000,
    maxBuffer: 16 * 1024 * 1024,
  }
  const result =
    options.tty || options.executable
      ? spawnSync(
          options.tty ? 'script' : command[0]!,
          options.tty
            ? ['-qefc', command.map(quote).join(' ') + (options.redirect ?? ''), '/dev/null']
            : command.slice(1),
          settings,
        )
      : runCli(args, settings)
  assert.equal(result.error, undefined, String(result.error) + result.stdout + result.stderr)
  assert.equal(result.signal, null, result.stderr)
  return {
    ...result,
    stdout: result.stdout.replaceAll('\r\n', '\n'),
    stderr: result.stderr.replaceAll('\r\n', '\n'),
  }
}

function report(root: string, engine: 'rust' | undefined, args: string[] = []) {
  const result = cli([
    'check',
    '--root',
    root,
    ...(engine ? ['--engine', engine] : []),
    '--json',
    ...args,
  ])
  assert.equal(result.stderr, '', result.stderr)
  return { result, value: JSON.parse(result.stdout) }
}

function withoutMeasurements(value: ReturnType<typeof report>['value']) {
  const copy = structuredClone(value)
  delete copy.timing
  delete copy.snapshot.timing
  delete copy.snapshot.analysis
  if (copy.snapshot.evidence) copy.snapshot.evidence.elapsedMs = 0
  return copy
}

function withoutHumanMeasurements(text: string) {
  const output: string[] = []
  let timing = false
  for (let line of stripVTControlCharacters(text).split('\n')) {
    line = line
      .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s)(?= elapsed\b)/g, '<duration>')
      .replace(/ --engine rust\b/g, '')
      .trimEnd()
    if (line === 'Timing') {
      timing = true
      output.push(line)
    } else if (timing && line) {
      line = line.replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, '<duration>')
      // Duration width can move a continuation without changing the metric row.
      if (/^\s*[├└]─ /.test(line) || line.startsWith('Feedback window:')) output.push(line)
      else output[output.length - 1] += ' ' + line.trim()
    } else {
      if (!line) timing = false
      output.push(line)
    }
  }
  return output.join('\n')
}

function mock(root: string, source: string) {
  const path = join(root, 'collector-worker.mjs')
  writeFileSync(path, `#!${process.execPath}\n${source}\n`, { mode: 0o755 })
  return path
}

function expectReadableRed(text: string, phrase: string, after?: string) {
  const visible = characters(text)
  const plain = visible.map((character) => character.value).join('')
  const anchor = after ? plain.indexOf(after) : 0
  assert.ok(anchor >= 0, `${after} missing from ${plain}`)
  const start = plain.indexOf(phrase, anchor)
  assert.ok(start >= 0, `${phrase} missing from ${plain}`)
  for (const character of visible
    .slice(start, start + phrase.length)
    .filter((item) => item.value.trim())) {
    assert.equal(character.color, 31, `${phrase} must retain the red blocker role`)
    assert.equal(character.dim, false, `${phrase} must remain readable`)
  }
}

test('the Rust engine preserves actual check facts and outcomes for supported projects', {
  skip: !hasNative,
  timeout: 60000,
}, () => {
  for (const options of [{}, { broken: true }, { unused: true }, { budget: 1 }]) {
    const project = fixture(options)
    try {
      const reference = report(project.root, undefined)
      const rust = report(project.root, 'rust')
      assert.equal(rust.result.status, reference.result.status)
      assert.equal(rust.value.snapshot.analysis.engine, 'rust')
      assert.equal(rust.value.snapshot.analysis.backend, 'tsrs')
      assert.equal(rust.value.snapshot.analysis.validation, 'native-diagnostics')
      assert.equal(rust.value.snapshot.analysis.status, 'complete')
      assert.equal(rust.value.snapshot.analysis.version, require('tsrs/package.json').version)
      assert.deepEqual(withoutMeasurements(rust.value), withoutMeasurements(reference.value))
      assert.equal(rust.value.snapshot.evidence.complete, true)
    } finally {
      project.dispose()
    }
  }
})

test('Rust checks keep human, plain, quiet and inspection output on the shared CLI', {
  skip: !hasNative,
  timeout: 60000,
}, () => {
  const project = fixture({ unused: true })
  try {
    for (const args of [
      ['--plain'],
      ['--output', 'human', '--verbose', '--no-color'],
      ['--output', 'human', '--quiet'],
    ]) {
      const reference = cli(['check', '--root', project.root, ...args])
      const rust = cli(['check', '--root', project.root, '--engine', 'rust', ...args])
      assert.equal(rust.status, reference.status)
      if (args.includes('--verbose')) {
        assert.match(rust.stderr, /Rust worker overhead:/)
        assert.match(reference.stderr, /Rust worker overhead:/)
        assert.doesNotMatch(rust.stderr, /Rust compatibility comparison/)
      }
      assert.equal(
        withoutHumanMeasurements(rust.stdout),
        withoutHumanMeasurements(reference.stdout),
      )
      assert.equal(
        withoutHumanMeasurements(rust.stderr),
        withoutHumanMeasurements(reference.stderr),
      )
      assert.doesNotMatch(rust.stdout + rust.stderr, /\x1b\[/)
      if (args[0] === '--plain') assert.equal(rust.stdout.trim().split('\t').length, 8)
    }
    const reference = cli(['explain', 'handler.ts', '--root', project.root, '--json'])
    const rust = cli([
      'explain',
      'handler.ts',
      '--root',
      project.root,
      '--engine',
      'rust',
      '--json',
    ])
    assert.equal(rust.status, reference.status)
    const explanation = JSON.parse(rust.stdout)
    assert.equal(explanation.analysis.engine, 'rust')
    assert.deepEqual(explanation, JSON.parse(reference.stdout))
  } finally {
    project.dispose()
  }
})

test('Rust checks collect native diagnostics and support interpolated templates', {
  skip: !hasNative,
}, () => {
  for (const handler of [
    "export function sample() { const wrong: number = 'text'; return { status: 'accepted' } }\n",
    'export function sample(input: { quantity: number }) { return { status: `value${input.quantity}` } }\n',
  ]) {
    const project = fixture({ handler })
    try {
      const rust = report(project.root, 'rust')
      if (handler.includes('wrong:')) {
        assert.equal(rust.result.status, 2)
        assert.equal(rust.value.decision.status, 'incomplete')
        assert.equal(rust.value.snapshot.evidence, undefined)
        const reference = analyzeSource(project.root, project.files, 'bindings.ts')
        assert.deepEqual(rust.value.snapshot.source.problems, reference.problems)
        assert.match(rust.value.snapshot.source.problems.join('\n'), /not assignable/)
      } else {
        assert.equal(rust.result.status, 1)
        assert.equal(rust.value.decision.status, 'reject')
        assert.equal(rust.value.snapshot.analysis.status, 'complete')
        assert.deepEqual(rust.value.snapshot.source.problems, [])
        assert.equal(rust.value.snapshot.evidence.complete, true)
        assert.ok(
          rust.value.snapshot.evidence.checks.every(
            (check: { status: string }) => check.status === 'failed',
          ),
        )
      }
    } finally {
      project.dispose()
    }
  }
})

test('engine selection validates early and help never requires a native binary', () => {
  const missing = resolve('work/missing-native-collector')
  const help = cli(['check', '--engine', 'rust', '--help', '--json'], {
    env: { BONSAI_NATIVE_BINARY: missing, BONSAI_ROOT: '/missing-project' },
  })
  assert.equal(help.status, 0, help.stderr)
  assert.deepEqual(JSON.parse(help.stdout).flags.engine.choices, ['rust'])
  const invalid = cli(['check', '--engine', 'rusty', '--root', '/missing-project', '--json'])
  assert.equal(invalid.status, 2)
  assert.equal(invalid.stdout, '')
  assert.equal(JSON.parse(invalid.stderr).code, 'USAGE')
  assert.equal(JSON.parse(invalid.stderr).run, 'bonsai help check')
  const retired = cli(['check', '--engine', 'typescript', '--root', '/missing-project', '--json'])
  assert.equal(retired.status, 2)
  assert.equal(retired.stdout, '')
  assert.equal(JSON.parse(retired.stderr).code, 'USAGE')
  assert.equal(JSON.parse(retired.stderr).run, 'bonsai help check')
})

test('native server failures are structured runtime errors and cannot run handlers', {
  skip: !canRunMocks,
}, () => {
  const project = fixture()
  try {
    const marker = join(project.root, 'handler-executed')
    writeFileSync(
      join(project.root, 'handler.ts'),
      `import { writeFileSync } from 'node:fs'\nexport function sample() { writeFileSync(${JSON.stringify(marker)}, 'executed'); return { status: 'accepted' } }\n`,
    )
    assert.deepEqual(analyzeSource(project.root, project.files, 'bindings.ts').problems, [])
    const missing = cli(['check', '--root', project.root, '--engine', 'rust', '--json'], {
      env: { BONSAI_NATIVE_BINARY: join(project.root, 'missing-collector') },
    })
    assert.equal(missing.status, 1, missing.stderr)
    assert.equal(missing.stdout, '')
    assert.equal(JSON.parse(missing.stderr).code, 'RUST_COLLECTOR')
    assert.match(JSON.parse(missing.stderr).error, /missing-collector/)
    assert.match(JSON.parse(missing.stderr).run, /bun install|BONSAI_NATIVE_BINARY/)
    for (const worker of [
      "process.stderr.write('private worker output'); process.exit(7)",
      "process.stdout.write('not JSON')",
    ]) {
      const result = cli(['check', '--root', project.root, '--engine', 'rust', '--json'], {
        env: { BONSAI_NATIVE_BINARY: mock(project.root, worker) },
      })
      assert.equal(result.status, 1, result.stderr)
      assert.equal(result.stdout, '')
      assert.equal(JSON.parse(result.stderr).code, 'RUST_COLLECTOR')
      assert.doesNotMatch(result.stderr, /private worker output|not JSON|SyntaxError/)
      assert.equal(existsSync(marker), false, 'Failed native servers cannot run handlers')
    }
  } finally {
    project.dispose()
  }
})

test('unsupported maintained source remains measured and cannot run handlers', {
  skip: !hasNative,
}, () => {
  const project = fixture()
  try {
    const marker = join(project.root, 'handler-executed')
    writeFileSync(
      join(project.root, 'handler.ts'),
      `import { writeFileSync } from 'node:fs'\nexport function sample() { writeFileSync(${JSON.stringify(marker)}, 'executed'); return { status: 'accepted' } }\n`,
    )
    writeFileSync(join(project.root, 'unsupported.rs'), 'pub fn unsupported() {}\n')
    const config = JSON.parse(readFileSync(join(project.root, 'bonsai.json'), 'utf8'))
    config.maintained.push('unsupported.rs')
    writeFileSync(join(project.root, 'bonsai.json'), JSON.stringify(config))
    const rust = report(project.root, 'rust')
    assert.equal(rust.result.status, 2)
    assert.equal(rust.value.decision.status, 'incomplete')
    assert.equal(rust.value.snapshot.evidence, undefined)
    assert.deepEqual(rust.value.snapshot.source.problems, [
      'Unsupported source language: unsupported.rs',
    ])
    assert.ok(
      rust.value.snapshot.source.files.find(
        (file: { file: string; tokens: number }) =>
          file.file === 'unsupported.rs' && file.tokens > 0,
      ),
    )
    assert.equal(existsSync(marker), false)
  } finally {
    project.dispose()
  }
})

test('Rust source validation also protects the archived base before candidate execution', {
  skip: !hasNative,
}, () => {
  const project = fixture()
  try {
    writeFileSync(join(project.root, 'unsupported.rs'), 'pub fn unsupported() {}\n')
    const config = JSON.parse(readFileSync(join(project.root, 'bonsai.json'), 'utf8'))
    config.maintained.push('unsupported.rs')
    writeFileSync(join(project.root, 'bonsai.json'), JSON.stringify(config))
    for (const args of [
      ['init', '-b', 'main', project.root],
      ['-C', project.root, 'add', ...project.files, 'unsupported.rs'],
      [
        '-C',
        project.root,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'base',
      ],
    ]) {
      const git = spawnSync('git', args, { encoding: 'utf8', timeout: 5000 })
      assert.equal(git.status, 0, git.stderr)
    }
    const result = cli([
      'check',
      '--root',
      project.root,
      '--base',
      'HEAD',
      '--engine',
      'rust',
      '--json',
    ])
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    assert.equal(JSON.parse(result.stderr).code, 'BASE_INCOMPLETE')
    assert.match(JSON.parse(result.stderr).error, /unsupported\.rs/)
  } finally {
    project.dispose()
  }
})

test('native package discovery follows the checker checkout rather than the caller directory', {
  skip: !hasNative,
}, () => {
  const project = fixture()
  mkdirSync(resolve('work'), { recursive: true })
  const checker = mkdtempSync(resolve('work/native-cli-checker-'))
  try {
    cpSync(resolve('src'), join(checker, 'src'), { recursive: true })
    cpSync(resolve('package.json'), join(checker, 'package.json'))
    const marker = join(project.root, 'candidate-server-executed')
    const fakePackage = join(project.root, 'node_modules/tsrs')
    mkdirSync(fakePackage, { recursive: true })
    writeFileSync(
      join(fakePackage, 'package.json'),
      '{"name":"tsrs","version":"0.0.0","main":"index.js"}',
    )
    writeFileSync(
      join(fakePackage, 'index.js'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); throw new Error('candidate tsrs must not load')`,
    )
    const result = cli(['check', '--root', project.root, '--engine', 'rust', '--json'], {
      cwd: project.root,
      executable: join(checker, 'src/cli.ts'),
      env: { BONSAI_NATIVE_BINARY: undefined, CARGO_TARGET_DIR: undefined },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).snapshot.analysis.status, 'complete')
    assert.equal(existsSync(marker), false)
    assert.ok(native)
    const relativeOverride = cli(['check', '--root', project.root, '--engine', 'rust', '--json'], {
      cwd: project.root,
      executable: join(checker, 'src/cli.ts'),
      env: { BONSAI_NATIVE_BINARY: relative(project.root, native), CARGO_TARGET_DIR: undefined },
    })
    assert.equal(relativeOverride.status, 0, relativeOverride.stderr)
    assert.deepEqual(
      withoutMeasurements(JSON.parse(relativeOverride.stdout)),
      withoutMeasurements(JSON.parse(result.stdout)),
    )
    assert.equal(existsSync(marker), false)
  } finally {
    project.dispose()
    rmSync(checker, { recursive: true, force: true })
  }
})

test('native blockers retain readable red text through narrow-terminal wrapping', {
  skip: !hasNative || !hasPty,
}, () => {
  const project = fixture({
    handler:
      'export function sample(input: { quantity: number }) { const target = "./handler.ts"; return import(target) }\n',
  })
  try {
    const args = ['check', '--root', project.root, '--engine', 'rust', '--verbose']
    const color = cli(args, { tty: true, env: { COLUMNS: '24' } })
    assert.equal(color.status, 2, color.stdout + color.stderr)
    const output = color.stdout + color.stderr
    expectReadableRed(output, "Can't trace")
    // The alert's final word wraps at 24 columns; it must retain its role.
    assert.match(stripVTControlCharacters(output), /Can't trace[^\n]*\n\s*import/)
    expectReadableRed(output, 'import', "Can't trace")
    const plain = cli([...args, '--no-color'], { tty: true, env: { COLUMNS: '24' } })
    assert.equal(plain.status, 2)
    assert.doesNotMatch(plain.stdout + plain.stderr, /\x1b\[/)
    assert.equal(
      withoutHumanMeasurements(output),
      withoutHumanMeasurements(plain.stdout + plain.stderr),
    )
    const redirected = join(project.root, 'report.txt')
    const separate = cli(args, {
      tty: true,
      env: { COLUMNS: '24' },
      redirect: ` > ${quote(redirected)}`,
    })
    assert.equal(separate.status, 2)
    expectReadableRed(separate.stdout + separate.stderr, "Can't trace")
    const records = readFileSync(redirected, 'utf8')
    assert.match(records, /^incomplete\t/)
    assert.equal(records.trim().split('\t').length, 8)
    assert.doesNotMatch(records, /\x1b\[/)
  } finally {
    project.dispose()
  }
})

async function dead(pid: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      process.kill(pid, 0)
    } catch {
      return true
    }
    await new Promise((done) => setTimeout(done, 20))
  }
  return false
}

test('command deadlines and SIGINT stop a waiting native worker without reporting success', {
  skip: !canRunMocks,
  timeout: 20000,
}, async () => {
  const project = fixture()
  let child: ReturnType<typeof spawn> | undefined
  try {
    const pidFile = join(project.root, 'native.pid')
    const worker = mock(
      project.root,
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid))\nsetInterval(() => {}, 1000)`,
    )
    const timeout = cli(
      ['check', '--root', project.root, '--engine', 'rust', '--timeout', '5', '--json'],
      { env: { BONSAI_NATIVE_BINARY: worker } },
    )
    assert.equal(timeout.status, 1, timeout.stderr)
    assert.equal(timeout.stdout, '')
    assert.equal(JSON.parse(timeout.stderr).code, 'TIMEOUT')
    assert.ok(existsSync(pidFile), 'The command deadline must interrupt the native worker')
    assert.equal(await dead(Number(readFileSync(pidFile, 'utf8'))), true)
    rmSync(pidFile)
    child = spawn(
      process.execPath,
      [executable, 'check', '--root', project.root, '--engine', 'rust', '--json'],
      { env: environment({ BONSAI_NATIVE_BINARY: worker }), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr!.on('data', (chunk) => {
      stderr += chunk
    })
    const finished = new Promise<number | null>((done) => child!.once('exit', done))
    const deadline = Date.now() + 10000
    while (!existsSync(pidFile) && Date.now() < deadline)
      await new Promise((done) => setTimeout(done, 20))
    assert.ok(existsSync(pidFile), stderr)
    child.kill('SIGINT')
    assert.equal(await finished, 130)
    assert.equal(stdout, '')
    assert.equal(JSON.parse(stderr).code, 'SIGINT')
    assert.equal(await dead(Number(readFileSync(pidFile, 'utf8'))), true)
  } finally {
    child?.kill('SIGKILL')
    project.dispose()
  }
})
