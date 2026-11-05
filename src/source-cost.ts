import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Source } from './model.ts'

/** Compiler-independent retained text accounting for native-language adapters. */
export function plainTokens(text: string): number {
  return (text.match(/[\p{L}\p{N}_]+|[^\s]/gu) ?? []).length
}

export function measurePlainSource(root: string, files: string[]): Source {
  return {
    files: files.map((file) => ({
      file,
      tokens: plainTokens(readFileSync(resolve(root, file), 'utf8')),
    })),
    components: [],
    relationships: [],
    actions: Object.create(null),
    problems: [],
  }
}
