import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../../src/cli.ts', import.meta.url))
export const repository = fileURLToPath(new URL('../../', import.meta.url))

export function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BONSAI_ROOT: undefined,
    BONSAI_BASE: undefined,
    BONSAI_POLICY: undefined,
    FORCE_COLOR: undefined,
    NO_COLOR: '1',
    CI: '1',
    ...overrides,
  }
}

export function runCli(args: string[], overrides: NodeJS.ProcessEnv = {}, input?: string) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: repository,
    encoding: 'utf8',
    input: input,
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
    env: environment(overrides),
  })
  if (result.error) throw result.error
  if (result.status === null) throw new Error(`Bonsai stopped before reporting: ${result.signal}`)
  return { ...result, status: result.status }
}

export function invoke(args: string[], overrides: NodeJS.ProcessEnv = {}, input?: string) {
  const result = runCli([...args, '--json'], overrides, input)
  return { exitCode: result.status, ...JSON.parse(result.stdout || result.stderr) }
}

export function startCli(args: string[], overrides: NodeJS.ProcessEnv = {}) {
  return spawn(process.execPath, [entry, ...args], {
    cwd: repository,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: environment(overrides),
  })
}
