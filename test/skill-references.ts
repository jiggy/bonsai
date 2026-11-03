import { createHash } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inventory } from '../src/inventory.ts'

const repository = 'https://github.com/jiggy/bonsai'
const outputPath = 'skills/bonsai/reference'
const skillPath = 'skills/bonsai/SKILL.md'
export const referenceSources: Record<string, string> = {
  'README.md': 'README.md',
  'docs/agent-workflow.md': 'workflow.md',
  'docs/adoption.md': 'adoption.md',
  'docs/bdd.md': 'bdd.md',
  'docs/cli.md': 'cli.md',
  'docs/verification.md': 'verification.md',
  'docs/github-action.md': 'github-action.md',
  'docs/native-prototype.md': 'native-prototype.md',
  'LICENSE.md': 'LICENSE.md',
  'LICENSES.md': 'LICENSES.md',
  'PRICING.md': 'PRICING.md',
  'LICENSE-ACTION': 'LICENSE-ACTION',
}
const posix = (path: string) => path.split(sep).join('/')
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')
const external = (target: string) => /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)

async function inspect(root: string, path: string): Promise<Stats> {
  if (
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`Invalid reference path: ${path}`)
  let current = root
  let stat!: Stats
  for (const part of path.split('/')) {
    current = join(current, part)
    stat = await lstat(current)
    if (stat.isSymbolicLink()) throw new Error(`Reference paths cannot contain symlinks: ${path}`)
  }
  return stat
}

async function sourceBytes(root: string, path: string) {
  if (!(await inspect(root, path)).isFile())
    throw new Error(`Expected a regular source file: ${path}`)
  return readFile(join(root, path))
}

function decode(bytes: Uint8Array, source: string) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`Expected UTF-8 source: ${source}`)
  }
}

function maskCode(line: string) {
  const marks = [...line.matchAll(/`+/g)]
  const characters = line.split('')
  for (let index = 0; index < marks.length; index++) {
    const opening = marks[index]
    const closing = marks.findIndex(
      (mark, other) => other > index && mark[0].length === opening[0].length,
    )
    if (closing < 0) continue
    characters.fill(' ', opening.index, marks[closing].index + marks[closing][0].length)
    index = closing
  }
  return characters.join('')
}

async function markdownLinks(text: string, rewrite: (target: string) => string | Promise<string>) {
  const lines = text.split(/(?<=\n)/)
  let fence: string | undefined
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const marker = /^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/.exec(line.trimEnd())
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim())
        fence = undefined
      continue
    }
    if (fence || /^(?: {4}|\t)/.test(line)) continue
    const targets: [number, number][] = []
    for (const expression of [
      /!?\[[^\]\n]*\]\(\s*(?:<(?<angle>[^>]+)>|(?<bare>[^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/dg,
      /^\s{0,3}\[[^\]]+\]:\s*(?:<(?<angle>[^>]+)>|(?<bare>\S+))/dg,
      /\b(?:href|src)\s*=\s*["'](?<bare>[^"']+)["']/dg,
    ]) {
      for (const match of maskCode(line).matchAll(expression)) {
        const range = match.indices?.groups?.angle ?? match.indices?.groups?.bare
        if (range) targets.push(range)
      }
    }
    for (const [start, end] of targets.sort((a, b) => b[0] - a[0]))
      lines[index] =
        lines[index].slice(0, start) +
        (await rewrite(line.slice(start, end))) +
        lines[index].slice(end)
  }
  return lines.join('')
}

async function referenceFiles(root: string) {
  const inputs = new Map(
    await Promise.all(
      inventory(root, [...Object.keys(referenceSources), skillPath]).map(
        async (source) => [source, await sourceBytes(root, source)] as const,
      ),
    ),
  )
  const files = new Map<string, Buffer>()
  const records = []
  for (const [source, destination] of Object.entries(referenceSources)) {
    const bytes = inputs.get(source)
    if (!bytes) throw new Error(`Expected a regular source file: ${source}`)
    let output = bytes
    if (source.endsWith('.md')) {
      output = Buffer.from(
        await markdownLinks(decode(bytes, source), async (target) => {
          const [, pathname, suffix] = /^([^?#]*)([\s\S]*)$/.exec(target)!
          if (!pathname) return target
          const canonical = pathname.startsWith(`${repository}/blob/main/`)
            ? pathname.slice(`${repository}/blob/main/`.length)
            : undefined
          if (!canonical && external(pathname)) return target
          const linked =
            canonical ??
            posix(
              relative(
                root,
                resolve(
                  root,
                  pathname.startsWith('/') ? '.' : dirname(source),
                  decodeURIComponent(pathname.replace(/^\//, '')),
                ),
              ),
            )
          const stat = await inspect(root, linked)
          const bundled =
            referenceSources[linked] ?? (linked === skillPath ? '../SKILL.md' : undefined)
          if (bundled) return encodePath(posix(relative(dirname(destination), bundled))) + suffix
          const kind = stat.isDirectory() ? 'tree' : 'blob'
          return `${repository}/${kind}/main/${encodePath(linked)}${suffix}`
        }),
      )
    }
    files.set(destination, output)
    records.push({ source, destination, sourceSha256: digest(bytes), outputSha256: digest(output) })
  }
  files.set(
    'provenance.json',
    Buffer.from(JSON.stringify({ version: 1, repository, files: records }, null, 2) + '\n'),
  )
  const skill = inputs.get(skillPath)
  if (!skill) throw new Error(`Expected a regular source file: ${skillPath}`)
  await markdownLinks(decode(skill, skillPath), async (target) => {
    if (external(target)) return target
    const local = posix(
      relative(
        join(root, dirname(skillPath)),
        resolve(root, dirname(skillPath), decodeURIComponent(target.split(/[?#]/, 1)[0])),
      ),
    )
    if (local.startsWith('reference/') && files.has(local.slice('reference/'.length))) return target
    if (local.startsWith('../') || local.startsWith('/') || local === '..')
      throw new Error(`Skill link escapes its installed directory: ${target}`)
    await sourceBytes(root, `${dirname(skillPath)}/${local}`)
    return target
  })
  return files
}

async function existingFiles(root: string): Promise<Map<string, Buffer>> {
  try {
    if (!(await inspect(root, outputPath)).isDirectory())
      throw new Error('Expected a reference directory')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw error
  }
  return new Map(
    await Promise.all(
      inventory(root, [outputPath]).map(
        async (path) =>
          [path.slice(outputPath.length + 1), await readFile(join(root, path))] as const,
      ),
    ),
  )
}

async function removeEmptyDirectories(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(directory, entry.name)
    await removeEmptyDirectories(path)
    if (!(await readdir(path)).length) await rmdir(path)
  }
}

export async function syncSkills({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  check = false,
}: {
  root?: string
  check?: boolean
} = {}) {
  root = resolve(root)
  const files = await referenceFiles(root)
  const existing = await existingFiles(root)
  const removed = [...existing.keys()].filter((path) => !files.has(path))
  const updated = [...files.keys()].filter((path) => !existing.get(path)?.equals(files.get(path)!))
  const changes = [...removed, ...updated].map((path) => `${outputPath}/${path}`).sort()
  if (check) {
    if (changes.length)
      throw new Error(
        `Skill references are stale:\n${changes.join('\n')}\nRun bun run sync-skills.`,
      )
    return changes
  }
  // Validate the complete source and output tree before changing generated files.
  await mkdir(join(root, outputPath), { recursive: true })
  for (const path of removed) await rm(join(root, outputPath, path))
  await removeEmptyDirectories(join(root, outputPath))
  for (const path of updated) await writeFile(join(root, outputPath, path), files.get(path)!)
  return changes
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    let root: string | undefined
    let check = false
    while (args.length) {
      const arg = args.shift()
      if (arg === '--check' && !check) check = true
      else if (arg === '--root' && !root && args[0] && !args[0].startsWith('--'))
        root = args.shift()
      else throw new Error('Usage: bun test/skill-references.ts [--check] [--root PATH]')
    }
    const changes = await syncSkills({ root, check })
    console.log(
      check ? 'Skill references are current.' : `Synchronized ${changes.length} skill references.`,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
