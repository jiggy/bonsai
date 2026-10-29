import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileContracts } from '../src/contracts.ts'
import { createProject } from './project.ts'
import { runCli } from './cli.ts'

const toolchain = '1.85.0'
const feature =
  'Feature: Orders\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ready"\n'

test('a Rust backend experiment cannot silently enable production Rust analysis', () => {
  const fixture = createProject({
    'handler.ts': "export function ready() { return { status: 'ready' } }\n",
    'bindings.ts':
      "import { ready } from './handler.ts'\nexport const actions = { ready: ready }\n",
    'ready.feature': feature,
    'main.rs': 'fn main() {}\n',
  })
  try {
    const result = runCli(['check', '--root', fixture.root, '--json'])
    assert.equal(result.status, 2, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.ok(
      report.snapshot.source.problems.some((problem: string) =>
        problem.includes('Unsupported source language: main.rs'),
      ),
    )
    assert.ok(
      report.snapshot.source.files.find(
        (file: { file: string; tokens: number }) => file.file === 'main.rs',
      ).tokens > 0,
    )
    assert.notEqual(report.snapshot.evidence?.complete, true)
  } finally {
    fixture.dispose()
  }
})

class RustProbe {
  child: ReturnType<typeof spawn>
  pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  sequence = 0
  buffer = Buffer.alloc(0)
  stderr = ''
  bytes = 0
  busy = false
  ready: Promise<void>
  resolveReady!: () => void
  rejectReady!: (error: Error) => void
  closed: Promise<void>

  constructor(root: string) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    void this.ready.catch(() => undefined)
    this.child = spawn('rustup', ['run', toolchain, 'rust-analyzer'], {
      cwd: root,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, RUSTUP_TOOLCHAIN: toolchain },
    })
    this.closed = new Promise((resolve) => {
      this.child.once('close', () => {
        this.fail(new Error('Rust analyzer closed: ' + this.stderr))
        resolve()
      })
    })
    this.child.once('error', (error) => this.fail(error))
    this.child.stderr!.on('data', (data: Buffer) => {
      this.stderr = (this.stderr + data.toString()).slice(-65536)
    })
    this.child.stdout!.on('data', (data: Buffer) => {
      try {
        this.bytes += data.length
        assert.ok(this.bytes <= 8 * 1024 * 1024, 'Bound Rust probe output')
        this.buffer = Buffer.concat([this.buffer, data])
        while (true) {
          const split = this.buffer.indexOf('\r\n\r\n')
          if (split < 0) break
          const match = /content-length:\s*(\d+)/i.exec(this.buffer.subarray(0, split).toString())
          assert.ok(match, 'LSP Content-Length is required')
          const length = Number(match[1])
          assert.ok(length <= 2 * 1024 * 1024, 'Bound an individual response')
          if (this.buffer.length < split + 4 + length) break
          const message = JSON.parse(this.buffer.subarray(split + 4, split + 4 + length).toString())
          this.buffer = this.buffer.subarray(split + 4 + length)
          if (typeof message.id === 'number' && !message.method) {
            const pending = this.pending.get(message.id)
            if (pending) {
              clearTimeout(pending.timer)
              this.pending.delete(message.id)
              if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
              else pending.resolve(message.result)
            }
          } else if (message.method && message.id !== undefined) {
            this.send({ jsonrpc: '2.0', id: message.id, result: null })
          } else if (message.method === 'experimental/serverStatus') {
            if (!message.params.quiescent) this.busy = true
            if (this.busy && message.params.quiescent) {
              if (message.params.health === 'ok') this.resolveReady()
              else this.rejectReady(new Error(JSON.stringify(message.params)))
            }
          }
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  fail(error: Error) {
    this.rejectReady(error)
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  send(message: unknown) {
    const body = Buffer.from(JSON.stringify(message))
    this.child.stdin!.write(
      Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n'), body]),
    )
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Rust probe timed out: ' + method + '\n' + this.stderr))
      }, 60000)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  async close() {
    const pid = this.child.pid
    if (pid) {
      try {
        process.kill(process.platform === 'win32' ? pid : -pid, 'SIGTERM')
      } catch {}
      const timer = setTimeout(() => {
        try {
          process.kill(process.platform === 'win32' ? pid : -pid, 'SIGKILL')
        } catch {}
      }, 1000)
      await this.closed
      clearTimeout(timer)
    }
  }
}

test('pinned Rust semantic backend resolves a real native action without enabling a gate', {
  skip: process.env.BONSAI_RUST_PROBE !== '1',
  timeout: 180000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-rust-probe-'))
  mkdirSync(join(root, 'src'))
  const contracts = compileContracts([{ file: 'ready.feature', text: feature }])
  assert.deepEqual(contracts.problems, [])
  const step = contracts.cases[0].steps.find((step) => step.kind === 'action')!
  assert.equal(step.kind, 'action')
  if (step.kind !== 'action') throw new Error('Expected an executable action')
  const main = [
    'mod orders;',
    'use orders::selected as ready;',
    'use std::io::{self, Read};',
    'fn main() {',
    ' let mut request = String::new();',
    ' io::stdin().read_to_string(&mut request).unwrap();',
    ' match request.trim() {',
    '  r#"{"action":"ready","input":{}}"# => println!("{{\\"status\\":\\"{}\\"}}", ready()),',
    '  _ => std::process::exit(2),',
    ' }',
    '}',
    '',
  ].join('\n')
  const orders = [
    "pub trait Status { fn status(&self) -> &'static str; }",
    'pub struct Order;',
    "impl Status for Order { fn status(&self) -> &'static str { feature_status() } }",
    '#[cfg(feature = "experimental")]',
    'fn feature_status() -> &\'static str { "experimental" }',
    '#[cfg(not(feature = "experimental"))]',
    'fn feature_status() -> &\'static str { "ready" }',
    "macro_rules! expose { ($name:ident) => { fn $name() -> &'static str { Order.status() } }; }",
    'expose!(generated);',
    "pub fn selected() -> &'static str { generated() }",
    'pub fn unused() -> &\'static str { std::fs::write("unused-called", "wrong").unwrap(); "unused" }',
    '',
  ].join('\n')
  writeFileSync(
    join(root, 'Cargo.toml'),
    '[package]\nname = "bonsai-rust-probe"\nversion = "0.0.0"\nedition = "2021"\n[features]\nexperimental = []\n',
  )
  writeFileSync(join(root, 'src/main.rs'), main)
  writeFileSync(join(root, 'src/orders.rs'), orders)
  const run = (args: string[], input?: string) => {
    const result = spawnSync('rustup', ['run', toolchain, ...args], {
      cwd: root,
      input,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    })
    assert.equal(result.error, undefined, String(result.error))
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return result.stdout.trim()
  }
  const position = (text: string, needle: string, last = true) => {
    const index = last ? text.lastIndexOf(needle) : text.indexOf(needle)
    assert.ok(index >= 0, needle)
    const prefix = text.slice(0, index)
    return {
      line: prefix.split('\n').length - 1,
      character: prefix.length - prefix.lastIndexOf('\n') - 1,
    }
  }
  const samples: unknown[] = []
  try {
    const version = run(['rust-analyzer', '--version'])
    const compiler = run(['rustc', '--version'])
    for (const features of [[], ['experimental']]) {
      const started = performance.now()
      const probe = new RustProbe(root)
      const uri = pathToFileURL(join(root, 'src/main.rs')).href
      try {
        await probe.request('initialize', {
          processId: process.pid,
          rootUri: pathToFileURL(root).href,
          capabilities: {
            experimental: { serverStatusNotification: true },
            textDocument: { definition: { linkSupport: true } },
          },
          initializationOptions: {
            checkOnSave: false,
            cargo: { allTargets: false, features, buildScripts: { enable: false } },
            procMacro: { enable: false },
          },
          workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'probe' }],
        })
        probe.notify('initialized', {})
        probe.notify('textDocument/didOpen', {
          textDocument: { uri, languageId: 'rust', version: 1, text: main },
        })
        const readyTimeout = setTimeout(
          () => probe.rejectReady(new Error('Rust workspace never became ready: ' + probe.stderr)),
          60000,
        )
        try {
          await probe.ready
        } finally {
          clearTimeout(readyTimeout)
        }
        const result = await probe.request('textDocument/definition', {
          textDocument: { uri },
          position: position(main, 'ready()'),
        })
        const locations = Array.isArray(result) ? result : result ? [result] : []
        assert.ok(
          locations.length > 0,
          'Resolve the real selected action across modules and aliases',
        )
        assert.ok(
          locations.some(
            (location) =>
              (location.targetUri ?? location.uri) ===
              pathToFileURL(join(root, 'src/orders.rs')).href,
          ),
        )
        const macro = (await probe.request('rust-analyzer/expandMacro', {
          textDocument: { uri: pathToFileURL(join(root, 'src/orders.rs')).href },
          position: position(orders, 'expose!(generated)'),
        })) as { expansion?: string } | null
        assert.ok(
          macro?.expansion?.includes('generated'),
          'Expand declarative macros with the chosen backend',
        )
        const definition = await probe.request('textDocument/definition', {
          textDocument: { uri: pathToFileURL(join(root, 'src/orders.rs')).href },
          position: position(orders, 'feature_status()', false),
        })
        const definitions = Array.isArray(definition) ? definition : definition ? [definition] : []
        assert.ok(
          definitions.some(
            (location) =>
              (location.targetSelectionRange ?? location.range)?.start.line ===
              (features.length ? 4 : 6),
          ),
          'Resolve the active cfg implementation, not the inactive sibling',
        )
        run([
          'cargo',
          'build',
          '--offline',
          ...features.flatMap((feature) => ['--features', feature]),
        ])
        const response = spawnSync(join(root, 'target/debug/bonsai-rust-probe'), [], {
          cwd: root,
          input: JSON.stringify({ action: step.action, input: step.input }),
          encoding: 'utf8',
          timeout: 5000,
        })
        assert.equal(response.status, 0, response.stderr)
        assert.deepEqual(JSON.parse(response.stdout), {
          status: features.length ? 'experimental' : contracts.checks[0].expected,
        })
        assert.equal(
          existsSync(join(root, 'unused-called')),
          false,
          'Native dispatch must not run unused handlers',
        )
        samples.push({
          features,
          elapsedMs: performance.now() - started,
          selectedDefinition: result,
          featureDefinition: definition,
          expandedMacro: macro,
          outputBytes: probe.bytes,
        })
      } finally {
        await probe.close()
      }
    }
    console.info(
      JSON.stringify({
        schema: 'bonsai-rust-backend-probe-v1',
        compiler,
        backend: version,
        samples,
        productionRustSupport: false,
      }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
