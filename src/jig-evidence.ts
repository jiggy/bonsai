import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync,
} from 'node:fs'
import { resolve } from 'node:path'

export type JigRouteFact = {
  adapter: 'jig-binding-v1'
  from: string
  file: string
  line: number
  route: string
  packagePath: string
  digest: string
  settings: Record<string, unknown>
}
export type JigRouteReceipt = JigRouteFact & { revision: string; approval: string }

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)
const path = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
  !/[\\\u0000-\u001f\u007f]/.test(value) && value.split('/').length <= 64 &&
  value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..' && part.length <= 255)
const packagePath = (value: unknown): value is string =>
  path(value) && /^[a-zA-Z0-9_./-]+$/.test(value) && value.split('/')[0]!.toLowerCase() !== '.jig'

// Canonical comparison of the bounded JSON data accepted by the literal adapter.
function json(value: unknown, depth = 0, seen = new Set<object>()): string | undefined {
  if (depth > 64) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : undefined
  if (!object(value) && !Array.isArray(value)) return undefined
  if (seen.has(value)) return undefined
  seen.add(value)
  const values = Array.isArray(value)
    ? [...value].map((entry) => json(entry, depth + 1, seen))
    : Object.keys(value).sort().map((key) => {
        const encoded = key === '__proto__' ? undefined : json(value[key], depth + 1, seen)
        return encoded === undefined ? undefined : `${JSON.stringify(key)}:${encoded}`
      })
  seen.delete(value)
  if (values.some((entry) => entry === undefined)) return undefined
  return Array.isArray(value) ? `[${values.join(',')}]` : `{${values.join(',')}}`
}

const fields = ['adapter', 'from', 'file', 'line', 'route', 'packagePath', 'digest', 'settings']
function fact(value: unknown, receipt = false): value is JigRouteFact {
  return object(value) && value.adapter === 'jig-binding-v1' &&
    typeof value.from === 'string' && value.from.length > 0 && path(value.file) &&
    typeof value.line === 'number' && Number.isSafeInteger(value.line) && value.line > 0 &&
    typeof value.route === 'string' && /^binding:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.route) &&
    value.route.length <= 72 && packagePath(value.packagePath) && digest(value.digest) &&
    object(value.settings) && json(value.settings) !== undefined &&
    Object.keys(value).every((key) => fields.includes(key) || (receipt && ['revision', 'approval'].includes(key)))
}

export const validJigRouteFacts = (value: unknown): value is JigRouteFact[] =>
  Array.isArray(value) && [...value].every((entry) => fact(entry))

function receipt(value: unknown): value is JigRouteReceipt {
  return object(value) && digest(value.revision) && digest(value.approval) && fact(value, true)
}

export const validJigRouteReceipts = (value: unknown): value is JigRouteReceipt[] =>
  Array.isArray(value) && [...value].every(receipt) &&
  value.every((entry) => entry.revision === value[0]?.revision && entry.approval === value[0]?.approval)

function identity(value: JigRouteFact) {
  return json(Object.fromEntries(fields.map((field) => [field, value[field as keyof JigRouteFact]])))!
}

/** Every required route needs a receipt for that exact measured selection. */
export function jigEvidenceProblems(
  requirements: JigRouteFact[] | undefined,
  receipts: JigRouteReceipt[] | undefined,
): string[] {
  if (!validJigRouteFacts(requirements ?? [])) return ['Invalid Jig route requirements']
  if (!validJigRouteReceipts(receipts ?? [])) return ['Invalid Jig approval evidence']
  const remaining = new Map<string, number>()
  for (const receipt of receipts ?? []) {
    const key = identity(receipt)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
  }
  const problems: string[] = []
  for (const requirement of requirements ?? []) {
    const key = identity(requirement)
    const count = remaining.get(key) ?? 0
    if (count) remaining.set(key, count - 1)
    else problems.push(`Missing current approved Jig route evidence: ${requirement.route} at ${requirement.file}:${requirement.line}`)
  }
  if ([...remaining.values()].some((count) => count > 0)) problems.push('Unexpected Jig approval evidence')
  return problems
}

type Deadline = { signal?: AbortSignal; deadline?: number }
function available(execution: Deadline) {
  if (execution.signal?.aborted) throw new Error('Jig route verification cancelled')
  if (execution.deadline !== undefined && performance.now() >= execution.deadline)
    throw new Error('Jig route verification feedback deadline expired')
}

/** FLOW-Package/0 framing, as used by @jigging/jig 0.1.0-alpha.42. Never loads the package. */
export function jigPackageDigest(
  root: string,
  files: readonly string[],
  selected: string,
  execution: Deadline = {},
): string {
  if (!packagePath(selected)) throw new Error('Invalid selected Jig package path')
  const maintained = new Set(files)
  const canonical = realpathSync(root)
  const selectedRoot = resolve(canonical, selected)
  let ancestor = canonical
  for (const part of selected.split('/')) {
    ancestor = resolve(ancestor, part)
    const stat = lstatSync(ancestor)
    if (stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(ancestor) !== ancestor)
      throw new Error(`Jig package path must be a canonical directory: ${selected}`)
  }
  type Stat = ReturnType<typeof statFor>
  const statFor = (file: string) => lstatSync(file, { bigint: true })
  const same = (left: Stat, right: Stat) =>
    left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
  const entries: { local: string; absolute: string; stat: Stat }[] = []
  const directories: { absolute: string; stat: Stat }[] = []
  const folded = new Set<string>()
  let bytes = 0n
  let visited = 0
  const walk = (local: string): void => {
    available(execution)
    const absolute = resolve(selectedRoot, local)
    const stat = statFor(absolute)
    if (stat.isSymbolicLink() || realpathSync(absolute) !== absolute)
      throw new Error(`Symlinked or noncanonical Jig package source: ${selected}/${local}`)
    if (local) {
      if (!path(local) || /[^\x20-\x7e]/.test(local))
        throw new Error(`Jig package source needs an ASCII slash path: ${JSON.stringify(local)}`)
      const key = local.toLowerCase()
      if (folded.has(key)) throw new Error(`Case-colliding Jig package source: ${selected}/${local}`)
      folded.add(key)
    }
    if (stat.isDirectory()) {
      directories.push({ absolute, stat })
      if (directories.length > 65536) throw new Error('Jig package exceeds 65536 directories')
      for (const name of readdirSync(absolute)) {
        if (++visited > 262144) throw new Error('Jig package exceeds 262144 directory entries')
        if (name !== 'node_modules') walk(local ? `${local}/${name}` : name)
      }
    } else if (stat.isFile()) {
      if (!maintained.has(`${selected}/${local}`))
        throw new Error(`Jig package file outside maintained inventory: ${selected}/${local}`)
      bytes += stat.size
      if (entries.length >= 65536 || stat.size > 1073741824n || bytes > 4294967296n)
        throw new Error('Jig package exceeds FLOW-Package/0 file or byte limits')
      entries.push({ local, absolute, stat })
    } else throw new Error(`Jig package source must be a regular file: ${selected}/${local}`)
  }
  walk('')
  entries.sort((left, right) => Buffer.compare(Buffer.from(left.local), Buffer.from(right.local)))
  const hash = createHash('sha256').update('FLOW-Package/0\0', 'ascii')
  const count = Buffer.alloc(8)
  count.writeBigUInt64BE(BigInt(entries.length))
  hash.update(count)
  const buffer = Buffer.alloc(1024 * 1024)
  for (const entry of entries) {
    available(execution)
    const name = Buffer.from(entry.local, 'utf8')
    const length = Buffer.alloc(4)
    length.writeUInt32BE(name.length)
    const size = Buffer.alloc(8)
    size.writeBigUInt64BE(entry.stat.size)
    hash.update(Buffer.from([1])).update(length).update(name).update(size)
    const descriptor = openSync(entry.absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      if (!same(entry.stat, fstatSync(descriptor, { bigint: true })))
        throw new Error(`Jig package changed while reading: ${selected}/${entry.local}`)
      let observed = 0n
      for (;;) {
        available(execution)
        const read = readSync(descriptor, buffer)
        if (!read) break
        observed += BigInt(read)
        if (observed > entry.stat.size) throw new Error(`Jig package changed while reading: ${selected}/${entry.local}`)
        hash.update(buffer.subarray(0, read))
      }
      if (observed !== entry.stat.size || !same(entry.stat, fstatSync(descriptor, { bigint: true })) ||
        !same(entry.stat, statFor(entry.absolute)) || realpathSync(entry.absolute) !== entry.absolute)
        throw new Error(`Jig package changed while reading: ${selected}/${entry.local}`)
    } finally { closeSync(descriptor) }
  }
  for (const directory of directories)
    if (!same(directory.stat, statFor(directory.absolute)) || realpathSync(directory.absolute) !== directory.absolute)
      throw new Error(`Jig package directory changed while reading: ${selected}`)
  available(execution)
  return `sha256:${hash.digest('hex')}`
}

async function inspect(root: string, route: string, execution: Required<Pick<Deadline, 'deadline'>> & Deadline): Promise<unknown> {
  available(execution)
  return new Promise((done, reject) => {
    const child = spawn('jig', ['inspect', route, '--json'], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    })
    const closed = new Promise<void>((resolveClosed) => child.once('close', () => resolveClosed()))
    const stdout: Buffer[] = []
    let stderr = Buffer.alloc(0)
    let bytes = 0
    let settled = false
    const stop = () => {
      if (child.pid && process.platform !== 'win32') {
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* Already stopped. */ }
      }
      child.kill('SIGKILL')
    }
    const finish = (error?: Error, code: number | null = null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      execution.signal?.removeEventListener('abort', abort)
      stop()
      if (error) { child.stdout?.destroy(); child.stderr?.destroy() }
      void closed.then(() => {
        process.removeListener('exit', stop)
        if (error) return reject(error)
        if (code !== 0) return reject(new Error(`Jig inspection failed for ${route} (${code}): ${JSON.stringify(stderr.toString('utf8'))}`))
        try { done(JSON.parse(Buffer.concat(stdout).toString('utf8'))) }
        catch { reject(new Error(`Invalid Jig inspection JSON for ${route}`)) }
      })
    }
    const timer = setTimeout(() => finish(new Error('Jig route verification feedback deadline expired')),
      Math.max(0, execution.deadline - performance.now()))
    const abort = () => finish(new Error('Jig route verification cancelled'))
    process.once('exit', stop)
    execution.signal?.addEventListener('abort', abort, { once: true })
    child.stdout!.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 16 * 1024 * 1024) finish(new Error('Jig inspection exceeds the 16 MiB output limit'))
      else stdout.push(chunk)
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      stderr = Buffer.from(Buffer.concat([stderr, chunk]).subarray(-4096))
      if (bytes > 16 * 1024 * 1024) finish(new Error('Jig inspection exceeds the 16 MiB output limit'))
    })
    child.once('error', (error) => finish(new Error(`Cannot inspect Jig route ${route}: ${error.message}`)))
    child.once('exit', stop)
    child.once('close', (code) => finish(undefined, code))
    if (execution.signal?.aborted) abort()
  })
}

/** Inspect installed Jig approval before/after execution; never review or import candidate code. */
export async function verifyJigRoutes(
  root: string,
  files: readonly string[],
  facts: JigRouteFact[],
  options: { signal?: AbortSignal; timeoutMs: number },
  prior?: JigRouteReceipt[],
): Promise<JigRouteReceipt[]> {
  if (!validJigRouteFacts(facts)) throw new Error('Invalid Jig route requirements')
  if (facts.length && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0))
    throw new Error('Jig route verification feedback deadline expired')
  if (prior !== undefined) {
    const problems = jigEvidenceProblems(facts, prior)
    if (problems.length) throw new Error(problems.join('; '))
  }
  const execution = { signal: options.signal, deadline: performance.now() + options.timeoutMs }
  const receipts: JigRouteReceipt[] = []
  const measured = new Map<string, string>()
  const inspections = new Map<string, unknown>()
  const empty = (value: unknown) => object(value) && Object.keys(value).length === 0
  for (const fact of facts) {
    available(execution)
    if (!inspections.has(fact.route)) inspections.set(fact.route, await inspect(root, fact.route, execution))
    const selected = inspections.get(fact.route)
    if (!object(selected) || selected.state !== 'environment-matches' ||
      !object(selected.availability) || selected.availability.state !== 'ready' ||
      !digest(selected.revision) || !digest(selected.approval))
      throw new Error(`Jig route ${fact.route} needs a ready, verified approval; inspect the project and run jig review`)
    if (selected.target !== fact.route || selected.package !== fact.packagePath || selected.digest !== fact.digest ||
      json(selected.settings) !== json(fact.settings) || !empty(selected.slots) || !empty(selected.attachments) ||
      !Array.isArray(selected.artifactResults) || selected.artifactResults.length !== 0 ||
      !Array.isArray(selected.boundReadAttachments) || selected.boundReadAttachments.length !== 0 ||
      selected.entrypoint !== undefined || selected.agentOverride !== undefined)
      throw new Error(`Jig approval does not match current source or binding settings for ${fact.route}; inspect changes and run jig review`)
    let current = measured.get(fact.packagePath)
    if (current === undefined) {
      current = jigPackageDigest(root, files, fact.packagePath, execution)
      measured.set(fact.packagePath, current)
    }
    if (current !== fact.digest)
      throw new Error(`Jig package changed after analysis: ${fact.packagePath}`)
    receipts.push({ ...structuredClone(fact), revision: selected.revision, approval: selected.approval })
  }
  if (!validJigRouteReceipts(receipts)) throw new Error('Jig approval changed during route verification')
  if (prior !== undefined && json(prior.map((entry) => json(entry)).sort()) !== json(receipts.map((entry) => json(entry)).sort()))
    throw new Error('Jig approval changed during application verification')
  if (facts.length) available(execution)
  return receipts
}
