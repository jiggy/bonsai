import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Config, Policy } from '../../src/model.ts'

export function write(root: string, file: string, text: string) {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

export function project(
  sources: Record<string, string>,
  policy: Partial<Policy> = {},
  scope: Partial<Pick<Config, 'maintained' | 'exclude' | 'bindings'>> = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-contract-'))
  const files = { 'package.json': '{"type":"module"}\n', ...sources }
  for (const [file, text] of Object.entries(files)) write(root, file, text)
  const config: Config = {
    maintained: [...Object.keys(files), 'bonsai.json'],
    bindings: 'bindings.ts',
    policy: {
      bootstrap: 10000,
      bootstrapSurface: 1,
      perDoubling: 0,
      hardLimit: 10000,
      maxFeedbackMs: 15000,
      ...policy,
    },
    ...scope,
  }
  write(root, 'bonsai.json', JSON.stringify(config))
  return { root, config, dispose: () => rmSync(root, { recursive: true, force: true }) }
}
