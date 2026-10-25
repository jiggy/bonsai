import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Policy } from '../src/model.ts'

export function createProject(
  sources: Record<string, string>,
  policy: Partial<Policy> = {},
  prefix = 'bonsai-test-',
) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const files = [...Object.keys(sources), 'bonsai.json']
  for (const [file, text] of Object.entries(sources)) writeFileSync(join(root, file), text)
  writeFileSync(
    join(root, 'bonsai.json'),
    JSON.stringify({
      maintained: files,
      bindings: 'bindings.ts',
      policy: {
        bootstrap: 10000,
        bootstrapSurface: 1,
        perDoubling: 0,
        hardLimit: 10000,
        maxFeedbackMs: 15000,
        ...policy,
      },
    }),
  )
  return { root, files, dispose: () => rmSync(root, { recursive: true, force: true }) }
}
