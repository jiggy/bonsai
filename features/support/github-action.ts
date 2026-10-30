import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { environment, repository } from './cli.ts'
import { project, write } from './project.ts'

const actionEntry = fileURLToPath(new URL('../../.github/action/run.ts', import.meta.url))
const handler = 'export function handle() { return { status: "ok" } }\n'
const largeHandler =
  'export function handle() { return { status: "ok", detail: [' + '0,'.repeat(1200) + '] } }\n'

function git(root: string, ...args: string[]) {
  return execFileSync(
    'git',
    [
      '-C',
      root,
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgSign=false',
      '-c',
      'user.name=Bonsai Example',
      '-c',
      'user.email=example@example.invalid',
      ...args,
    ],
    { encoding: 'utf8' },
  ).trim()
}

export function githubAction(input: { change?: 'grow' | 'incomplete' } = {}) {
  const fixture = project(
    {
      'handler.ts': handler,
      'bindings.ts':
        'import { handle } from "./handler.ts"\nexport const actions = { "handle": handle }\n',
      'app.feature':
        'Feature: Read status\nScenario: Read status\n When I invoke "handle" with {}\n Then response "status" equals "ok"\n',
    },
    { bootstrap: 1000, hardLimit: 1000 },
  )
  const directory = mkdtempSync(join(tmpdir(), 'bonsai-action-example-'))
  try {
    git(fixture.root, 'init', '-b', 'main')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '-m', 'Reviewed policy and scope')
    const base = git(fixture.root, 'rev-parse', 'HEAD')
    if (input.change === 'grow') {
      write(fixture.root, 'handler.ts', largeHandler)
      const config = {
        ...fixture.config,
        maintained: ['bindings.ts'],
        policy: { ...fixture.config.policy, bootstrap: 100000, hardLimit: 100000 },
      }
      write(fixture.root, 'bonsai.json', JSON.stringify(config))
    }
    if (input.change === 'incomplete')
      write(fixture.root, 'handler.ts', 'export function handle() { return missingValue }')
    const output = join(directory, 'outputs')
    const summary = join(directory, 'summary')
    writeFileSync(output, '')
    writeFileSync(summary, '')
    const result = spawnSync(process.execPath, [actionEntry], {
      cwd: repository,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
      env: environment({
        BONSAI_ACTION_ROOT: fixture.root,
        BONSAI_ACTION_BASE: base,
        BONSAI_ACTION_SERIAL: 'false',
        GITHUB_WORKSPACE: fixture.root,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        RUNNER_TEMP: directory,
      }),
    })
    if (result.error) throw result.error
    if (result.status === null) throw new Error(`GitHub action stopped: ${result.signal}`)
    const outputs = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const index = line.indexOf('=')
          return [line.slice(0, index), line.slice(index + 1)]
        }),
    )
    return { exitCode: result.status, ...outputs }
  } finally {
    fixture.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
}
