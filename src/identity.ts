import { createHash, type Hash } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeBinary } from './native-install.ts'

export type ExecutionIdentity = {
  schema: 'bonsai-execution-v1'
  checker: { name: string; version: string; digest: string }
  runtime: { name: 'bun'; version: string; options: string }
  compiler: { name: 'tsrs' | 'python'; version: string; digest: string }
}

const installed = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0

export function validExecutionIdentity(value: unknown): value is ExecutionIdentity {
  return (
    object(value) &&
    value.schema === 'bonsai-execution-v1' &&
    object(value.checker) &&
    text(value.checker.name) &&
    text(value.checker.version) &&
    digest(value.checker.digest) &&
    object(value.runtime) &&
    value.runtime.name === 'bun' &&
    text(value.runtime.version) &&
    digest(value.runtime.options) &&
    object(value.compiler) &&
    (value.compiler.name === 'tsrs' || value.compiler.name === 'python') &&
    text(value.compiler.version) &&
    digest(value.compiler.digest)
  )
}

export function sameExecutionIdentity(left: unknown, right: unknown): boolean {
  return (
    validExecutionIdentity(left) &&
    validExecutionIdentity(right) &&
    left.schema === right.schema &&
    left.checker.name === right.checker.name &&
    left.checker.version === right.checker.version &&
    left.checker.digest === right.checker.digest &&
    left.runtime.name === right.runtime.name &&
    left.runtime.version === right.runtime.version &&
    left.runtime.options === right.runtime.options &&
    left.compiler.name === right.compiler.name &&
    left.compiler.version === right.compiler.version &&
    left.compiler.digest === right.compiler.digest
  )
}

function addFile(hash: Hash, label: string, file: string): void {
  const stat = statSync(file)
  if (!stat.isFile()) throw new Error(`Identity input must be a regular file: ${file}`)
  hash.update(JSON.stringify([label, stat.size]) + '\n')
  const descriptor = openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(Math.min(Math.max(stat.size, 1), 1024 * 1024))
  try {
    let bytes: number
    while ((bytes = readSync(descriptor, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, bytes))
  } finally {
    closeSync(descriptor)
  }
}

function codeFiles(directory: string, relative = ''): string[] {
  const files: string[] = []
  for (const name of readdirSync(join(directory, relative)).sort()) {
    const local = relative ? `${relative}/${name}` : name
    const stat = lstatSync(join(directory, local))
    if (stat.isSymbolicLink()) throw new Error(`Identity source cannot be a symlink: ${local}`)
    if (stat.isDirectory()) files.push(...codeFiles(directory, local))
    else if (stat.isFile() && /\.(?:[cm]?[jt]s|json)$/.test(local)) files.push(local)
  }
  return files
}

/** Installed checker content, independent of its location or the consuming project. */
export function checkerIdentity(root = installed): ExecutionIdentity['checker'] {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name?: unknown
    version?: unknown
  }
  if (!text(manifest.name) || !text(manifest.version))
    throw new Error('Installed checker manifest needs a name and version')
  const hash = createHash('sha256').update('bonsai-checker-v1\0')
  addFile(hash, 'package.json', join(root, 'package.json'))
  for (const file of codeFiles(join(root, 'src')))
    addFile(hash, `src/${file}`, join(root, 'src', file))
  return { name: manifest.name, version: manifest.version, digest: hash.digest('hex') }
}

function addToolchainCode(hash: Hash): string {
  const sdkManifest = require.resolve('tsrs/package.json')
  const sdk = dirname(sdkManifest)
  const version: unknown = JSON.parse(readFileSync(sdkManifest, 'utf8')).version
  if (!text(version)) throw new Error('The tsrs version is required for evidence')
  addFile(hash, 'tsrs/package.json', sdkManifest)
  for (const directory of ['dist', 'lib', 'vendor'])
    for (const file of codeFiles(join(sdk, directory)))
      addFile(hash, `tsrs/${directory}/${file}`, join(sdk, directory, file))
  const typescript = dirname(require.resolve('typescript/package.json'))
  addFile(hash, 'typescript/package.json', join(typescript, 'package.json'))
  addFile(hash, 'typescript/lib/typescript.js', join(typescript, 'lib/typescript.js'))
  return version
}

/** Only cached modules need a session key; every request starts a fresh native binary. */
export function sessionContentKey(environment: NodeJS.ProcessEnv = process.env): string {
  const hash = createHash('sha256').update('bonsai-session-content-v1\0')
  hash.update(JSON.stringify(checkerIdentity()))
  addToolchainCode(hash)
  hash.update(
    JSON.stringify([
      process.versions.bun,
      environment.BUN_OPTIONS ?? null,
      environment.NODE_OPTIONS ?? null,
    ]),
  )
  return hash.digest('hex')
}

function runtimeIdentity(): ExecutionIdentity['runtime'] {
  const version = process.versions.bun
  if (!text(version)) throw new Error('The Bun version is required for evidence')
  return {
    name: 'bun',
    version,
    options: createHash('sha256')
      .update(JSON.stringify([process.env.BUN_OPTIONS ?? null, process.env.NODE_OPTIONS ?? null]))
      .digest('hex'),
  }
}

/** The verifier checks its execution context before opening the application boundary. */
export function applicationIdentity(expected: ExecutionIdentity): ExecutionIdentity {
  if (!validExecutionIdentity(expected))
    throw new Error('Verification checker or toolchain identity changed')
  const identity: ExecutionIdentity = {
    schema: 'bonsai-execution-v1',
    checker: Object.freeze(checkerIdentity()),
    runtime: Object.freeze(runtimeIdentity()),
    compiler: Object.freeze({ ...expected.compiler }),
  }
  if (!sameExecutionIdentity(identity, expected))
    throw new Error('Verification checker or toolchain identity changed')
  return Object.freeze(identity)
}

/** Capture content identity, not execution authenticity or dependency attestation. */
export function executionIdentity(binary = nativeBinary()): ExecutionIdentity {
  const hash = createHash('sha256').update('bonsai-toolchain-v1\0')
  addFile(hash, 'native-binary', binary)
  const version = addToolchainCode(hash)
  return {
    schema: 'bonsai-execution-v1',
    checker: checkerIdentity(),
    runtime: runtimeIdentity(),
    compiler: { name: 'tsrs', version, digest: hash.digest('hex') },
  }
}

/** Capture the common verifier context without selecting a TypeScript compiler. */
export function analysisIdentity(compiler: ExecutionIdentity['compiler']): ExecutionIdentity {
  return {
    schema: 'bonsai-execution-v1',
    checker: checkerIdentity(),
    runtime: runtimeIdentity(),
    compiler,
  }
}

/** Select only the installed runtime required by the native binding suffix. */
export async function identityForBindings(
  bindings: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<ExecutionIdentity> {
  return bindings.endsWith('.py')
    ? (await import('./python.ts')).pythonIdentity(signal, timeoutMs)
    : executionIdentity()
}
