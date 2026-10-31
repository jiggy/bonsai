import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileContracts } from '../src/contracts.ts'
import { buildSnapshot } from '../src/retention.ts'
import { countTokens, measureSource } from '../src/source.ts'
import type { Source, Component } from '../src/model.ts'

const toolchain = '1.86.0'
const feature =
  'Feature: Orders\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ready"\n'

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
      this.pending.set(id, {
        resolve,
        reject: (error) => reject(new Error(method + ': ' + error.message)),
        timer,
      })
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

type RustNode = {
  type: 'Node' | 'Token'
  kind: string
  start: [number, number, number]
  end: [number, number, number]
  children?: RustNode[]
  istart?: unknown
}

function walkRust(node: RustNode, visit: (node: RustNode) => void) {
  visit(node)
  // This debugging API embeds parsed Rust-looking string payloads as pseudo-ASTs.
  // Those are literal bytes, never declarations or references of the program.
  if (node.kind.endsWith('STRING') || node.istart !== undefined) return
  for (const child of node.children ?? []) walkRust(child, visit)
}

function rustPosition(text: string, offset: number) {
  const prefix = Buffer.from(text).subarray(0, offset).toString('utf8')
  const lines = prefix.split('\n')
  return { line: lines.length - 1, character: lines.at(-1)!.length }
}

async function rustFacts(probe: RustProbe, root: string, action: string, selected: unknown) {
  const files = ['src/main.rs', 'src/orders.rs']
  const source: Source = measureSource(root, files)
  const declarations: { node: RustNode; component: Component; text: string; uri: string }[] = []
  const summaries: unknown[] = []
  const kinds = new Set([
    'FN',
    'STRUCT',
    'ENUM',
    'TRAIT',
    'IMPL',
    'TYPE_ALIAS',
    'CONST',
    'STATIC',
    'MACRO_RULES',
    'MACRO_DEF',
    'MACRO_CALL',
  ])
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8')
    const uri = pathToFileURL(join(root, file)).href
    const raw = await probe.request('rust-analyzer/viewSyntaxTree', { textDocument: { uri } })
    assert.equal(typeof raw, 'string')
    const tree = JSON.parse(raw as string) as RustNode
    assert.equal(tree.kind, 'SOURCE_FILE')
    assert.equal(tree.start[0], 0)
    assert.equal(tree.end[0], Buffer.byteLength(text))
    const symbols = await probe.request('textDocument/documentSymbol', { textDocument: { uri } })
    assert.ok(Array.isArray(symbols), 'The semantic backend supplies document symbols')
    for (const node of tree.children ?? []) {
      if (node.type !== 'Node' || !kinds.has(node.kind)) continue
      const named = node.children?.find((child) => child.kind === 'NAME')
      const name = named
        ? Buffer.from(text).subarray(named.start[0], named.end[0]).toString('utf8')
        : '<' + node.kind + ':' + node.start[0] + '>'
      const component: Component = {
        id: file + '#' + name + '@' + node.start[0],
        name,
        file,
        line: node.start[1] + 1,
        kind: file === 'src/main.rs' ? 'binding' : 'production',
        tokens: countTokens(
          Buffer.from(text).subarray(node.start[0], node.end[0]).toString('utf8'),
        ),
      }
      source.components.push(component)
      declarations.push({ node, component, text, uri })
    }
    summaries.push({
      file,
      topLevelKinds: tree.children?.filter((node) => node.type === 'Node').map((node) => node.kind),
      symbolCount: symbols.length,
    })
  }
  const owner = (location: {
    targetUri?: string
    uri?: string
    targetSelectionRange?: { start: { line: number; character: number } }
    range?: { start: { line: number; character: number } }
  }) => {
    const uri = location.targetUri ?? location.uri
    const at = (location.targetSelectionRange ?? location.range)?.start
    if (!at) return undefined
    return declarations.find((entry) => {
      if (entry.uri !== uri) return false
      const lines = entry.text.split('\n')
      const prefix =
        lines.slice(0, at.line).join('\n') +
        (at.line ? '\n' : '') +
        (lines[at.line] ?? '').slice(0, at.character)
      const offset = Buffer.byteLength(prefix)
      return entry.node.start[0] <= offset && offset < entry.node.end[0]
    })?.component
  }
  const selectedLocations = Array.isArray(selected) ? selected : selected ? [selected] : []
  const selectedComponent = selectedLocations.map(owner).find(Boolean)
  assert.ok(selectedComponent, 'Selected semantic definition maps to an actual source declaration')
  source.actions[action] = selectedComponent.id
  source.registry = declarations.find(
    (entry) => entry.component.file === 'src/main.rs' && entry.component.name === 'main',
  )?.component.id
  assert.ok(source.registry)
  let unresolved = 0
  for (const entry of declarations) {
    const references: RustNode[] = []
    walkRust(entry.node, (node) => {
      if (node.kind === 'NAME_REF') references.push(node)
    })
    for (const reference of references) {
      const result = await probe.request('textDocument/definition', {
        textDocument: { uri: entry.uri },
        position: rustPosition(entry.text, reference.start[0]),
      })
      const locations = Array.isArray(result) ? result : result ? [result] : []
      if (!locations.length) unresolved++
      for (const target of locations.map(owner).filter((target): target is Component => !!target)) {
        if (target.id === entry.component.id) continue
        if (
          source.relationships.some(
            (edge) => edge.from === entry.component.id && edge.to === target.id,
          )
        )
          continue
        source.relationships.push({
          from: entry.component.id,
          to: target.id,
          kind: 'reference',
          origin: 'static',
          sourceRef: { file: entry.component.file, line: reference.start[1] + 1 },
        })
      }
    }
  }
  // Keep the unsupported-language diagnostics from real measurement. Partial
  // development facts cannot become accepted production analysis.
  assert.ok(source.problems.some((problem) => problem.includes('Unsupported source language')))
  return { source, summaries, unresolved }
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
    'pub fn unused() -> &\'static str { std::fs::write("unused-called", "wrong").unwrap(); "fn forged() {}" }',
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
    const sysroot = run(['rustc', '--print', 'sysroot'])
    const targetCfg = run(['rustc', '--print', 'cfg']).split('\n')
    const backendPath = spawnSync('rustup', ['which', '--toolchain', toolchain, 'rust-analyzer'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.equal(backendPath.status, 0, backendPath.stderr)
    const backendBinaryBytes = statSync(backendPath.stdout.trim()).size
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
            textDocument: {
              definition: { linkSupport: true },
              documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            },
          },
          initializationOptions: {
            checkOnSave: false,
            linkedProjects: [
              {
                sysroot,
                sysroot_src: join(sysroot, 'lib/rustlib/src/rust/library'),
                crates: [
                  {
                    root_module: join(root, 'src/main.rs'),
                    edition: '2021',
                    deps: [],
                    cfg: [...targetCfg, ...features.map((feature) => 'feature="' + feature + '"')],
                    is_workspace_member: true,
                  },
                ],
              },
            ],
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
        const facts = await rustFacts(probe, root, step.action, result)
        const snapshot = buildSnapshot('development-rust-probe', contracts, facts.source)
        const selected = facts.source.components.find((component) => component.name === 'selected')!
        const unused = facts.source.components.find((component) => component.name === 'unused')!
        assert.ok(snapshot.ancestry[selected.id]?.includes(contracts.checks[0].id))
        assert.ok(
          snapshot.unrooted.includes(unused.id),
          'Semantic facts must not grant ancestry to unused handlers',
        )
        assert.ok(
          !facts.source.components.some((component) => component.name === 'forged'),
          'Rust-looking string data must not become source declarations',
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
          sourceFacts: {
            summaries: facts.summaries,
            components: facts.source.components.map(({ id, name }) => ({ id, name })),
            edges: facts.source.relationships,
            unresolved: facts.unresolved,
            unrooted: snapshot.unrooted,
            problems: facts.source.problems,
          },
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
        backendBinaryBytes,
        samples,
        productionRustSupport: false,
      }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
