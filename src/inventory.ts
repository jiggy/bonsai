import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import type { Config } from './model.ts'
import { excludedBy } from './exclusions.ts'

export class InventoryError extends Error {
  constructor(path: string) {
    super(`Maintained path does not exist: ${path}`)
    this.name = 'InventoryError'
  }
}

export function inventory(root: string, paths: string[], exclude: string[] = []): string[] {
  const found = new Set<string>()
  const excluded = excludedBy(exclude)
  // Resolve the owned root once for this synchronous inventory. Every child
  // still receives its own lstat and canonical-path check before fingerprinting.
  const absoluteRoot = resolve(root)
  const physicalRoot = realpathSync(absoluteRoot) + sep
  const ownedRoot = absoluteRoot + sep
  const walk = (path: string): void => {
    const absolute = resolve(absoluteRoot, path)
    if (!absolute.startsWith(ownedRoot)) throw new Error(`Maintained path escapes root: ${path}`)
    const local = relative(root, absolute).split(sep).join('/')
    if (excluded(local)) return
    let stat
    try {
      stat = lstatSync(absolute)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') throw new InventoryError(local)
      throw error
    }
    if (stat.isDirectory() && excluded(local, true)) return
    if (!realpathSync(absolute).startsWith(physicalRoot))
      throw new Error(`Maintained path escapes root: ${path}`)
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are unsupported: ${path}`)
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) walk(relative(root, resolve(absolute, name)))
    } else if (stat.isFile()) found.add(relative(root, absolute).split(sep).join('/'))
  }
  paths.forEach(walk)
  return [...found].sort()
}

export function fingerprint(root: string, files: string[], config: Config): string {
  const hash = createHash('sha256').update('bonsai-snapshot-v2\0').update(JSON.stringify(config))
  for (const file of files)
    hash.update('\0' + file + '\0').update(readFileSync(resolve(root, file)))
  // Dependency resolution inputs remain evidence inputs even when not retained inventory.
  for (const file of [
    'bun.lock',
    'bun.lockb',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    ...(config.bindings.endsWith('.py')
      ? ['uv.lock', 'poetry.lock', 'Pipfile.lock', 'pylock.toml']
      : []),
  ]) {
    const absolute = resolve(root, file)
    let stat
    try {
      stat = lstatSync(absolute)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      hash.update('\0lockfile\0' + file + '\0absent')
      continue
    }
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`Lockfile must be a regular file: ${file}`)
    hash.update('\0lockfile\0' + file + '\0present\0').update(readFileSync(absolute))
  }
  return hash.digest('hex')
}
