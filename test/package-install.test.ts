import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { NativeInstallError, nativePackage, nativeRepair } from '../src/native-install.ts'
import { sameExecutionIdentity, validExecutionIdentity } from '../src/identity.ts'

const repository = resolve('.')
const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'))

test('native distribution selects prebuilt platforms and keeps unsupported platforms explicit', () => {
  for (const arch of ['x64', 'arm64']) {
    assert.equal(nativePackage('linux', arch, true), `@tsrs/linux-${arch}-gnu`)
    assert.equal(nativePackage('linux', arch, false), `@tsrs/linux-${arch}-musl`)
  }
  assert.equal(nativePackage('darwin', 'arm64', false), '@tsrs/darwin-arm64')
  for (const [platform, arch] of [
    ['win32', 'x64'],
    ['darwin', 'x64'],
    ['linux', 'ia32'],
  ]) {
    assert.throws(
      () => nativePackage(platform!, arch!, true),
      (error: unknown) => {
        assert.ok(error instanceof NativeInstallError)
        assert.ok(error.message.includes(`No packaged Rust checker for ${platform}-${arch}`))
        assert.ok(error.message.includes(`tsrs@${manifest.dependencies.tsrs}`))
        assert.ok(error.message.includes(`/tree/v${manifest.dependencies.tsrs.split('-ts')[0]}`))
        assert.equal(error.run, 'export BONSAI_NATIVE_BINARY=/absolute/path/to/tsrs')
        return true
      },
    )
  }
  assert.match(nativeRepair(), /bun install --frozen-lockfile/)
})

test('production tarball runs through bunx with prebuilt dependencies and no Node or Rust toolchain', {
  skip: process.env.BONSAI_PACKAGE_SMOKE !== '1',
  timeout: 180000,
}, () => {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-package-'))
  const consumer = join(root, 'consumer')
  const bin = join(root, 'bin')
  mkdirSync(consumer)
  mkdirSync(bin)
  symlinkSync(process.execPath, join(bin, 'bun'))
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: bin,
    BUN_INSTALL_CACHE_DIR: join(root, 'cache'),
    BUN_OPTIONS: undefined,
    NODE_OPTIONS: undefined,
    NODE_PATH: undefined,
    BONSAI_ROOT: undefined,
    BONSAI_BASE: undefined,
    BONSAI_POLICY: undefined,
    BONSAI_NATIVE_BINARY: undefined,
    BONSAI_NATIVE_SESSION: undefined,
    TSRS_BINARY: undefined,
    CI: '1',
    NO_COLOR: '1',
    FORCE_COLOR: undefined,
  }
  const run = (args: string[], cwd = consumer, env = environment) => {
    const result = spawnSync(process.execPath, args, {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    })
    assert.equal(result.error, undefined, String(result.error))
    assert.equal(result.signal, null, result.stderr)
    return result
  }
  const bonsai = (args: string[], cwd = consumer, env = environment) =>
    run(['x', '--bun', '--no-install', '--package', '@jigging/bonsai', 'bonsai', ...args], cwd, env)
  try {
    const packed = run(
      ['pm', 'pack', '--ignore-scripts', '--filename', join(root, 'bonsai.tgz')],
      repository,
    )
    assert.equal(packed.status, 0, packed.stderr)
    const listing = spawnSync('tar', ['-tzf', join(root, 'bonsai.tgz')], { encoding: 'utf8' })
    assert.equal(listing.status, 0, listing.stderr)
    assert.doesNotMatch(listing.stdout, /^package\/(?:test|native)\//m)
    for (const file of listing.stdout
      .trim()
      .split('\n')
      .filter((file) => /^package\/src\/.*\.ts$/.test(file))) {
      const source = spawnSync('tar', ['-xOf', join(root, 'bonsai.tgz'), file], {
        encoding: 'utf8',
      })
      assert.equal(source.status, 0, source.stderr)
      assert.doesNotMatch(source.stdout, /\b(?:createCompilerSession|analyzeSource)\b/, file)
    }
    writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n')
    const installed = run([
      'add',
      '--production',
      '--ignore-scripts',
      '--no-save',
      join(root, 'bonsai.tgz'),
    ])
    assert.equal(installed.status, 0, installed.stderr)
    const require = createRequire(join(consumer, 'package.json'))
    const checker = require.resolve('@jigging/bonsai/package.json')
    const checkerRequire = createRequire(checker)
    for (const dependency of ['typescript', 'tsrs'])
      assert.ok(realpathSync(checkerRequire.resolve(`${dependency}/package.json`)).startsWith(root))
    const version = bonsai(['version', '--json'])
    assert.equal(version.status, 0, version.stderr)
    assert.equal(JSON.parse(version.stdout).version, manifest.version)

    const firstRun = join(consumer, 'first-run')
    mkdirSync(join(firstRun, 'src'), { recursive: true })
    const application = readFileSync(join(repository, 'examples/checkout/src/checkout.ts'))
    writeFileSync(join(firstRun, 'src/checkout.ts'), application)
    const unconfigured = bonsai(['check'], firstRun)
    assert.equal(unconfigured.status, 2, unconfigured.stderr)
    assert.equal(unconfigured.stdout, '')
    assert.match(unconfigured.stderr, /Configuration not found:/)
    assert.match(unconfigured.stderr, /bonsai init --root/)
    assert.ok(unconfigured.stderr.includes(firstRun))
    assert.doesNotMatch(unconfigured.stderr, /ENOENT|statx|^\s*\{/)

    const initialized = bonsai(['init', '--json'], firstRun)
    assert.equal(initialized.status, 0, initialized.stderr)
    const starter = JSON.parse(initialized.stdout)
    assert.deepEqual(readFileSync(join(firstRun, 'src/checkout.ts')), application)
    assert.equal(existsSync(join(firstRun, 'README.md')), false)
    assert.equal(starter.config.maintained.includes('README.md'), false)
    for (const path of starter.config.maintained)
      assert.ok(existsSync(join(firstRun, path)), `Initialized inventory contains ${path}`)
    const unfinished = bonsai(['check', '--output', 'human'], firstRun)
    assert.equal(unfinished.status, 2, unfinished.stderr)
    assert.equal(unfinished.stdout, '')
    assert.match(unfinished.stderr, /Incomplete/)
    assert.match(unfinished.stderr, /No executable scenarios/)
    assert.match(unfinished.stderr, /Commented starter scenarios don't run/)
    assert.match(unfinished.stderr, /bonsai.bindings.ts/)
    assert.doesNotMatch(unfinished.stderr, /ENOENT|statx/)

    cpSync(
      join(repository, 'examples/checkout/bindings.ts'),
      join(firstRun, starter.config.bindings),
    )
    cpSync(
      join(repository, 'examples/checkout/features/checkout.feature'),
      join(firstRun, 'features/bonsai.feature'),
    )
    const connected = bonsai(['check', '--json'], firstRun)
    assert.equal(connected.status, 0, connected.stderr)
    const connectedReport = JSON.parse(connected.stdout)
    assert.equal(connectedReport.decision.status, 'pass')
    assert.equal(connectedReport.snapshot.evidence.complete, true)
    assert.deepEqual(
      connectedReport.snapshot.evidence.checks.map((check: { status: string }) => check.status),
      ['passed', 'passed', 'passed'],
    )
    const authored: string[] = ['src/checkout.ts', ...starter.created]
    const preserved = authored.map((path) => readFileSync(join(firstRun, path)))
    const repeated = bonsai(['init', '--json'], firstRun)
    assert.equal(repeated.status, 2, repeated.stderr)
    assert.equal(repeated.stdout, '')
    assert.equal(JSON.parse(repeated.stderr).code, 'CONFIG_EXISTS')
    authored.forEach((path, index) =>
      assert.deepEqual(readFileSync(join(firstRun, path)), preserved[index], path),
    )
    assert.deepEqual(readFileSync(join(firstRun, 'src/checkout.ts')), application)

    const project = join(consumer, 'project')
    cpSync(join(repository, 'examples/checkout'), project, { recursive: true })
    const args = ['check', '--root', project, '--json', '--report', '.bonsai/report.html']
    const checked = bonsai(args)
    assert.equal(checked.status, 0, checked.stderr)
    const report = JSON.parse(checked.stdout)
    const html = readFileSync(join(project, '.bonsai/report.html'), 'utf8')
    const embedded = html.match(
      /<script[^>]*id="bonsai-report-data"[^>]*>([\s\S]*?)<\/script>/,
    )?.[1]
    assert.ok(embedded, 'The installed package includes its standalone report renderer')
    assert.deepEqual(JSON.parse(embedded).decision, report.decision)
    assert.equal((html.match(/data:font\/woff2;base64,/g) ?? []).length, 3)
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+rel="stylesheet"/)
    assert.equal(report.decision.status, 'pass')
    assert.equal(report.snapshot.analysis.backend, 'tsrs')
    assert.equal(report.snapshot.evidence.complete, true)
    assert.equal(validExecutionIdentity(report.snapshot.identity), true)
    assert.equal(
      sameExecutionIdentity(report.snapshot.identity, report.snapshot.evidence.identity),
      true,
    )
    assert.deepEqual(
      report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
      ['passed', 'passed', 'passed'],
    )
    const compilerRequire = createRequire(checkerRequire.resolve('tsrs/package.json'))
    const loader =
      process.arch === 'arm64' ? '/lib/ld-linux-aarch64.so.1' : '/lib64/ld-linux-x86-64.so.2'
    if (process.platform === 'linux') {
      const musl = dirname(
        compilerRequire.resolve(`${nativePackage('linux', process.arch, false)}/package.json`),
      )
      assert.ok(
        realpathSync(musl).startsWith(root),
        'The fresh installation must include static musl',
      )
      if (existsSync(loader))
        assert.ok(
          realpathSync(
            compilerRequire.resolve(`${nativePackage('linux', process.arch, true)}/package.json`),
          ).startsWith(root),
          'GNU hosts must receive both prebuilt Linux variants',
        )
      const staticCheck = bonsai(args, consumer, {
        ...environment,
        BONSAI_NATIVE_BINARY: join(musl, 'tsrs'),
      })
      assert.equal(staticCheck.status, 0, staticCheck.stderr)
      const staticReport = JSON.parse(staticCheck.stdout)
      assert.equal(validExecutionIdentity(staticReport.snapshot.identity), true)
      assert.equal(
        sameExecutionIdentity(
          staticReport.snapshot.identity,
          staticReport.snapshot.evidence.identity,
        ),
        true,
      )
      const installedIdentity = report.snapshot.identity
      const staticIdentity = staticReport.snapshot.identity
      assert.deepEqual(staticIdentity.checker, installedIdentity.checker)
      assert.deepEqual(staticIdentity.runtime, installedIdentity.runtime)
      assert.equal(staticIdentity.compiler.name, installedIdentity.compiler.name)
      assert.equal(staticIdentity.compiler.version, installedIdentity.compiler.version)
      const defaultNative = join(
        dirname(
          compilerRequire.resolve(
            `${nativePackage('linux', process.arch, existsSync(loader))}/package.json`,
          ),
        ),
        'tsrs',
      )
      const sameNativeBytes = readFileSync(defaultNative).equals(readFileSync(join(musl, 'tsrs')))
      assert.equal(
        staticIdentity.compiler.digest === installedIdentity.compiler.digest,
        sameNativeBytes,
        'Selected native bytes, not binary location or version alone, determine toolchain identity',
      )
      const comparable = (value: typeof report) => {
        const copy = structuredClone(value)
        delete copy.timing
        delete copy.snapshot.timing
        copy.snapshot.evidence.elapsedMs = 0
        // GNU and static-musl behavior must match after independently validating their identities.
        copy.snapshot.identity.compiler.digest = '<selected-native-variant>'
        copy.snapshot.evidence.identity.compiler.digest = '<selected-native-variant>'
        return copy
      }
      assert.deepEqual(comparable(staticReport), comparable(report))
    }
    const selected = nativePackage(process.platform, process.arch, existsSync(loader))
    const optional = dirname(compilerRequire.resolve(`${selected}/package.json`))
    renameSync(optional, optional + '.missing')
    try {
      const missing = bonsai(args)
      assert.equal(missing.status, 1, missing.stderr)
      assert.equal(missing.stdout, '')
      const error = JSON.parse(missing.stderr)
      assert.equal(error.code, 'RUST_COLLECTOR')
      assert.match(error.error, /Prebuilt Rust checker.*isn't installed/)
      assert.equal(error.run, `bun add --global @jigging/bonsai@${manifest.version} --force`)
      assert.doesNotMatch(error.run, /cache|frozen-lockfile/)
    } finally {
      renameSync(optional + '.missing', optional)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
