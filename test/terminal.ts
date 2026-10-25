import { spawnSync } from 'node:child_process'

export const hasPty =
  process.platform === 'linux' && spawnSync('script', ['--version']).status === 0
export const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"

export function characters(text: string) {
  const result: { value: string; color: number | undefined; dim: boolean }[] = []
  let color: number | undefined
  let dim = false
  let cursor = 0
  for (const match of text.matchAll(/\x1b\[([\d;]*)m/g)) {
    for (const value of text.slice(cursor, match.index)) result.push({ value, color, dim })
    for (const code of (match[1] || '0').split(';').map(Number)) {
      if (code === 0) {
        color = undefined
        dim = false
      } else if (code === 2) dim = true
      else if (code === 22) dim = false
      else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) color = code
      else if (code === 39) color = undefined
    }
    cursor = match.index + match[0].length
  }
  for (const value of text.slice(cursor)) result.push({ value, color, dim })
  return result
}
