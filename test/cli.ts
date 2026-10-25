import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const executable = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

export function cliEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BONSAI_ROOT: undefined,
    BONSAI_BASE: undefined,
    BONSAI_POLICY: undefined,
    FORCE_COLOR: undefined,
    NO_COLOR: '1',
    CI: '1',
    ...extra,
  }
}

/** Raw results keep exit, stream, and transport assertions with each test. */
export function runCli(
  args: string[],
  options: Pick<
    SpawnSyncOptionsWithStringEncoding,
    'env' | 'cwd' | 'input' | 'timeout' | 'maxBuffer'
  > = {},
) {
  return spawnSync(process.execPath, [executable, ...args], {
    encoding: 'utf8',
    env: options.env ?? cliEnvironment(),
    cwd: options.cwd,
    input: options.input,
    timeout: options.timeout ?? 15000,
    maxBuffer: options.maxBuffer,
  })
}
