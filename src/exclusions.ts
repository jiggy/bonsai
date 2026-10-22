import ignore from 'ignore'

export const defaultExclusions: string[] = [
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
  '.direnv',
  '.bonsai',
  '*.lock',
  '*.lockb',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'skills-lock.json',
]

// Paths supplied by discovery and inventory are relative POSIX paths. Keep
// matching independent of the host filesystem and of subsequent .gitignore edits.
export function excludedBy(patterns: string[]) {
  const matcher = ignore({ ignorecase: false }).add(patterns)
  return (path: string, directory = false): boolean =>
    path !== '' &&
    path !== '.' &&
    matcher.ignores(directory && !path.endsWith('/') ? `${path}/` : path)
}

const escapePath = (path: string) => path.replace(/[\\*?[\]#! ]/g, '\\$&')

export function literalExclusion(path: string, directory = false): string {
  return `/${escapePath(path.replace(/\/$/, ''))}${directory ? '/' : ''}`
}

// Git discards trailing spaces unless an odd run of backslashes quotes the last
// one. Inspect that effective spelling without changing the persisted rule.
function significant(pattern: string): string {
  let end = pattern.length
  while (pattern[end - 1] === ' ') {
    let before = end - 2
    while (pattern[before] === '\\') before--
    if ((end - 2 - before) % 2) break
    end--
  }
  return pattern.slice(0, end)
}

export function scopedIgnore(text: string, base: string): string[] {
  const prefix = base && base !== '.' ? `${literalExclusion(base)}/` : ''
  return text
    .replace(/^\uFEFF/, '')
    .split('\n')
    .flatMap((raw) => {
      const line = raw.replace(/\r$/, '')
      if (!line || line.startsWith('#')) return []
      const negative = line.startsWith('!')
      const pattern = negative ? line.slice(1) : line
      const effective = significant(pattern)
      if (!effective || effective === '/') return []
      if (!prefix) return [line]
      const anchored = effective.startsWith('/') || effective.replace(/\/$/, '').includes('/')
      return [
        `${negative ? '!' : ''}${prefix}${anchored ? pattern.replace(/^\//, '') : `**/${pattern}`}`,
      ]
    })
}
