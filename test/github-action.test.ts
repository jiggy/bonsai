import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProject } from './project.ts'

const entry = fileURLToPath(new URL('../.github/action/run.ts', import.meta.url))
const handler = 'export function handle() { return { status: "ok" } }\n'
const sources = {
  'package.json': '{"type":"module"}\n',
  'handler.ts': handler,
  'bindings.ts':
    'import { handle } from "./handler.ts"\nexport const actions = { "handle": handle }\n',
  'app.feature':
    'Feature: Read status\nScenario: Read status\n When I invoke "handle" with {}\n Then response "status" equals "ok"\n',
}
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
      'user.name=Bonsai Test',
      '-c',
      'user.email=test@example.invalid',
      ...args,
    ],
    { encoding: 'utf8' },
  ).trim()
}
function fixture() {
  const project = createProject(sources)
  git(project.root, 'init', '-b', 'main')
  return project
}
function commit(root: string) {
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'Reviewed policy')
  return git(root, 'rev-parse', 'HEAD')
}
function invoke(root: string, base: string, overrides: NodeJS.ProcessEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'bonsai-action-test-'))
  try {
    const output = join(directory, 'outputs')
    const summary = join(directory, 'summary')
    writeFileSync(output, '')
    writeFileSync(summary, '')
    const result = spawnSync(process.execPath, [entry], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        BONSAI_ACTION_ROOT: root,
        BONSAI_ACTION_BASE: base,
        BONSAI_ACTION_SERIAL: 'false',
        BONSAI_ROOT: undefined,
        BONSAI_BASE: undefined,
        BONSAI_POLICY: undefined,
        GITHUB_WORKSPACE: root,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        RUNNER_TEMP: directory,
        ...overrides,
      },
    })
    assert.equal(result.error, undefined, String(result.error))
    assert.equal(result.signal, null, result.stderr)
    const outputs = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const index = line.indexOf('=')
          return [line.slice(0, index), line.slice(index + 1)]
        }),
    )
    const text = readFileSync(summary, 'utf8')
    const report = outputs['report-path']
      ? JSON.parse(readFileSync(outputs['report-path'], 'utf8'))
      : undefined
    return { ...result, outputs, text, report }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('the action accepts a complete consumer check and publishes its actual measurements', () => {
  const project = fixture()
  try {
    const result = invoke(project.root, commit(project.root))
    assert.equal(result.status, 0, result.text)
    assert.equal(result.outputs.status, 'pass')
    assert.equal(result.outputs['exit-code'], '0')
    assert.equal(result.outputs['retained-tokens'], String(result.report.decision.retained))
    assert.equal(result.outputs.allowance, String(result.report.decision.ceiling))
    assert.equal(result.outputs['required-reduction'], '0')
    assert.match(result.text, /Bonsai · Passed/)
    assert.match(result.text, /Reviewed policy and inventory/)
    assert.equal(result.report.snapshot.evidence.complete, true)
  } finally {
    project.dispose()
  }
})

test('added retained code crossing the allowance fails even when the candidate raises its own limit', () => {
  const project = fixture()
  try {
    const configPath = join(project.root, 'bonsai.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.policy.bootstrap = config.policy.hardLimit = 1000
    writeFileSync(configPath, JSON.stringify(config))
    const base = commit(project.root)
    const control = invoke(project.root, base)
    assert.equal(control.status, 0, control.text)
    assert.ok(control.report.decision.retained < 1000)
    writeFileSync(
      join(project.root, 'handler.ts'),
      'export function handle() { return { status: "ok", detail: [' + '0,'.repeat(1200) + '] } }\n',
    )
    config.policy.bootstrap = config.policy.hardLimit = 100000
    config.maintained = ['bindings.ts']
    writeFileSync(configPath, JSON.stringify(config))
    const result = invoke(project.root, base, {
      BONSAI_POLICY: configPath,
    })
    assert.equal(result.status, 1, result.text)
    assert.equal(result.outputs.status, 'reject')
    assert.equal(result.outputs.allowance, '1000')
    assert.ok(Number(result.outputs['required-reduction']) > 0)
    assert.ok(result.report.decision.retained > control.report.decision.retained)
    assert.match(result.text, /Bonsai · Rejected/)
    assert.match(result.stdout, /::error title=Bonsai check::/)
  } finally {
    project.dispose()
  }
})

test('a reduction that still exceeds the ceiling remains rejected', () => {
  const project = fixture()
  try {
    const configPath = join(project.root, 'bonsai.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.policy.bootstrap = config.policy.hardLimit = 1
    writeFileSync(configPath, JSON.stringify(config))
    writeFileSync(
      join(project.root, 'handler.ts'),
      'export function handle() { return { status: "ok", detail: [' + '0,'.repeat(50) + '] } }\n',
    )
    const base = commit(project.root)
    const before = invoke(project.root, base)
    writeFileSync(join(project.root, 'handler.ts'), handler)
    const result = invoke(project.root, base)
    assert.equal(result.status, 1, result.text)
    assert.equal(result.outputs.status, 'reject')
    assert.ok(result.report.decision.retained < before.report.decision.retained)
    assert.ok(Number(result.outputs['required-reduction']) > 0)
  } finally {
    project.dispose()
  }
})

test('spare allowance cannot conceal failed required behavior or missing analysis', () => {
  for (const [candidate, exitCode, status] of [
    ['export function handle() { return { status: "broken" } }', 1, 'reject'],
    ['export function handle() { return missingValue }', 2, 'incomplete'],
  ] as const) {
    const project = fixture()
    try {
      const base = commit(project.root)
      writeFileSync(join(project.root, 'handler.ts'), candidate)
      const result = invoke(project.root, base)
      assert.equal(result.status, exitCode, result.text)
      assert.equal(result.outputs.status, status)
      assert.equal(result.outputs['required-reduction'], '0')
      if (status === 'incomplete') assert.match(result.text, /provisional/)
    } finally {
      project.dispose()
    }
  }
})

test('missing base history fails without claiming a passing budget', () => {
  const project = fixture()
  try {
    commit(project.root)
    const result = invoke(project.root, 'not-a-fetched-base')
    assert.equal(result.status, 1, result.text)
    assert.equal(result.outputs.status, 'error')
    assert.equal(result.outputs['retained-tokens'], undefined)
    assert.match(result.text, /No passing verdict/)
  } finally {
    project.dispose()
  }
})

test('the action requires a base on events that do not provide one', () => {
  const project = fixture()
  try {
    const result = invoke(project.root, '')
    assert.equal(result.status, 1)
    assert.equal(result.outputs.status, 'error')
    assert.match(result.text, /Set base to a reviewed commit/)
  } finally {
    project.dispose()
  }
})

test('the action supports explicitly ordered scenarios', () => {
  const project = fixture()
  try {
    const result = invoke(project.root, commit(project.root), { BONSAI_ACTION_SERIAL: 'true' })
    assert.equal(result.status, 0, result.text)
    assert.equal(result.report.snapshot.verification.profile, 'in-process-v1')
  } finally {
    project.dispose()
  }
})

test('malformed, missing, and contradictory checker reports cannot pass the action', () => {
  const project = fixture()
  const copy = mkdtempSync(join(tmpdir(), 'bonsai-action-reports-'))
  try {
    const base = commit(project.root)
    const control = invoke(project.root, base)
    assert.equal(control.status, 0, control.text)
    cpSync(new URL('../src/', import.meta.url), join(copy, 'src'), { recursive: true })
    cpSync(new URL('../package.json', import.meta.url), join(copy, 'package.json'))
    symlinkSync(
      fileURLToPath(new URL('../node_modules', import.meta.url)),
      join(copy, 'node_modules'),
      'dir',
    )
    mkdirSync(join(copy, '.github/action'), { recursive: true })
    const copiedEntry = join(copy, '.github/action/run.ts')
    writeFileSync(copiedEntry, readFileSync(entry, 'utf8'))
    for (const [payload, exit] of [
      ['not JSON', 0],
      [JSON.stringify({ decision: control.report.decision }), 0],
      [
        JSON.stringify({
          ...control.report,
          decision: { ...control.report.decision, status: 'reject' },
        }),
        0,
      ],
      [
        JSON.stringify({
          ...control.report,
          snapshot: { ...control.report.snapshot, evidence: undefined },
        }),
        0,
      ],
      [
        JSON.stringify({
          ...control.report,
          snapshot: {
            ...control.report.snapshot,
            evidence: { ...control.report.snapshot.evidence, fingerprint: 'different' },
          },
        }),
        0,
      ],
    ] as const) {
      writeFileSync(
        join(copy, 'src/cli.ts'),
        `
        import { spawnSync } from 'node:child_process'
        if (process.argv.includes('config')) {
          const result = spawnSync(process.execPath, [${JSON.stringify(fileURLToPath(new URL('../src/cli.ts', import.meta.url)))}, ...process.argv.slice(2)], { stdio: 'inherit' })
          process.exit(result.status ?? 1)
        }
        process.stdout.write(${JSON.stringify(payload)})
        process.exit(${exit})
      `,
      )
      const output = join(copy, 'outputs')
      const summary = join(copy, 'summary')
      writeFileSync(output, '')
      writeFileSync(summary, '')
      const result = spawnSync(process.execPath, [copiedEntry], {
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          BONSAI_ACTION_ROOT: project.root,
          BONSAI_ACTION_BASE: base,
          BONSAI_ACTION_SERIAL: 'false',
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
          RUNNER_TEMP: copy,
        },
      })
      assert.equal(result.error, undefined, String(result.error))
      assert.equal(result.status, 1, result.stderr)
      assert.equal(result.signal, null, result.stderr)
      const outputs = readFileSync(output, 'utf8')
      assert.match(outputs, /status=error/, result.stderr)
      assert.doesNotMatch(outputs, /status=pass/)
      assert.match(readFileSync(summary, 'utf8'), /No passing verdict/)
    }
  } finally {
    project.dispose()
    rmSync(copy, { recursive: true, force: true })
  }
})
