import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileContracts } from '../src/contracts.ts'
import { fingerprint, inventory } from '../src/inventory.ts'
import { runEvidence } from '../src/evidence.ts'
import { collectStandaloneRust } from '../src/standalone-rust.ts'
import { Timer } from '../src/timing.ts'
import { project } from '../features/support/project.ts'
import { runCli, executable, cliEnvironment } from './cli.ts'

const contract =
  'Feature: Native Rust application\nScenario: Read an order\n When I invoke "ready" with {}\n Then response "status" equals "ready"\n'


// Explicitly trusted compiler instrumentation preserves lifecycle/integrity probes
// without granting filesystem or thread operations to maintained candidate code.
function instrumentRust(before: string, analyzerOverride?: string) {
  const installed = (name: string) => {
    const result = spawnSync('rustup', ['which', '--toolchain', '1.86.0', name], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const rustc = installed('rustc')
  const analyzer = analyzerOverride ?? installed('rust-analyzer')
  const tools = mkdtempSync(join(tmpdir(), 'bonsai-trusted-rust-probe-'))
  const wrapper = join(tools, 'rustc')
  const needle = 'let value = handler(&payload);'
  writeFileSync(wrapper, '#!' + process.execPath + '\n' + [
    'import { readFileSync, writeFileSync } from "node:fs";',
    'import { spawnSync } from "node:child_process";',
    'const args = process.argv.slice(2); const source = args.find(arg => arg.endsWith("/harness.rs"));',
    'if (source) { const text = readFileSync(source, "utf8"); const needle = ' + JSON.stringify(needle) + '; if (!text.includes(needle)) process.exit(86); writeFileSync(source, text.replace(needle, ' + JSON.stringify(before + '\n' + needle) + ')); }',
    'const result = spawnSync(' + JSON.stringify(rustc) + ', args, { stdio: "inherit" }); process.exit(result.status ?? 1);',
  ].join('\n') + '\n', { mode: 0o755 })
  writeFileSync(join(tools, 'rustup'), '#!' + process.execPath + '\nconst tools = ' +
    JSON.stringify({ rustc: wrapper, 'rust-analyzer': analyzer }) +
    '; process.stdout.write(tools[process.argv.at(-1)] + "\\n");\n', { mode: 0o755 })
  return { env: cliEnvironment({ PATH: tools + ':' + process.env.PATH }),
    dispose: () => rmSync(tools, { recursive: true, force: true }) }
}

test('a Rust team checks ordinary native bindings without a TypeScript bridge', {
  skip: process.env.BONSAI_RUST_PROBE !== '1',
  timeout: 60000,
}, () => {
  const fixture = project(
    {
      'bindings.rs':
        'mod orders;\npub fn actions() -> &\'static [(&\'static str, fn(&str) -> String)] {\n &[ ("ready", orders::ready) ]\n}\n',
      'orders.rs':
        'pub fn ready(_input: &str) -> String { String::from(r#"{\"status\":\"ready\"}"#) }\n',
      'orders.feature': contract,
    },
    {},
    { bindings: 'bindings.rs' },
  )
  try {
    const guard = join(fixture.root, 'guard.mjs')
    writeFileSync(
      guard,
      `import { plugin } from 'bun'; plugin({ name: 'no-typescript', setup(build) { build.onLoad({ filter: /typescript[.]js$/ }, () => { throw new Error('RUST_TYPESCRIPT_LOAD_FORBIDDEN') }) } })`,
    )
    const env = cliEnvironment({ BUN_OPTIONS: '--preload ' + pathToFileURL(guard).href })
    const control = spawnSync(process.execPath, ['-e', 'await import("typescript")'], {
      env,
      encoding: 'utf8',
    })
    assert.notEqual(control.status, 0)
    assert.match(control.stderr, /RUST_TYPESCRIPT_LOAD_FORBIDDEN/)
    const result = runCli(['check', '--root', fixture.root, '--json'], { timeout: 60000, env })
    const report = JSON.parse(result.stdout || result.stderr)
    console.info(JSON.stringify({ exitCode: result.status, report }))
    assert.equal(result.status, 0)
    assert.equal(report.decision.status, 'pass')
    assert.equal(report.snapshot.evidence.complete, true)
    assert.deepEqual(
      report.snapshot.evidence.checks.map((check: { status: string }) => check.status),
      ['passed'],
    )
    const explained = runCli(['explain', 'orders.rs#ready', '--root', fixture.root, '--json'], {
      timeout: 60000,
      env,
    })
    assert.equal(explained.status, 0, explained.stdout + explained.stderr)
  } finally {
    fixture.dispose()
  }
})

test('interrupted standalone Rust collection retains complete measured inventory', async () => {
  const fixture = project(
    { 'bindings.rs': 'pub fn actions() {}\n' },
    {},
    { bindings: 'bindings.rs' },
  )
  try {
    const timer = new Timer()
    const result = await collectStandaloneRust(
      fixture.root,
      fixture.config.maintained,
      'bindings.rs',
      undefined,
      0,
      timer,
    )
    assert.equal(result.interrupted, true)
    assert.equal(result.identity, undefined)
    assert.deepEqual(result.source.components, [])
    assert.equal(result.source.files.length, fixture.config.maintained.length)
    assert.ok(result.source.files.find((file) => file.file === 'bindings.rs')!.tokens > 0)
    assert.match(result.source.problems.join('\n'), /Rust source analysis interrupted/)
    assert.equal(timer.report().stages.at(-1)!.status, 'interrupted')
  } finally {
    fixture.dispose()
  }
})

test('a stalled Rust analyzer reports measured incomplete analysis and is reaped', {
  skip: process.env.BONSAI_RUST_PROBE !== '1' || process.platform !== 'linux',
  timeout: 30000,
}, () => {
  const installed = (name: string) => {
    const result = spawnSync('rustup', ['which', '--toolchain', '1.86.0', name], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const rustc = installed('rustc'),
    analyzer = installed('rust-analyzer')
  const tools = mkdtempSync(join(tmpdir(), 'bonsai-stalled-rust-'))
  const marker = join(tools, 'pid'),
    wrapper = join(tools, 'analyzer')
  writeFileSync(
    wrapper,
    '#!' +
      process.execPath +
      '\nimport { spawnSync } from "node:child_process"; import { writeFileSync } from "node:fs";\n' +
      'if (process.argv.includes("--version")) { const result = spawnSync(' +
      JSON.stringify(analyzer) +
      ', ["--version"]); process.stdout.write(result.stdout); process.exit(result.status ?? 1) }\n' +
      'writeFileSync(' +
      JSON.stringify(marker) +
      ', String(process.pid)); setInterval(() => {}, 1000)\n',
    { mode: 0o755 },
  )
  writeFileSync(
    join(tools, 'rustup'),
    '#!' +
      process.execPath +
      '\nconst tools = ' +
      JSON.stringify({ rustc, 'rust-analyzer': wrapper }) +
      '; process.stdout.write(tools[process.argv.at(-1)] + "\\n")\n',
    { mode: 0o755 },
  )
  const fixture = project(
    { 'bindings.rs': 'pub fn actions() {}\n' },
    { maxFeedbackMs: 3000 },
    { bindings: 'bindings.rs' },
  )
  try {
    const result = runCli(['check', '--root', fixture.root, '--json'], {
      env: cliEnvironment({ PATH: tools + ':' + process.env.PATH }),
      timeout: 10000,
    })
    assert.equal(result.status, 2, result.stdout + result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.decision.status, 'incomplete')
    assert.ok(
      report.snapshot.source.files.find((file: any) => file.file === 'bindings.rs').tokens > 0,
    )
    assert.equal(report.snapshot.evidence, undefined)
    assert.deepEqual(report.snapshot.source.components, [])
    assert.match(report.snapshot.source.problems.join('\n'), /Rust source analysis interrupted/)
    assert.equal(
      report.snapshot.timing.stages.find((stage: any) => stage.name === 'source').status,
      'interrupted',
    )
    assert.equal(existsSync(marker), true, 'The analyzer must actually reach its blocked protocol')
    const pid = Number(readFileSync(marker, 'utf8'))
    assert.ok(Number.isSafeInteger(pid) && pid > 0)
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } finally {
    fixture.dispose()
    rmSync(tools, { recursive: true, force: true })
  }
})

test('Rust identity recheck deadlines preserve the completed source report', {
  skip: process.env.BONSAI_RUST_PROBE !== '1' || process.platform !== 'linux',
  timeout: 30000,
}, () => {
  const installed = (name: string) => {
    const result = spawnSync('rustup', ['which', '--toolchain', '1.86.0', name], {
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const rustc = installed('rustc'),
    analyzer = installed('rust-analyzer')
  const tools = mkdtempSync(join(tmpdir(), 'bonsai-rust-recheck-'))
  const marker = join(tools, 'recheck-pid'),
    first = join(tools, 'first-capture')
  writeFileSync(
    join(tools, 'rustup'),
    '#!' +
      process.execPath +
      '\nimport { existsSync, writeFileSync, renameSync } from "node:fs";\n' +
      'const tools = ' +
      JSON.stringify({ rustc, 'rust-analyzer': analyzer }) +
      '; const name = process.argv.at(-1);\n' +
      'if (name === "rust-analyzer" && existsSync(' +
      JSON.stringify(first) +
      ')) { writeFileSync(' +
      JSON.stringify(marker + '.pending') +
      ', String(process.pid)); renameSync(' +
      JSON.stringify(marker + '.pending') +
      ', ' +
      JSON.stringify(marker) +
      '); setInterval(() => {}, 1000) } else { if (name === "rust-analyzer") writeFileSync(' +
      JSON.stringify(first) +
      ', "captured"); process.stdout.write(tools[name] + "\\n") }\n',
    { mode: 0o755 },
  )
  const fixture = project(
    {
      'bindings.rs':
        'mod orders;\npub fn actions() -> &\'static [(&\'static str, fn(&str) -> String)] { &[("ready", orders::ready)] }\n',
      'orders.rs':
        'pub fn ready(_input: &str) -> String { String::from(r#"{"status":"ready"}"#) }\n',
      'orders.feature': contract,
    },
    { maxFeedbackMs: 5000 },
    { bindings: 'bindings.rs' },
  )
  try {
    const result = runCli(['check', '--root', fixture.root, '--json'], {
      env: cliEnvironment({ PATH: tools + ':' + process.env.PATH }),
      timeout: 10000,
    })
    assert.equal(result.status, 2, result.stdout + result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.decision.status, 'incomplete')
    assert.ok(
      report.snapshot.source.files.find((file: any) => file.file === 'orders.rs').tokens > 0,
    )
    assert.ok(
      report.snapshot.source.components.some(
        (component: any) => component.id === 'orders.rs#ready',
      ),
      'Collection must finish before the controlled recheck timeout',
    )
    assert.equal(report.snapshot.evidence, undefined)
    assert.match(report.snapshot.source.problems.join('\n'), /identity recheck interrupted/)
    assert.equal(
      report.snapshot.timing.stages.find((stage: any) => stage.name === 'analysis-integrity')
        .status,
      'interrupted',
    )
    const pid = Number(readFileSync(marker, 'utf8'))
    assert.ok(Number.isSafeInteger(pid) && pid > 0)
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } finally {
    fixture.dispose()
    rmSync(tools, { recursive: true, force: true })
  }
})

test('native Rust graph, process state, unsupported boundaries and source drift use the real CLI', {
  skip: process.env.BONSAI_RUST_PROBE !== '1',
  timeout: 180000,
}, () => {
  const registry = (extra = '') =>
    'mod orders;\npub fn actions() -> &\'static [(&\'static str, fn(&str) -> String)] { &[ ("ready", orders::ready)' +
    extra +
    ' ] }\n'
  const handler =
    'pub fn ready(_input: &str) -> String { String::from(r#"{\"status\":\"ready\"}"#) }\n'
  const check = (
    sources: Record<string, string>,
    args: string[] = [],
    policy: Record<string, unknown> = {},
    before?: (root: string) => string,
  ) => {
    const fixture = project(
      { 'bindings.rs': registry(), 'orders.rs': handler, 'orders.feature': contract, ...sources },
      policy,
      { bindings: 'bindings.rs' },
    )
    const probe = before ? instrumentRust(before(fixture.root)) : undefined
    try {
      const result = runCli(['check', '--root', fixture.root, '--json', ...args], {
        timeout: 60000,
        env: probe?.env,
      })
      const report = JSON.parse(result.stdout || result.stderr)
      console.info(
        JSON.stringify({ label: Object.keys(sources), args, exitCode: result.status, report }),
      )
      return { exitCode: result.status, report }
    } finally {
      probe?.dispose()
      fixture.dispose()
    }
  }
  const unused = check({
    'bindings.rs': registry(', ("unused", orders::unused)'),
    'orders.rs':
      handler + 'pub fn unused(_input: &str) -> String { String::from("fn forged() {}") }\n',
  })
  assert.equal(unused.exitCode, 1)
  assert.equal(unused.report.decision.status, 'reject')
  assert.deepEqual(unused.report.snapshot.unrooted, ['orders.rs#unused'])
  assert.equal(
    unused.report.snapshot.source.components.some(
      (component: { name: string }) => component.name === 'forged',
    ),
    false,
  )
  assert.deepEqual(unused.report.snapshot.source.problems, [])
  assert.ok(
    unused.report.snapshot.source.files.find((file: { file: string }) => file.file === 'orders.rs')
      .tokens > 0,
  )
  assert.equal(unused.report.snapshot.evidence.complete, true)
  const wrong = check({ 'orders.rs': handler.replace('ready\"}', 'wrong\"}') })
  assert.equal(wrong.exitCode, 1)
  assert.equal(wrong.report.snapshot.evidence.checks[0].status, 'failed')
  const stateSource = [
    'use std::sync::atomic::{AtomicUsize, Ordering};',
    'static COUNT: AtomicUsize = AtomicUsize::new(0);',
    'pub fn ready(_input: &str) -> String {',
    ' let count = COUNT.fetch_add(1, Ordering::SeqCst) + 1;',
    ' String::from("{\\"count\\":") + &count.to_string() + "}"',
    '}',
  ].join('\n')
  const stateContract = (serial: boolean) =>
    'Feature: Counter\nScenario: First\n When I invoke "ready" with {}\n Then response "count" equals 1\nScenario: Second\n When I invoke "ready" with {}\n Then response "count" equals ' +
    (serial ? '2' : '1') +
    '\n'
  for (const serial of [false, true]) {
    const result = check(
      { 'orders.rs': stateSource, 'orders.feature': stateContract(serial) },
      serial ? ['--serial'] : [],
    )
    assert.equal(result.exitCode, 0)
    assert.equal(result.report.snapshot.evidence.complete, true)
    assert.equal(
      result.report.snapshot.verification.profile,
      serial ? 'in-process-v1' : 'isolated-scenarios-v1',
    )
  }
  const unsupported: Record<string, string>[] = [
    { 'orders.rs': '#[cfg(any())]\n' + handler },
    { 'orders.rs': handler + 'struct Hidden;\n' },
    { 'orders.rs': handler.replace('String::from', 'format!') },
    { 'other.py': 'def hidden():\n    return 1\n' },
    { 'Cargo.toml': '[package]\nname="cargo-project"\nversion="0.0.0"\n' },
  ]
  for (const sources of unsupported) {
    const result = check(sources)
    assert.equal(result.exitCode, 2)
    assert.equal(result.report.decision.status, 'incomplete')
    assert.equal(result.report.snapshot.evidence, undefined)
    assert.ok(result.report.snapshot.source.problems.length > 0)
  }
  const structural = check({}, [], { structural: { metric: 'control-depth-v1', maxDepth: 4 } })
  assert.equal(structural.exitCode, 2)
  assert.equal(structural.report.decision.status, 'incomplete')
  assert.equal(structural.report.snapshot.evidence, undefined)
  assert.ok(structural.report.snapshot.source.problems.join('\n').includes('control-depth-v1'))
  const drift = check({}, [], {}, root =>
    'std::fs::write(' + JSON.stringify(join(root, 'orders.rs')) + ', "changed").unwrap();')
  assert.equal(drift.exitCode, 2)
  assert.ok(
    drift.report.snapshot.source.problems.includes('Maintained files changed during verification'),
  )
})

test('Rust explanation charges actual literal bytes and never runs a handler', {
  skip: process.env.BONSAI_RUST_PROBE !== '1',
  timeout: 120000,
}, () => {
  const registry =
    'mod orders;\npub fn actions() -> &\'static [(&\'static str, fn(&str) -> String)] { &[("ready", orders::ready)] }\n'
  const fixture = project(
    { 'bindings.rs': registry, 'orders.rs': '', 'orders.feature': contract },
    {},
    { bindings: 'bindings.rs' },
  )
  const marker = join(fixture.root, 'handler-called')
  const probe = instrumentRust('std::fs::write(' + JSON.stringify(marker) + ', "called").unwrap();')
  const source = (literal: string, spaced: boolean) =>
    'pub fn ready(_input: &str) -> String {' +
    (spaced ? '\n    ' : ' ') +
    'let réponse = String::from(' +
    literal +
    ');' +
    (spaced ? '\n    ' : ' ') +
    'réponse }\n'
  const explainCost = (literal: string, spaced = false) => {
    writeFileSync(join(fixture.root, 'orders.rs'), source(literal, spaced))
    const result = runCli(['explain', 'orders.rs', '--root', fixture.root, '--json'], {
      timeout: 60000, env: probe.env,
    })
    const report = JSON.parse(result.stdout || result.stderr)
    assert.equal(result.status, 0, result.stdout || result.stderr)
    assert.deepEqual(report.problems, [])
    assert.equal(report.components.length, 1)
    assert.equal(report.components[0].id, 'orders.rs#ready')
    assert.equal(existsSync(marker), false)
    return report.components[0].tokens as number
  }
  try {
    const short = explainCost('"x"')
    const long = explainCost('"' + 'a'.repeat(100000) + '"')
    assert.equal(long - short, Math.ceil(100002 / 4) - 1)
    const raw = explainCost('r#"' + 'a'.repeat(100000) + '"#')
    assert.equal(raw - short, Math.ceil(100005 / 4) - 1)
    const multibyte = explainCost('"é🦀"')
    assert.equal(multibyte - short, Math.ceil(Buffer.byteLength('"é🦀"') / 4) - 1)
    assert.equal(explainCost('"é🦀"', true), multibyte)
    writeFileSync(join(fixture.root, 'orders.rs'), source('r#"{"status":"ready"}"#', false))
    const checked = runCli(['check', '--root', fixture.root, '--json'], { timeout: 60000, env: probe.env })
    assert.equal(checked.status, 0, checked.stdout + checked.stderr)
    assert.equal(existsSync(marker), true, 'The trusted marker must prove actual handler execution')
  } finally {
    probe.dispose()
    fixture.dispose()
  }
})

test('Rust cancellation reaps the native application and candidate PATH tools never run', {
  skip: process.env.BONSAI_RUST_PROBE !== '1' || process.platform !== 'linux',
  timeout: 60000,
}, async () => {
  const registry =
    'mod orders;\npub fn actions() -> &\'static [(&\'static str, fn(&str) -> String)] { &[("ready", orders::ready)] }\n'
  const fixture = project(
    {
      'bindings.rs': registry,
      'orders.rs':
        'pub fn ready(_input: &str) -> String { loop { std::hint::spin_loop(); } }\n',
      'orders.feature': contract,
    },
    {},
    { bindings: 'bindings.rs' },
  )
  const probe = instrumentRust('std::fs::write(' + JSON.stringify(join(fixture.root, 'started')) + ', std::process::id().to_string()).unwrap();')
  let child: ReturnType<typeof spawn> | undefined
  let closed: Promise<number | null> | undefined
  try {
    const fake = join(fixture.root, 'bin')
    mkdirSync(fake)
    const toolMarker = join(fixture.root, 'candidate-tool-ran')
    writeFileSync(
      join(fake, 'rustup'),
      '#!/bin/sh\nprintf fake > ' + JSON.stringify(toolMarker) + '\nexit 1\n',
      { mode: 0o755 },
    )
    const env = { ...probe.env, PATH: fake + ':' + probe.env.PATH }
    child = spawn(process.execPath, [executable, 'check', '--root', fixture.root, '--json'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    closed = new Promise((done) => child!.once('close', done))
    const began = performance.now()
    while (!existsSync(join(fixture.root, 'started')) && performance.now() - began < 20000)
      await new Promise((done) => setTimeout(done, 25))
    assert.equal(existsSync(join(fixture.root, 'started')), true, output)
    assert.equal(existsSync(toolMarker), false)
    const pid = Number(readFileSync(join(fixture.root, 'started'), 'utf8').split(' ')[0])
    assert.ok(Number.isSafeInteger(pid) && pid > 0)
    child.kill('SIGTERM')
    const exit = await closed
    assert.notEqual(exit, 0)
    const stopped = performance.now()
    while (existsSync('/proc/' + pid) && performance.now() - stopped < 5000)
      await new Promise((done) => setTimeout(done, 25))
    assert.equal(existsSync('/proc/' + pid), false, 'Cancelled native handler must be reaped')
  } finally {
    child?.kill('SIGKILL')
    if (closed) await closed
    probe.dispose()
    fixture.dispose()
  }
})

test('a disposable Rust analyzer content change blocks the completed native check', {
  skip: process.env.BONSAI_RUST_PROBE !== '1' || process.platform !== 'linux',
  timeout: 60000,
}, () => {
  const installed = (name: string) => {
    const result = spawnSync('rustup', ['which', '--toolchain', '1.86.0', name], {
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const rustc = installed('rustc')
  const analyzer = installed('rust-analyzer')
  const tools = mkdtempSync(join(tmpdir(), 'bonsai-rust-tools-'))
  const binaries = join(tools, 'bin')
  mkdirSync(binaries)
  const copied = join(binaries, 'rust-analyzer')
  copyFileSync(analyzer, copied)
  // Preserve the pinned component's loader-relative shared libraries without
  // writing to the installed toolchain or copying its complete sysroot.
  symlinkSync(join(dirname(dirname(analyzer)), 'lib'), join(tools, 'lib'), 'dir')
  const copiedVersion = spawnSync(copied, ['--version'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(copiedVersion.status, 0, copiedVersion.stderr)
  const fixture = project(
    {
      'bindings.rs':
        'mod orders;\npub fn actions() -> &\'static [(&\'static str, fn(&str) -> String)] { &[("ready", orders::ready)] }\n',
      'orders.rs': 'pub fn ready(_input: &str) -> String { String::from(r#"{"status":"ready"}"#) }\n',
      'orders.feature': contract,
    },
    {},
    { bindings: 'bindings.rs' },
  )
  const probe = instrumentRust('let mut bytes = std::fs::read(' + JSON.stringify(copied) + ').unwrap(); bytes.push(0); std::fs::write(' + JSON.stringify(copied) + ', bytes).unwrap();', copied)
  try {
    const result = runCli(['check', '--root', fixture.root, '--json'], {
      timeout: 60000,
      env: probe.env,
    })
    const report = JSON.parse(result.stdout || result.stderr)
    assert.equal(result.status, 2, result.stdout || result.stderr)
    assert.ok(report.snapshot, JSON.stringify(report))
    assert.equal(report.snapshot.evidence.complete, true)
    assert.equal(report.snapshot.evidence.checks[0].status, 'passed')
    assert.ok(
      report.snapshot.source.problems.includes('Checker or toolchain changed during verification'),
    )
  } finally {
    probe.dispose()
    fixture.dispose()
    rmSync(tools, { recursive: true, force: true })
  }
})

test('native Rust transport ignores flushed stdout for unsupported adversarial handlers', {
  skip: process.env.BONSAI_RUST_PROBE !== '1',
  timeout: 180000,
}, async () => {
  const value = Buffer.from('{"status":"ready"}')
  const header = Buffer.alloc(4)
  header.writeUInt32BE(value.length)
  const forged = [...Buffer.concat([header, value])].join(',')
  for (const serial of [false, true]) {
    for (const blocked of [false, true]) {
      const fixture = project(
        {
          'bindings.rs':
            'mod orders; pub fn actions() -> &\'static [(&\'static str, fn(&str) -> String)] { &[("ready", orders::ready)] }',
          'orders.rs':
            'pub fn ready(_input: &str) -> String { let mut output = std::io::stdout(); std::io::Write::write_all(&mut output, &[' +
            forged +
            ']).unwrap(); std::io::Write::flush(&mut output).unwrap(); std::fs::write("forged-frame-written", "written").unwrap(); ' +
            (blocked
              ? 'loop { std::hint::spin_loop(); }'
              : 'String::from(r#"{"status":"rejected"}"#)') +
            ' }',
          'orders.feature': contract,
        },
        { maxFeedbackMs: blocked ? 10000 : 30000 },
        { bindings: 'bindings.rs' },
      )
      try {
        const required = compileContracts([{ file: 'orders.feature', text: contract }])
        const hash = fingerprint(fixture.root, inventory(fixture.root, fixture.config.maintained), fixture.config)
        const pending = runEvidence(fixture.root, fixture.config, required, hash,
          fixture.config.policy.maxFeedbackMs, undefined,
          { profile: serial ? 'in-process-v1' : 'isolated-scenarios-v1', workers: 1 })
        if (blocked) await assert.rejects(pending, /deadline/)
        else {
          const evidence = await pending
          assert.equal(evidence.complete, true)
          assert.equal(evidence.checks[0]!.status, 'failed')
        }
        assert.equal(existsSync(join(fixture.root, 'forged-frame-written')), true,
          'The unsupported adversarial handler must actually flush its forged stdout')
      } finally {
        fixture.dispose()
      }
    }
  }
})

test('interrupted Rust inventory preserves large literal costs without a compiler', async () => {
  const payload = 'a'.repeat(100000)
  const literals = [
    '"' + payload + '"',
    'r###"' + payload + '"###',
    'b"' + payload + '"',
    'br##"' + payload + '"##',
    '"' + 'é'.repeat(50000) + '"',
  ]
  const sources = Object.fromEntries(
    literals.map((literal, index) => [
      'literal' + index + '.rs',
      'pub fn value() { let retained = ' + literal + '; }\n',
    ]),
  )
  const fixture = project(
    { 'bindings.rs': 'pub fn actions() {}\n', ...sources },
    {},
    { bindings: 'bindings.rs' },
  )
  try {
    for (const mode of ['deadline', 'cancel']) {
      const controller = new AbortController()
      if (mode === 'cancel') controller.abort()
      const collected = await collectStandaloneRust(
        fixture.root,
        fixture.config.maintained,
        'bindings.rs',
        controller.signal,
        mode === 'deadline' ? 0 : 30000,
      )
      assert.equal(collected.interrupted, true)
      assert.equal(collected.identity, undefined)
      assert.deepEqual(collected.source.components, [])
      assert.deepEqual(
        collected.source.files.map((file) => file.file).sort(),
        fixture.config.maintained.slice().sort(),
      )
      for (const [index, literal] of literals.entries()) {
        const retained = collected.source.files.find(
          (file) => file.file === 'literal' + index + '.rs',
        )!
        assert.ok(
          retained.tokens >= Math.ceil(Buffer.byteLength(literal) / 4),
          JSON.stringify(retained),
        )
      }
      assert.match(collected.source.problems.join('\n'), /conservatively charges/)
    }
  } finally {
    fixture.dispose()
  }
})


test('Rust JSON integers cannot pass observations by rounding and unrelated fields stay independent', {
  skip: process.env.BONSAI_RUST_PROBE !== '1', timeout: 180000,
}, () => {
  const cases = [
    { json: '{"count":9007199254740993}', selector: 'count', expected: '9007199254740992', status: 'reject' },
    { json: '{"count":{"values":[9007199254740993]}}', selector: 'count', expected: '{"values":[9007199254740992]}', status: 'reject' },
    { json: '{"count":9007199254740991}', selector: 'count', expected: '9007199254740991', status: 'pass' },
    { json: '{"status":"ready","unused":9007199254740993}', selector: 'status', expected: '"ready"', status: 'pass' },
  ]
  for (const serial of [false, true]) for (const value of cases) {
    const fixture = project({
      'bindings.rs': 'mod orders;\npub fn actions() -> &\'static [(&\'static str, fn(&str) -> String)] { &[("ready", orders::ready)] }\n',
      'orders.rs': 'pub fn ready(_input: &str) -> String { String::from(r#"' + value.json + '"#) }\n',
      'orders.feature': 'Feature: Native integer values\nScenario: Read exact values\n When I invoke "ready" with {}\n Then response "' + value.selector + '" equals ' + value.expected + '\n',
    }, {}, { bindings: 'bindings.rs' })
    try {
      const result = runCli(['check', '--root', fixture.root, '--json', ...(serial ? ['--serial'] : [])], { timeout: 60000 })
      const report = JSON.parse(result.stdout || result.stderr)
      assert.equal(report.decision.status, value.status, result.stdout + result.stderr)
      assert.equal(report.snapshot.evidence.complete, true)
      assert.equal(report.snapshot.evidence.checks[0].status, value.status === 'pass' ? 'passed' : 'failed')
      if (value.status === 'reject') assert.match(report.snapshot.evidence.checks[0].error, /clone|Symbol|safe range/i)
    } finally { fixture.dispose() }
  }
})


test('Rust filesystem and thread capabilities cannot replace the completed result channel', {
  skip: process.env.BONSAI_RUST_PROBE !== '1', timeout: 120000,
}, () => {
  const sources = [
    'use std::fs::write as replace;\npub fn ready(_input: &str) -> String { replace("must-not-run", b"ran").unwrap(); String::from(r#"{"status":"ready"}"#) }\n',
    'use std::thread::spawn as launch;\npub fn ready(_input: &str) -> String { launch(|| 1); String::from(r#"{"status":"ready"}"#) }\n',
    'pub fn ready(_input: &str) -> String { std::fs::write("must-not-run", b"ran").unwrap(); std::thread::spawn(|| { let directory = std::env::current_exe().unwrap(); for entry in std::fs::read_dir(directory.parent().unwrap()).unwrap() { let result = entry.unwrap().path().join("result"); let temporary = result.with_extension("forged"); let payload = br#"{"status":"ready"}"#; let mut frame = (payload.len() as u32).to_be_bytes().to_vec(); frame.extend_from_slice(payload); let _ = std::fs::write(&temporary, frame); let _ = std::fs::rename(&temporary, &result); } }); String::from(r#"{"status":"rejected"}"#) }\n',
  ]
  for (const code of sources) {
    const fixture = project({
      'bindings.rs': 'mod orders;\npub fn actions() -> &\'static [(&\'static str, fn(&str) -> String)] { &[("ready", orders::ready)] }\n',
      'orders.rs': code, 'orders.feature': contract,
    }, {}, { bindings: 'bindings.rs' })
    try {
      const result = runCli(['check', '--root', fixture.root, '--json'], { timeout: 60000 })
      const report = JSON.parse(result.stdout || result.stderr)
      assert.equal(result.status, 2, result.stdout + result.stderr)
      assert.equal(report.decision.status, 'incomplete')
      assert.match(report.snapshot.source.problems.join('\n'), /filesystem\/thread capabilities/)
      assert.equal(report.snapshot.evidence, undefined)
      assert.equal(existsSync(join(fixture.root, 'must-not-run')), false)
    } finally { fixture.dispose() }
  }
})
