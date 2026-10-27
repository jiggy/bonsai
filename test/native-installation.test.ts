import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { cliEnvironment, executable } from './cli.ts'
import { createProject } from './project.ts'
import { characters, hasPty, quote } from './terminal.ts'

const require = createRequire(import.meta.url)
const manifest = require.resolve('tsrs/package.json')
const tsrs = require('tsrs/package.json')
const version: string = tsrs.version
const optionalDependencies = tsrs.optionalDependencies as Record<string, string>
const platform = `${process.platform}-${process.arch}`
const packaged = Object.keys(optionalDependencies).some(
  (name) => name === `@tsrs/${platform}` || name.startsWith(`@tsrs/${platform}-`),
)
const localRepair = 'export BONSAI_NATIVE_BINARY=/absolute/path/to/tsrs'

function fixture() {
  const project = createProject({
    'package.json': '{"type":"module"}',
    'handler.ts':
      "import { writeFileSync } from 'node:fs'\nexport function sample() { writeFileSync(new URL('./handler-executed', import.meta.url), 'executed'); return { status: 'accepted' } }\n",
    'bindings.ts':
      "import { sample } from './handler.ts'\nexport const actions = { sample: sample }\n",
    'sample.feature':
      'Feature: Sample\nScenario: Submit\n When I invoke "sample" with {}\n Then response "status" equals "accepted"\n',
  })
  return { ...project, marker: join(project.root, 'handler-executed') }
}

/** Keep the real pinned SDK, but omit its platform packages from module resolution. */
function missingInstallation() {
  const root = mkdtempSync(join(tmpdir(), "bonsai-native's-installation-"))
  const modules = join(root, 'node_modules')
  try {
    cpSync(resolve('src'), join(root, 'src'), { recursive: true })
    cpSync(resolve('package.json'), join(root, 'package.json'))
    cpSync(resolve('bun.lock'), join(root, 'bun.lock'))
    mkdirSync(modules)
    cpSync(dirname(manifest), join(modules, 'tsrs'), { recursive: true })
    for (const name of readdirSync(resolve('node_modules'))) {
      if (name.startsWith('.') || name === 'tsrs' || name === '@tsrs') continue
      symlinkSync(resolve('node_modules', name), join(modules, name), 'dir')
    }
    return { executable: join(root, 'src/cli.ts'), root }
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}

function cli(
  root: string,
  args: string[] = ['check', '--json'],
  env: NodeJS.ProcessEnv = {},
  entry = executable,
) {
  const result = spawnSync(process.execPath, [entry, ...args, '--root', root, '--engine', 'rust'], {
    encoding: 'utf8',
    timeout: 20000,
    env: cliEnvironment({
      BONSAI_NATIVE_BINARY: undefined,
      TSRS_BINARY: undefined,
      BONSAI_NATIVE_SESSION: undefined,
      ...env,
    }),
  })
  assert.equal(result.error, undefined, String(result.error))
  assert.equal(result.signal, null, result.stderr)
  return result
}

test('native installation failures give host-specific repairs through check and explain', {
  timeout: 30000,
}, () => {
  const installation = missingInstallation()
  const project = fixture()
  try {
    for (const command of [['check'], ['explain', 'handler.ts']]) {
      for (const mode of [['--json'], [], ['--quiet']]) {
        const result = cli(project.root, [...command, ...mode], {}, installation.executable)
        assert.equal(result.status, 1, result.stderr)
        assert.equal(result.stdout, '')
        assert.doesNotMatch(result.stderr, /\bTSRS_BINARY\b|Cannot find the optional dependency/)
        if (mode.includes('--json')) {
          const error = JSON.parse(result.stderr)
          assert.equal(error.code, 'RUST_COLLECTOR')
          if (packaged) {
            assert.match(error.error, /Prebuilt Rust checker @tsrs\/.* isn't installed/)
            assert.ok(error.error.includes(version))
            const quoted = realpathSync(installation.root).replaceAll("'", "'\\''")
            assert.equal(error.run, `cd '${quoted}/' && bun install --frozen-lockfile`)
          } else {
            assert.ok(error.error.includes(`No packaged Rust checker for ${platform}`))
            assert.ok(error.error.includes(`tsrs@${version}`))
            assert.ok(error.error.includes(`/tree/v${version.split('-ts')[0]}`))
            assert.equal(error.run, localRepair)
            assert.doesNotMatch(result.stderr, /bun install|unset BONSAI_NATIVE_BINARY/)
          }
        } else {
          assert.match(result.stderr, /Next (?:→|->)/)
          assert.match(result.stderr, packaged ? /bun install/ : /BONSAI_NATIVE_BINARY/)
        }
        assert.equal(existsSync(project.marker), false, 'Missing analysis cannot run handlers')
      }
    }
  } finally {
    project.dispose()
    rmSync(installation.root, { recursive: true, force: true })
  }
})

test('the actual unsupported host reports the local-binary repair after a normal install', {
  skip: packaged,
}, () => {
  const project = fixture()
  try {
    const result = cli(project.root)
    assert.equal(result.status, 1, result.stderr)
    assert.equal(result.stdout, '')
    const error = JSON.parse(result.stderr)
    assert.ok(error.error.includes(`No packaged Rust checker for ${platform}`))
    assert.equal(error.run, localRepair)
    assert.doesNotMatch(result.stderr, /\bTSRS_BINARY\b|bun install/)
    assert.equal(existsSync(project.marker), false)
  } finally {
    project.dispose()
  }
})

test('a missing explicit native override never suggests discarding it and reinstalling', () => {
  const project = fixture()
  try {
    const missing = join(project.root, 'missing-tsrs')
    const result = cli(project.root, ['check', '--json'], { BONSAI_NATIVE_BINARY: missing })
    assert.equal(result.status, 1, result.stderr)
    assert.equal(result.stdout, '')
    const error = JSON.parse(result.stderr)
    assert.ok(error.error.includes(missing))
    assert.equal(error.run, localRepair)
    assert.doesNotMatch(result.stderr, /bun install|unset BONSAI_NATIVE_BINARY/)
    assert.equal(existsSync(project.marker), false)
  } finally {
    project.dispose()
  }
})

test('inherited TSRS_BINARY stays ignored and is never recommended as a repair', () => {
  const installation = missingInstallation()
  const project = fixture()
  try {
    const marker = join(project.root, 'upstream-binary-executed')
    const upstream = join(project.root, 'upstream.mjs')
    writeFileSync(
      upstream,
      `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')\n`,
      { mode: 0o755 },
    )
    const result = cli(
      project.root,
      ['check', '--json'],
      { TSRS_BINARY: upstream },
      installation.executable,
    )
    assert.equal(result.status, 1, result.stderr)
    assert.doesNotMatch(result.stderr, /\bTSRS_BINARY\b/)
    assert.equal(existsSync(marker), false)
    assert.equal(existsSync(project.marker), false)
  } finally {
    project.dispose()
    rmSync(installation.root, { recursive: true, force: true })
  }
})

test('installation alerts remain readable red across wrapped terminal lines', {
  skip: !hasPty,
}, () => {
  const installation = missingInstallation()
  const project = fixture()
  try {
    const command = [
      process.execPath,
      installation.executable,
      'check',
      '--root',
      project.root,
      '--engine',
      'rust',
    ]
    for (const noColor of ['', '1']) {
      const result = spawnSync('script', ['-qefc', command.map(quote).join(' '), '/dev/null'], {
        encoding: 'utf8',
        timeout: 20000,
        env: cliEnvironment({
          BONSAI_NATIVE_BINARY: undefined,
          TSRS_BINARY: undefined,
          BONSAI_NATIVE_SESSION: undefined,
          COLUMNS: '32',
          TERM: 'xterm-256color',
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8',
          NO_COLOR: noColor,
        }),
      })
      assert.equal(result.error, undefined)
      assert.equal(result.status, 1, result.stdout + result.stderr)
      const visible = characters(result.stdout)
      const plain = visible.map((character) => character.value).join('')
      const start = plain.indexOf('✗ ')
      const end = plain.indexOf('  Next', start)
      assert.ok(start >= 0 && end > start, plain)
      const alert = visible.slice(start, end)
      assert.ok(alert.filter((character) => character.value === '\n').length > 1, plain)
      if (noColor) assert.doesNotMatch(result.stdout, /\x1b\[/)
      else {
        for (const character of alert.filter((character) => character.value.trim())) {
          assert.equal(character.color, 31, plain)
          assert.equal(character.dim, false, plain)
        }
      }
      assert.equal(existsSync(project.marker), false)
    }
  } finally {
    project.dispose()
    rmSync(installation.root, { recursive: true, force: true })
  }
})

test('a configured local Rust checker completes real native analysis and verification', {
  skip: process.env.BONSAI_NATIVE_BINARY === undefined,
}, () => {
  const project = fixture()
  try {
    const binary = process.env.BONSAI_NATIVE_BINARY!
    const reported = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 10000 })
    assert.equal(reported.status, 0, reported.stderr)
    assert.ok(reported.stdout.includes(version), reported.stdout)
    const result = cli(project.root, ['check', '--json'], {
      BONSAI_NATIVE_BINARY: binary,
      TSRS_BINARY: join(project.root, 'ignored-upstream-binary'),
    })
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    assert.equal(report.snapshot.analysis.engine, 'rust')
    assert.equal(report.snapshot.analysis.backend, 'tsrs')
    assert.equal(report.snapshot.analysis.version, version)
    assert.equal(report.snapshot.analysis.validation, 'native-diagnostics')
    assert.equal(report.snapshot.evidence.complete, true)
    assert.ok(
      report.snapshot.evidence.checks.every(
        (check: { status: string }) => check.status === 'passed',
      ),
    )
    assert.equal(existsSync(project.marker), true)
  } finally {
    project.dispose()
  }
})
