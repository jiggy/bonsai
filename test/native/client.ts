import { collectRustSource } from '../../src/collector.ts'
import type { Source } from '../../src/model.ts'

/** Exercise the production native collector; reference analysis belongs in the caller. */
export function collectNative(root: string, files: string[], bindings: string) {
  return collectRustSource(root, files, bindings, undefined, 30000)
}

export function canonicalSource(source: Source): Source {
  const copy = structuredClone(source)
  copy.files.sort((a, b) => a.file.localeCompare(b.file))
  copy.components.sort((a, b) => a.id.localeCompare(b.id))
  copy.relationships.sort((a, b) =>
    `${a.from}\0${a.to}\0${a.sourceRef.file}\0${a.sourceRef.line}`.localeCompare(
      `${b.from}\0${b.to}\0${b.sourceRef.file}\0${b.sourceRef.line}`,
    ),
  )
  copy.actions = Object.fromEntries(
    Object.entries(copy.actions).sort(([a], [b]) => a.localeCompare(b)),
  )
  copy.bindingImports?.sort((a, b) =>
    `${a.file}\0${a.line}\0${a.from}`.localeCompare(`${b.file}\0${b.line}\0${b.from}`),
  )
  copy.problems.sort()
  return copy
}
