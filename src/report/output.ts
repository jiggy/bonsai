import { lstatSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { open, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { excludedBy } from '../exclusions.ts'
import type { Config } from '../model.ts'

const within = (parent: string, path: string) => {
  const local = relative(parent, path)
  return local === '' || (!isAbsolute(local) && local !== '..' && !local.startsWith('..' + sep))
}

function stat(path: string) {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Preserve the caller's root spelling while admitting its canonical directory alias. */
function validateParents(root: string, path: string): void {
  let current = within(root, path) ? root : parse(path).root
  const parts = relative(current, path).split(sep).filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]!)
    const facts = stat(current)
    if (!facts) break
    if (facts.isSymbolicLink()) throw new Error(`HTML report path is a symlink: ${current}`)
    if (i < parts.length - 1 && !facts.isDirectory())
      throw new Error(`HTML report parent is not a directory: ${current}`)
    if (i === parts.length - 1 && !facts.isFile())
      throw new Error(`HTML report destination must be a regular file: ${current}`)
  }
}

function canonical(path: string): string {
  let parent = path
  while (!stat(parent)) {
    const next = dirname(parent)
    if (next === parent) throw new Error(`Can't resolve HTML report path: ${path}`)
    parent = next
  }
  return resolve(realpathSync(parent), relative(parent, path))
}

/** Preflight before project execution; never introduce an implicit inventory exclusion. */
export function resolveReportDestination(root: string, config: Config, value: string): string {
  if (!value.trim() || value === '-' || value.includes('\0'))
    throw new Error('HTML report needs a file path; use --json for standard output')
  root = resolve(root)
  const destination = resolve(root, value)
  const excluded = excludedBy(config.exclude ?? [])
  const canonicalRoot = realpathSync(root)
  const validate = (path: string) => {
    validateParents(root, path)
    const real = canonical(path)
    const local = relative(canonicalRoot, real).split(sep).join('/')
    if (within(canonicalRoot, real)) {
      if (/^(?:\.git|\.hg|\.svn)(?:\/|$)/.test(local))
        throw new Error(`HTML report cannot replace version-control data: ${value}`)
      if (['bonsai.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(local))
        throw new Error(`HTML report overlaps project input: ${value}`)
      if (!excluded(local))
        for (const entry of config.maintained) {
          if (within(canonical(resolve(root, entry)), real))
            throw new Error(`HTML report overlaps maintained input: ${value}; choose an excluded generated-output directory`)
        }
    }
  }
  validate(destination)
  // A filename-only exclusion cannot authorize temporary writes into maintained scope.
  validate(join(dirname(destination), '.bonsai-report-temporary.tmp'))
  return destination
}

export type ReportWriteOptions = {
  signal?: AbortSignal
  checkDeadline?: () => void
  validatePath?: (path: string) => void
}

/** Publish one complete artifact, preserving the previous file on failure or cancellation. */
export async function writeHtmlReport(
  destination: string,
  html: string,
  options: ReportWriteOptions = {},
): Promise<void> {
  const check = () => {
    options.checkDeadline?.()
    options.signal?.throwIfAborted()
  }
  check()
  options.validatePath?.(destination)
  const temporary = join(dirname(destination), `.bonsai-report-${randomUUID()}.tmp`)
  options.validatePath?.(temporary)
  mkdirSync(dirname(destination), { recursive: true })
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let published = false
  try {
    check()
    handle = await open(temporary, 'wx', 0o600)
    check()
    await handle.writeFile(html, 'utf8')
    await handle.close()
    handle = undefined
    check()
    options.validatePath?.(destination)
    options.validatePath?.(temporary)
    check()
    await rename(temporary, destination)
    published = true
  } finally {
    await handle?.close()
    if (!published) rmSync(temporary, { force: true })
  }
}
