import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fingerprint, inventory } from './inventory.ts'
import type { Config } from './model.ts'

/** Internal execution boundary: load only the measured registry of this project snapshot. */
export function projectBindingTarget(root: string, config: Config, expectedFingerprint: string) {
  const files = inventory(root, config.maintained, config.exclude)
  if (!files.includes(config.bindings))
    throw new Error('The binding file must be in maintained inventory')
  if (fingerprint(root, files, config) !== expectedFingerprint)
    throw new Error('Maintained files changed before binding import')
  const file = realpathSync(resolve(root, config.bindings))
  return Object.freeze({
    url: pathToFileURL(file).href + `?snapshot=${expectedFingerprint}`,
    adapter: 'project-bindings-v1' as const,
    file: config.bindings,
    fingerprint: expectedFingerprint,
  })
}
