import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { CliError } from './cli-interface.ts'
import type { Config } from './model.ts'

const ignored = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '.turbo',
  '.vercel',
  '.svelte-kit',
  '.parcel-cache',
  'target',
])
const quote = (word: string) => "'" + word.replaceAll("'", "'\\''") + "'"

export function initialize(root: string, checkDeadline: () => void) {
  const file = join(root, 'bonsai.json')
  const inspect = `bonsai config show --root ${quote(root)}`
  const stat = (path: string) => {
    try {
      return lstatSync(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }
  checkDeadline()
  if (!stat(root)?.isDirectory())
    throw new CliError(
      `Project directory not found: ${root}`,
      'INIT',
      'Use --root with an existing project directory',
    )
  if (stat(file))
    throw new CliError(`Configuration already exists: ${file}`, 'CONFIG_EXISTS', inspect)
  const excluded: string[] = []
  const files: string[] = []
  const discover = (path: string): string[] => {
    checkDeadline()
    const entry = lstatSync(join(root, path))
    if (
      ignored.has(path.split('/').at(-1)!) ||
      entry.isSymbolicLink() ||
      (!entry.isFile() && !entry.isDirectory())
    ) {
      excluded.push(path)
      return []
    }
    if (entry.isFile()) {
      files.push(path)
      return [path]
    }
    const before = excluded.length
    const children = readdirSync(join(root, path))
      .sort()
      .flatMap((name) => discover(`${path}/${name}`))
    return excluded.length === before ? [path] : children
  }
  const maintained = readdirSync(root).sort().flatMap(discover)
  const bindings =
    ['bindings.ts', 'bonsai.bindings.ts'].find((path) => files.includes(path)) ??
    'bonsai.bindings.ts'
  const feature = files.find((path) => path.endsWith('.feature')) ?? 'features/bonsai.feature'
  const pending = new Map<string, string>()
  if (!files.includes(bindings))
    pending.set(
      bindings,
      [
        '// Connect named handlers from your application to the actions in your contracts.',
        "// import { yourHandler } from './src/your-module.ts'",
        "// export const actions = { 'your-action': yourHandler }",
        'export const actions = {}',
        '',
      ].join('\n'),
    )
  if (!files.includes(feature))
    pending.set(
      feature,
      [
        '# Replace this commented example with a contract for a real application handler.',
        '# Register that handler in bonsai.bindings.ts (or your existing bindings.ts).',
        '# Feature: Describe an observable product behavior',
        '#   Scenario: Describe one expected outcome',
        '#     When I invoke "your-action" with {}',
        '#     Then response "status" equals "expected-value"',
        '',
      ].join('\n'),
    )
  const paths = [...maintained]
  const planned = [...pending.keys()].map((path) =>
    path === 'features/bonsai.feature' && !stat(join(root, 'features')) ? 'features' : path,
  )
  for (const path of [...planned, 'bonsai.json'])
    if (!paths.some((parent) => path === parent || path.startsWith(parent + '/'))) paths.push(path)
  const config: Config = {
    maintained: paths.sort(),
    bindings,
    policy: {
      bootstrap: 20000,
      bootstrapSurface: 20,
      perDoubling: 2000,
      hardLimit: 30000,
      maxFeedbackMs: 15000,
    },
  }
  pending.set('bonsai.json', JSON.stringify(config, null, 2) + '\n')
  for (const path of pending.keys()) {
    const parent = stat(dirname(join(root, path)))
    if (stat(join(root, path)) || (parent && (!parent.isDirectory() || parent.isSymbolicLink())))
      throw new CliError(
        `Starter path is already occupied: ${path}`,
        'INIT',
        `Keep existing files and choose a project directory with room for ${path}`,
      )
  }
  const created: string[] = []
  const directories: string[] = []
  try {
    for (const [path, content] of pending) {
      checkDeadline()
      const parent = dirname(join(root, path))
      if (!stat(parent)) {
        mkdirSync(parent)
        directories.push(parent)
      }
      const descriptor = openSync(join(root, path), 'wx')
      created.push(path)
      try {
        writeFileSync(descriptor, content)
      } finally {
        closeSync(descriptor)
      }
    }
    checkDeadline()
  } catch (error) {
    for (const path of created.reverse()) unlinkSync(join(root, path))
    for (const directory of directories.reverse()) rmdirSync(directory)
    throw error
  }
  const next = [
    `Connect real named handlers in ${bindings} and executable scenarios in ${feature}`,
    'Review the detected inventory and calibrate the draft budget against your first real baseline',
    `bonsai check --root ${quote(root)}`,
  ]
  return { root, file, created, config, excluded, next }
}
