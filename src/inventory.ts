import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import type { Config } from './model.ts'
import { excludedBy } from './exclusions.ts'

export function inventory(root: string, paths: string[], exclude: string[] = []): string[] {
  const found = new Set<string>()
  const excluded = excludedBy(exclude)
  const walk = (path: string): void => {
    const absolute = resolve(root, path)
    if (!absolute.startsWith(resolve(root) + sep))
      throw new Error(`Maintained path escapes root: ${path}`)
    const local = relative(root, absolute).split(sep).join('/')
    if (excluded(local)) return
    const stat = lstatSync(absolute)
    if (stat.isDirectory() && excluded(local, true)) return
    if (!realpathSync(absolute).startsWith(realpathSync(root) + sep))
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
  const hash = createHash('sha256').update('bonsai-snapshot-v1\0').update(JSON.stringify(config))
  for (const file of files)
    hash.update('\0' + file + '\0').update(readFileSync(resolve(root, file)))
  return hash.digest('hex')
}
