import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Source } from '../../src/model.ts'

export type NativeResponse = {
  protocol: 1
  structuralComplete: boolean
  typescriptDiagnostics: 'not-run'
  source: Source
  elapsedMs: number
}

export function binaryPath() {
  const name = `bonsai-collector-prototype${process.platform === 'win32' ? '.exe' : ''}`
  return (
    process.env.BONSAI_NATIVE_BINARY ??
    resolve(process.env.CARGO_TARGET_DIR ?? 'native/target', 'release', name)
  )
}

export function collectNative(root: string, files: string[], bindings: string): NativeResponse {
  const binary = binaryPath()
  if (!existsSync(binary))
    throw new Error(`Native prototype isn't built: ${binary}. Run bun run native:build`)
  const result = spawnSync(binary, [], {
    input: JSON.stringify({ protocol: 1, root, files, bindings }) + '\n',
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Native collector failed: ${result.stderr}`)
  const response = JSON.parse(result.stdout)
  if (response.error) throw new Error(response.error)
  if (
    response.protocol !== 1 ||
    response.typescriptDiagnostics !== 'not-run' ||
    !response.source ||
    typeof response.structuralComplete !== 'boolean' ||
    !Number.isFinite(response.elapsedMs)
  )
    throw new Error('Invalid native collector response')
  return response
}

export function canonicalSource(source: Source): unknown {
  const copy = structuredClone(source)
  copy.files.sort((a, b) => a.file.localeCompare(b.file))
  copy.components.sort((a, b) => a.id.localeCompare(b.id))
  copy.relationships.sort((a, b) => `${a.from}\0${a.to}`.localeCompare(`${b.from}\0${b.to}`))
  copy.problems.sort()
  return copy
}
