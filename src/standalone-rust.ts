import { spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { analysisIdentity } from './identity.ts'
import { measurePlainSource as measureSource, plainTokens as countTokens } from './source-cost.ts'
import { rustTools } from './rust-process.ts'
import type { Component, Source, Snapshot } from './model.ts'
import type { Timer } from './timing.ts'

type RustNode = {
  type: 'Node' | 'Token'
  kind: string
  start: [number, number, number]
  end: [number, number, number]
  children?: RustNode[]
  istart?: unknown
}
type Point = { line: number; character: number }
type Location = {
  targetUri?: string
  uri?: string
  targetSelectionRange?: { start: Point }
  range?: { start: Point }
}
class RustInterrupted extends Error {}

function walk(node: RustNode, visit: (node: RustNode) => void) {
  visit(node)
  // viewSyntaxTree embeds pseudo-ASTs for Rust-looking string data. Never walk them.
  if (node.kind.endsWith('STRING') || node.istart !== undefined) return
  for (const child of node.children ?? []) walk(child, visit)
}
const bytes = (text: string, node: RustNode) =>
  Buffer.from(text).subarray(node.start[0], node.end[0]).toString('utf8')
function position(text: string, offset: number): Point {
  const lines = Buffer.from(text).subarray(0, offset).toString('utf8').split('\n')
  return { line: lines.length - 1, character: lines.at(-1)!.length }
}
function offset(text: string, at: Point) {
  const lines = text.split('\n')
  return Buffer.byteLength(
    lines.slice(0, at.line).join('\n') +
      (at.line ? '\n' : '') +
      (lines[at.line] ?? '').slice(0, at.character),
  )
}

class RustLsp {
  child: ReturnType<typeof spawn>
  pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  sequence = 0
  buffer = Buffer.alloc(0)
  size = 0
  diagnostics = new Map<
    string,
    { severity?: number; message?: string; range?: { start: Point } }[]
  >()
  stderr = ''
  busy = false
  ready: Promise<void>
  resolveReady!: () => void
  rejectReady!: (error: Error) => void
  closed: Promise<void>
  failure?: Error
  abort: () => void
  timer: ReturnType<typeof setTimeout>
  constructor(
    tools: Awaited<ReturnType<typeof rustTools>>,
    timeoutMs: number,
    readonly signal?: AbortSignal,
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    void this.ready.catch(() => undefined)
    this.child = spawn(tools.analyzer, [], {
      cwd: tools.sysroot,
      env: tools.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    this.abort = () => this.fail(new RustInterrupted('Rust source analysis interrupted'))
    this.timer = setTimeout(
      () => this.fail(new RustInterrupted('Rust feedback deadline expired')),
      timeoutMs,
    )
    this.signal?.addEventListener('abort', this.abort, { once: true })
    this.closed = new Promise((resolve) =>
      this.child.once('close', () => {
        this.fail(new Error('Rust analyzer stopped: ' + this.stderr))
        resolve()
      }),
    )
    this.child.once('error', (error) => this.fail(error))
    this.child.stdin!.on('error', (error) => this.fail(error))
    this.child.stderr!.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString()
      if (Buffer.byteLength(this.stderr) > 65536)
        this.fail(new Error('Rust analyzer diagnostics exceeded 64 KiB'))
    })
    this.child.stdout!.on('data', (chunk: Buffer) => {
      try {
        this.size += chunk.length
        if (this.size > 64 * 1024 * 1024) throw new Error('Rust analyzer output exceeded 64 MiB')
        this.buffer = Buffer.concat([this.buffer, chunk])
        while (true) {
          const split = this.buffer.indexOf('\r\n\r\n')
          if (split < 0) {
            if (this.buffer.length > 8192) throw new Error('Invalid Rust analyzer header')
            break
          }
          const header = this.buffer.subarray(0, split).toString('ascii')
          const matches = [...header.matchAll(/(?:^|\r\n)Content-Length: ([0-9]+)(?=\r\n|$)/gi)]
          if (matches.length !== 1) throw new Error('Invalid Rust analyzer Content-Length')
          const size = Number(matches[0]![1])
          if (!Number.isSafeInteger(size) || size > 2 * 1024 * 1024)
            throw new Error('Rust analyzer frame exceeded 2 MiB')
          if (this.buffer.length < split + 4 + size) break
          const frame = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
              this.buffer.subarray(split + 4, split + 4 + size),
            ),
          )
          this.buffer = this.buffer.subarray(split + 4 + size)
          if (typeof frame.id === 'number' && !frame.method) {
            const pending = this.pending.get(frame.id)
            if (!pending) throw new Error('Unsolicited Rust analyzer response')
            this.pending.delete(frame.id)
            if (frame.error) pending.reject(new Error(JSON.stringify(frame.error)))
            else pending.resolve(frame.result)
          } else if (frame.method && frame.id !== undefined)
            this.send({ jsonrpc: '2.0', id: frame.id, result: null })
          else if (frame.method === 'textDocument/publishDiagnostics')
            this.diagnostics.set(frame.params.uri, frame.params.diagnostics)
          else if (frame.method === 'experimental/serverStatus') {
            if (!frame.params.quiescent) this.busy = true
            if (this.busy && frame.params.quiescent) {
              if (frame.params.health === 'ok') this.resolveReady()
              else
                this.rejectReady(
                  new Error('Rust workspace status: ' + JSON.stringify(frame.params)),
                )
            }
          }
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    if (this.signal?.aborted) this.abort()
  }
  fail(error: Error) {
    this.failure ??= error
    this.rejectReady(this.failure)
    for (const pending of this.pending.values()) pending.reject(this.failure)
    this.pending.clear()
    if (this.child.pid && process.platform !== 'win32') {
      try {
        process.kill(-this.child.pid, 'SIGKILL')
      } catch {
        /* Already stopped. */
      }
    }
    this.child.kill('SIGKILL')
  }
  send(frame: unknown) {
    if (this.failure) throw this.failure
    const body = Buffer.from(JSON.stringify(frame))
    this.child.stdin!.write(
      Buffer.concat([Buffer.from('Content-Length: ' + body.length + '\r\n\r\n'), body]),
    )
  }
  request(method: string, params: unknown): Promise<any> {
    if (this.failure) return Promise.reject(this.failure)
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.send({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }
  notify(method: string, params: unknown) {
    this.send({ jsonrpc: '2.0', method, params })
  }
  async close() {
    clearTimeout(this.timer)
    this.signal?.removeEventListener('abort', this.abort)
    this.fail(new Error('Rust analyzer closed'))
    await this.closed
  }
}

function syntax(value: unknown, text: string): RustNode {
  if (typeof value !== 'string') throw new Error('Rust backend did not return a syntax tree')
  const tree: RustNode = JSON.parse(value)
  let count = 0
  const check = (node: RustNode, depth: number) => {
    if (
      ++count > 100000 ||
      depth > 256 ||
      !node ||
      typeof node !== 'object' ||
      !['Node', 'Token'].includes(node.type) ||
      typeof node.kind !== 'string' ||
      !Array.isArray(node.start) ||
      !Array.isArray(node.end) ||
      node.start.length !== 3 ||
      node.end.length !== 3 ||
      ![...node.start, ...node.end].every((part) => Number.isSafeInteger(part) && part >= 0) ||
      node.start[0] > node.end[0] ||
      node.end[0] > Buffer.byteLength(text)
    )
      throw new Error('Invalid or unbounded Rust syntax tree')
    if (node.kind.endsWith('STRING') || node.istart !== undefined) return
    if (node.children !== undefined && !Array.isArray(node.children))
      throw new Error('Invalid Rust syntax children')
    for (const child of node.children ?? []) {
      check(child, depth + 1)
      if (child.start[0] < node.start[0] || child.end[0] > node.end[0])
        throw new Error('Rust syntax child escapes its measured parent')
    }
  }
  check(tree, 0)
  if (tree.kind !== 'SOURCE_FILE' || tree.start[0] !== 0 || tree.end[0] !== Buffer.byteLength(text))
    throw new Error('Rust syntax tree does not cover its measured file')
  return tree
}

function tokens(node: RustNode, text: string) {
  const result: { value: string; node: RustNode }[] = []
  walk(node, (child) => {
    if (child.type === 'Token' && !['WHITESPACE', 'COMMENT'].includes(child.kind))
      result.push({ value: bytes(text, child), node: child })
  })
  return result
}

/** Rust lexical-v1: syntax tokens plus retained literal bytes, using the real backend tree. */
function lexicalCost(node: RustNode, text: string) {
  let cost = 0
  walk(node, (child) => {
    if (child.type !== 'Token' || child.kind === 'WHITESPACE') return
    const value = bytes(text, child)
    if (child.kind === 'COMMENT') cost += countTokens(value)
    else if (child.kind.endsWith('STRING') || child.kind === 'CHAR' || child.kind === 'BYTE')
      cost += Math.max(1, Math.ceil(Buffer.byteLength(value) / 4))
    else cost++
  })
  return cost
}

/** A narrow standalone crate: no Cargo discovery or generated/conditional items. */
export async function collectStandaloneRust(
  root: string,
  files: string[],
  bindings: string,
  signal?: AbortSignal,
  timeoutMs = 30000,
  timer?: Timer,
): Promise<{
  source: Source
  identity?: ReturnType<typeof analysisIdentity>
  pythonSources?: never
  analysis: Snapshot['analysis']
  interrupted: boolean
}> {
  const began = performance.now()
  timer?.start('measurement')
  const measured = measureSource(root, files)
  // Without a syntax tree, plain words can hide arbitrarily large literal payloads.
  // Charge all source bytes as additional payload: a conservative upper bound,
  // replaced by exact lexical-v1 costs only after collection completes.
  for (const file of measured.files)
    if (file.file.endsWith('.rs'))
      file.tokens += Math.ceil(readFileSync(resolve(root, file.file)).byteLength / 4)
  try {
    return await collectRust(
      root,
      files,
      bindings,
      structuredClone(measured),
      signal,
      timeoutMs - (performance.now() - began),
      timer,
    )
  } catch (error) {
    if (
      !(error instanceof RustInterrupted) &&
      !signal?.aborted &&
      performance.now() - began < timeoutMs
    )
      throw error
    timer?.finish('interrupted')
    measured.problems.push(`Rust source analysis interrupted: ${String(error)}`)
    measured.problems.push(
      'Interrupted Rust inventory conservatively charges whole-file payload bytes',
    )
    return {
      source: measured,
      interrupted: true,
      analysis: {
        engine: 'rust',
        backend: 'rust-analyzer',
        validation: 'rust-analyzer',
        status: 'unsupported',
        version: 'standalone-rust-interrupted',
      },
    }
  }
}

async function collectRust(
  root: string,
  files: string[],
  bindings: string,
  source: Source,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timer?: Timer,
): ReturnType<typeof collectStandaloneRust> {
  const began = performance.now()
  const remaining = () => {
    const value = timeoutMs - (performance.now() - began)
    if (value <= 0 || signal?.aborted)
      throw new RustInterrupted('Rust source analysis interrupted or deadline expired')
    return value
  }
  source.problems = source.problems.filter(
    (problem) =>
      !files
        .filter((file) => file.endsWith('.rs'))
        .some((file) => problem === 'Unsupported source language: ' + file),
  )
  const rustFiles = files.filter((file) => file.endsWith('.rs'))
  const kind = (file: string): Component['kind'] =>
    file === bindings
      ? 'binding'
      : /(?:^|\/)(?:test|tests)\/|\.(?:test|spec)\./.test(file)
        ? 'test'
        : 'production'
  for (const file of source.files)
    if (file.file.endsWith('.rs')) {
      file.executable = true
      file.kind = kind(file.file)
    }
  for (const file of files)
    if (/\.(?:[cm]?[jt]sx?|py|pyi|rb|php|go|c|cc|cpp|h|hpp|java|kt|swift|zig|sh)$/.test(file))
      source.problems.push('Mixed-language Rust analysis is not supported: ' + file)
  if (
    existsSync(join(root, 'Cargo.toml')) ||
    files.some((file) => /(?:^|\/)Cargo\.toml$/.test(file))
  )
    source.problems.push(
      'Standalone Rust bindings do not analyze Cargo manifests, dependencies, features, or build scripts',
    )
  timer?.start('rust-toolchain')
  const tools = await rustTools(signal, remaining(), root)
  const identity = analysisIdentity(tools.compiler)
  timer?.start('rust-analyzer')
  const lsp = new RustLsp(tools, remaining(), signal)
  const entries: { node: RustNode; component: Component; text: string; uri: string }[] = []
  const modules: { node: RustNode; text: string; uri: string; file: string }[] = []
  const included = new Set(rustFiles.map((file) => realpathSync(resolve(root, file))))
  const problems = new Set(source.problems)
  const problem = (message: string, file: string, node?: RustNode) =>
    problems.add(message + ' at ' + file + (node ? ':' + (node.start[1] + 1) : ''))
  const locations = (result: unknown): Location[] =>
    Array.isArray(result) ? result : result ? [result as Location] : []
  const localPath = (uri: string) => realpathSync(fileURLToPath(uri))
  const external = (uri: string) => {
    const file = localPath(uri)
    if (file === tools.source || file.startsWith(tools.source + sep)) return true
    if (!included.has(file))
      problems.add(
        'Local or external Rust dependency outside the standalone maintained crate: ' +
          relative(root, file),
      )
    return false
  }
  const owner = (location: Location) => {
    const uri = location.targetUri ?? location.uri
    const at = (location.targetSelectionRange ?? location.range)?.start
    if (!uri || !at) throw new Error('Malformed Rust semantic definition')
    return entries.find(
      (entry) =>
        entry.uri === uri &&
        (entry.node.children?.find((child) => child.kind === 'NAME')?.start[0] ??
          entry.node.start[0]) <= offset(entry.text, at) &&
        offset(entry.text, at) < entry.node.end[0],
    )
  }
  try {
    await lsp.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      capabilities: {
        experimental: { serverStatusNotification: true },
        textDocument: { definition: { linkSupport: true } },
      },
      initializationOptions: {
        checkOnSave: false,
        // A standalone query shares the caller's CPU budget with other scenarios.
        cachePriming: { numThreads: 1 },
        cargo: { allTargets: false, buildScripts: { enable: false } },
        procMacro: { enable: false },
        linkedProjects: [
          {
            sysroot: tools.sysroot,
            sysroot_src: tools.source,
            crates: [
              {
                root_module: resolve(root, bindings),
                edition: '2021',
                deps: [],
                cfg: tools.cfg,
                is_workspace_member: true,
              },
            ],
          },
        ],
      },
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'standalone-rust' }],
    })
    lsp.notify('initialized', {})
    for (const file of rustFiles)
      lsp.notify('textDocument/didOpen', {
        textDocument: {
          uri: pathToFileURL(resolve(root, file)).href,
          languageId: 'rust',
          version: 1,
          text: readFileSync(resolve(root, file), 'utf8'),
        },
      })
    await lsp.ready
    timer?.start('semantic-graph')
    for (const file of rustFiles) {
      remaining()
      const text = readFileSync(resolve(root, file), 'utf8')
      const uri = pathToFileURL(resolve(root, file)).href
      const tree = syntax(
        await lsp.request('rust-analyzer/viewSyntaxTree', { textDocument: { uri } }),
        text,
      )
      source.files.find((entry) => entry.file === file)!.tokens = lexicalCost(tree, text)
      const forbidden = new Set([
        'ATTR',
        'MACRO_CALL',
        'MACRO_RULES',
        'MACRO_DEF',
        'TRAIT',
        'IMPL',
        'STRUCT',
        'ENUM',
        'TYPE_ALIAS',
        'EXTERN_CRATE',
        'EXTERN_BLOCK',
        'ERROR',
        'UNSAFE_KW',
        'DYN_KW',
      ])
      walk(tree, (node) => {
        if (forbidden.has(node.kind))
          problem('Unsupported standalone Rust syntax ' + node.kind, file, node)
      })
      for (const node of tree.children ?? []) {
        if (node.type !== 'Node') continue
        if (node.kind === 'USE') continue
        if (node.kind === 'MODULE') {
          if ((node.children ?? []).some((child) => child.kind === 'ITEM_LIST'))
            problem('Inline Rust modules are not supported', file, node)
          modules.push({ node, uri, text, file })
          continue
        }
        if (!['FN', 'CONST', 'STATIC'].includes(node.kind)) {
          problem('Unsupported standalone Rust item ' + node.kind, file, node)
          continue
        }
        const named = node.children?.find((child) => child.kind === 'NAME')
        if (!named) {
          problem('Unnamed Rust item', file, node)
          continue
        }
        const name = bytes(text, named)
        const component: Component = {
          id: file + '#' + name,
          name,
          file,
          line: node.start[1] + 1,
          kind: kind(file),
          tokens: lexicalCost(node, text),
        }
        if (entries.some((entry) => entry.component.id === component.id))
          problem('Duplicate Rust declaration ' + name, file, node)
        if (name === 'main' || name.startsWith('__bonsai'))
          problem('Rust application reserves main and __bonsai names for its transport', file, node)
        walk(node, (child) => {
          if (child !== node && ['FN', 'CONST', 'STATIC', 'USE', 'MODULE'].includes(child.kind))
            problem('Nested Rust items are not supported', file, child)
        })
        entries.push({ node, component, text, uri })
        source.components.push(component)
      }
    }
    let references = 0
    const resolveAt = async (uri: string, text: string, node: RustNode) => {
      remaining()
      if (++references > 4096) throw new Error('Standalone Rust semantic reference limit exceeded')
      const definitions = locations(
        await lsp.request('textDocument/definition', {
          textDocument: { uri },
          position: position(text, node.start[0]),
        }),
      )
      for (const location of definitions) {
        const targetUri = location.targetUri ?? location.uri
        if (!targetUri) throw new Error('Malformed Rust definition URI')
        const standard = external(targetUri)
        if (standard && /\/library\/std\/src\/(?:fs(?:[./])|thread(?:[./]))/.test(targetUri))
          problem(
            'Rust filesystem/thread capabilities require an isolated execution adapter',
            relative(root, fileURLToPath(uri)),
            node,
          )
        if (
          standard &&
          (targetUri.includes('/library/std/src/process') ||
            targetUri.includes('/library/std/src/os/'))
        )
          problem(
            'Rust subprocess/FFI adapters are not supported',
            relative(root, fileURLToPath(uri)),
            node,
          )
      }
      return definitions
    }
    // Module declarations can import files with no declarations referenced by a handler.
    for (const module of modules) {
      const name = module.node.children?.find((child) => child.kind === 'NAME')
      if (name) {
        const definitions = await resolveAt(module.uri, module.text, name)
        if (!definitions.length) problem('Unresolved Rust module', module.file, name)
      }
    }
    const primitives = new Set([
      'str',
      'bool',
      'char',
      'u8',
      'u16',
      'u32',
      'u64',
      'u128',
      'usize',
      'i8',
      'i16',
      'i32',
      'i64',
      'i128',
      'isize',
      'f32',
      'f64',
    ])
    for (const entry of entries) {
      const refs: RustNode[] = []
      walk(entry.node, (node) => {
        if (node.kind === 'NAME_REF') refs.push(node)
      })
      // Independent definition queries share one read-only analyzer snapshot.
      // Bound in-flight requests and consume replies in source order.
      for (let start = 0; start < refs.length; start += 64) {
        const batch = refs.slice(start, start + 64)
        const resolved = await Promise.all(
          batch.map((ref) => resolveAt(entry.uri, entry.text, ref)),
        )
        for (const [index, ref] of batch.entries()) {
          const definitions = resolved[index]!
          if (!definitions.length && !primitives.has(bytes(entry.text, ref)))
            problem(
              'Unresolved Rust reference ' + bytes(entry.text, ref),
              entry.component.file,
              ref,
            )
          for (const target of definitions
            .map(owner)
            .filter((target): target is typeof entry => !!target)) {
            if (
              target.component.id === entry.component.id ||
              source.relationships.some(
                (edge) => edge.from === entry.component.id && edge.to === target.component.id,
              )
            )
              continue
            source.relationships.push({
              from: entry.component.id,
              to: target.component.id,
              kind: 'reference',
              origin: 'static',
              sourceRef: { file: entry.component.file, line: ref.start[1] + 1 },
            })
          }
        }
      }
    }
    const registry = entries.find(
      (entry) =>
        entry.component.file === bindings &&
        entry.component.name === 'actions' &&
        entry.node.kind === 'FN',
    )
    if (!registry)
      problems.add(
        'Rust bindings need pub fn actions() returning a literal native handler registry',
      )
    else {
      source.registry = registry.component.id
      const signature = tokens(registry.node, registry.text).map((token) => token.value)
      if (signature[0] !== 'pub')
        problem('Rust actions registry must be public', bindings, registry.node)
      const body = registry.node.children?.find((node) => node.kind === 'BLOCK_EXPR')
      const parts = body ? tokens(body, registry.text) : []
      let index = 0
      const take = (value: string) => {
        if (parts[index]?.value !== value)
          throw new Error('Rust actions must return &[("action", module::named_handler), ...]')
        index++
      }
      try {
        take('{')
        take('&')
        take('[')
        while (parts[index]?.value !== ']') {
          take('(')
          const key = parts[index++]!
          if (!key || !/^"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"$/.test(key.value))
            throw new Error('Rust action keys need simple literal strings')
          const action: string = JSON.parse(key.value)
          take(',')
          let target = parts[index++]
          if (!target || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(target.value))
            throw new Error('Rust actions need named handlers')
          while (parts[index]?.value === '::') {
            index++
            target = parts[index++]
            if (!target || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(target.value))
              throw new Error('Rust actions need named handlers')
          }
          const definitions = await resolveAt(registry.uri, registry.text, target.node)
          const handler = definitions
            .map(owner)
            .find((entry) => entry?.node.kind === 'FN' && entry.component.kind === 'production')
          if (!handler) throw new Error('Cannot resolve native Rust action handler: ' + action)
          if (Object.hasOwn(source.actions, action))
            throw new Error('Duplicate Rust action: ' + action)
          source.actions[action] = handler.component.id
          take(')')
          if (parts[index]?.value !== ']') take(',')
        }
        take(']')
        take('}')
        if (index !== parts.length)
          throw new Error('Rust registry contains unsupported runtime logic')
      } catch (error) {
        problem(String(error), bindings, registry.node)
      }
    }
    for (const [uri, diagnostics] of lsp.diagnostics)
      for (const diagnostic of diagnostics)
        if (diagnostic.severity === 1)
          problems.add(
            'Rust semantic diagnostic at ' +
              relative(root, fileURLToPath(uri)) +
              ':' +
              ((diagnostic.range?.start.line ?? 0) + 1) +
              ': ' +
              diagnostic.message,
          )
    remaining()
    source.problems = [...problems]
    return {
      source,
      identity,
      interrupted: false,
      analysis: {
        engine: 'rust',
        backend: 'rust-analyzer',
        validation: 'rust-analyzer',
        status: source.problems.length ? 'unsupported' : 'complete',
        version: tools.compiler.version,
      },
    }
  } catch (error) {
    if (error instanceof RustInterrupted || signal?.aborted) timer?.finish('interrupted')
    throw error
  } finally {
    await lsp.close()
    if (lsp.failure instanceof RustInterrupted) timer?.finish('interrupted')
    else timer?.finish()
  }
}
