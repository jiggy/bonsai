import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig } from '../src/project.ts'
import { createProject } from './project.ts'
import { runCli } from './cli.ts'

function nodeProject(...args: Parameters<typeof createProject>) {
  const fixture = createProject(...args)
  // The changed-cwd probes need the consuming project's real Node type dependencies.
  symlinkSync(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(fixture.root, 'node_modules'),
    'dir',
  )
  return fixture
}

function project(outcome: 'pass' | 'reject' | 'incomplete' = 'pass') {
  return nodeProject(
    {
      'package.json': '{"type":"module"}\n',
      'app.ts': `import { appendFileSync } from 'node:fs'
export function ready() {
  appendFileSync(new URL('./handler-calls', import.meta.url), 'called\\n')
  return { status: 'ok' }
}
`,
      'bindings.ts': `import { ready } from './app.ts'
export const actions = { ${outcome === 'incomplete' ? 'uncontracted' : 'ready'}: ready }
`,
      'ready.feature':
        'Feature: Readiness\nScenario: Read the current status\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
    },
    outcome === 'reject' ? { bootstrap: 0, hardLimit: 0 } : {},
    'bonsai-html-cli-',
  )
}

function invoke(root: string, args: string[], cwd?: string) {
  const result = runCli(['check', '--root', root, ...args], { cwd, timeout: 30000 })
  assert.equal(result.error, undefined, String(result.error))
  assert.equal(result.signal, null, result.stderr)
  return result
}

function inspectHtml(path: string) {
  const html = readFileSync(path, 'utf8')
  assert.match(html, /^<!doctype html>/i)
  const data = /<script\b[^>]*\bid=["']bonsai-report-data["'][^>]*>([\s\S]*?)<\/script>/.exec(html)
  assert.ok(data, 'The standalone report embeds its own private data')
  assert.doesNotThrow(() => JSON.parse(data[1]))
}

test('default and explicit HTML preserve check JSON, every verdict, and one handler execution per check', () => {
  for (const [outcome, exitCode] of [
    ['pass', 0],
    ['reject', 1],
    ['incomplete', 2],
  ] as const) {
    const fixture = project(outcome)
    try {
      const baseline = invoke(fixture.root, ['--json'])
      assert.equal(baseline.status, exitCode, baseline.stderr || baseline.stdout)
      assert.equal(baseline.stderr, '')
      const original = JSON.parse(baseline.stdout)
      inspectHtml(join(fixture.root, '.bonsai', 'report.html'))
      const generated = invoke(fixture.root, ['--json', '--report', 'report.html'])
      assert.equal(generated.status, exitCode, generated.stderr || generated.stdout)
      assert.equal(generated.stderr, '')
      assert.equal(generated.stdout.trim().split('\n').length, 1)
      const report = JSON.parse(generated.stdout)
      assert.deepEqual(Object.keys(report).sort(), Object.keys(original).sort())
      assert.deepEqual(report.decision, original.decision)
      assert.equal(report.decision.status, outcome)
      assert.equal(report.snapshot.fingerprint, original.snapshot.fingerprint)
      assert.deepEqual(report.snapshot.source, original.snapshot.source)
      assert.deepEqual(report.snapshot.ancestry, original.snapshot.ancestry)
      assert.deepEqual(
        report.snapshot.evidence?.checks.map(({ id, status }: { id: string; status: string }) => ({
          id,
          status,
        })),
        original.snapshot.evidence?.checks.map(
          ({ id, status }: { id: string; status: string }) => ({
            id,
            status,
          }),
        ),
      )
      inspectHtml(join(fixture.root, 'report.html'))
      const marker = join(fixture.root, 'handler-calls')
      if (outcome === 'incomplete') assert.equal(existsSync(marker), false)
      else assert.equal(readFileSync(marker, 'utf8'), 'called\ncalled\n')
    } finally {
      fixture.dispose()
    }
  }
})

test('effective policy files stay protected through a selected root alias before execution', () => {
  const fixture = project()
  const alias = fixture.root + '-alias'
  try {
    const policy = join(fixture.root, 'trusted-policy.json')
    const original = readFileSync(join(fixture.root, 'bonsai.json'))
    writeFileSync(policy, original)
    symlinkSync(fixture.root, alias, 'dir')
    const result = invoke(alias, ['--json', '--policy', policy, '--report', 'trusted-policy.json'])
    assert.equal(result.status, 2, result.stderr || result.stdout)
    assert.equal(result.stdout, '')
    const error = JSON.parse(result.stderr)
    assert.equal(error.code, 'REPORT_PATH')
    assert.match(error.error, /effective policy file/)
    assert.deepEqual(readFileSync(policy), original)
    assert.equal(existsSync(join(fixture.root, 'handler-calls')), false)
  } finally {
    rmSync(alias, { force: true })
    fixture.dispose()
  }
})

test('delivery revalidates an effective policy alias changed after report preflight', () => {
  const fixture = nodeProject({
    'package.json': '{"type":"module"}\n',
    'app.ts': `import { appendFileSync, symlinkSync, unlinkSync } from 'node:fs'
export function ready() {
  appendFileSync(new URL('./handler-calls', import.meta.url), 'called\\n')
  unlinkSync(new URL('./trusted-policy.json', import.meta.url))
  symlinkSync('report.html', new URL('./trusted-policy.json', import.meta.url))
  return { status: 'ok' }
}
`,
    'bindings.ts': "import { ready } from './app.ts'\nexport const actions = { ready: ready }\n",
    'ready.feature':
      'Feature: Readiness\nScenario: Read the current status\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
  })
  try {
    const policy = join(fixture.root, 'trusted-policy.json')
    writeFileSync(policy, readFileSync(join(fixture.root, 'bonsai.json')))
    const previous = '<!doctype html><title>Previous complete report</title>'
    writeFileSync(join(fixture.root, 'report.html'), previous)
    const result = invoke(fixture.root, ['--json', '--policy', policy, '--report', 'report.html'])
    assert.equal(result.status, 1, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.decision.status, 'pass')
    assert.equal(report.snapshot.evidence.checks[0].status, 'passed')
    const error = JSON.parse(result.stderr)
    assert.equal(error.code, 'REPORT_WRITE')
    assert.match(error.error, /effective policy file/)
    assert.equal(readFileSync(join(fixture.root, 'report.html'), 'utf8'), previous)
    assert.equal(readFileSync(policy, 'utf8'), previous)
    assert.equal(readFileSync(join(fixture.root, 'handler-calls'), 'utf8'), 'called\n')
  } finally {
    fixture.dispose()
  }
})

test('default HTML follows the selected root while quiet leaves both streams empty', () => {
  const fixture = project()
  try {
    const caller = join(fixture.root, 'caller')
    mkdirSync(caller)
    const result = invoke(fixture.root, ['--quiet'], caller)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
    inspectHtml(join(fixture.root, '.bonsai', 'report.html'))
    assert.equal(existsSync(join(caller, '.bonsai', 'report.html')), false)
    assert.equal(readFileSync(join(fixture.root, 'handler-calls'), 'utf8'), 'called\n')
  } finally {
    fixture.dispose()
  }
})

test('no-report leaves a fresh project without an artifact and preserves an existing report', () => {
  const fixture = project()
  try {
    const destination = join(fixture.root, '.bonsai', 'report.html')
    const suppressed = invoke(fixture.root, ['--no-report', '--json'])
    assert.equal(suppressed.status, 0, suppressed.stderr || suppressed.stdout)
    assert.equal(suppressed.stderr, '')
    const original = JSON.parse(suppressed.stdout)
    assert.equal(existsSync(join(fixture.root, '.bonsai')), false)

    const generated = invoke(fixture.root, ['--json'])
    assert.equal(generated.status, 0, generated.stderr || generated.stdout)
    assert.equal(generated.stderr, '')
    const report = JSON.parse(generated.stdout)
    assert.deepEqual(report.decision, original.decision)
    assert.equal(report.snapshot.fingerprint, original.snapshot.fingerprint)
    assert.deepEqual(report.snapshot.contracts, original.snapshot.contracts)
    inspectHtml(destination)
    const bytes = readFileSync(destination)

    const existing = invoke(fixture.root, ['--no-report', '--quiet'])
    assert.equal(existing.status, 0, existing.stderr || existing.stdout)
    assert.equal(existing.stdout, '')
    assert.equal(existing.stderr, '')
    assert.deepEqual(readFileSync(destination), bytes)
    assert.equal(
      readFileSync(join(fixture.root, 'handler-calls'), 'utf8'),
      'called\ncalled\ncalled\n',
    )
  } finally {
    fixture.dispose()
  }
})

test('the default destination cannot silently escape effective maintained scope', () => {
  const fixture = project()
  try {
    const config = readConfig(fixture.root)
    config.maintained.push('.bonsai')
    writeFileSync(join(fixture.root, 'bonsai.json'), JSON.stringify(config))
    const result = invoke(fixture.root, ['--json'])
    assert.equal(result.status, 2, result.stderr || result.stdout)
    assert.equal(result.stdout, '')
    const error = JSON.parse(result.stderr)
    assert.equal(error.code, 'REPORT_PATH')
    assert.match(error.run, /--report PATH.*--no-report/)
    assert.equal(existsSync(join(fixture.root, 'handler-calls')), false)
    assert.equal(existsSync(join(fixture.root, '.bonsai')), false)
    assert.deepEqual(readConfig(fixture.root), config)
  } finally {
    fixture.dispose()
  }
})

test('quiet report paths resolve from the selected root and do not add stream output', () => {
  const fixture = project()
  try {
    const caller = join(fixture.root, 'caller')
    mkdirSync(caller)
    const result = invoke(fixture.root, ['--quiet', '--report', 'reports/check.html'], caller)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
    inspectHtml(join(fixture.root, 'reports/check.html'))
    assert.equal(existsSync(join(caller, 'reports/check.html')), false)
    assert.equal(readFileSync(join(fixture.root, 'handler-calls'), 'utf8'), 'called\n')
  } finally {
    fixture.dispose()
  }
})

test('saved exclusions permit an output directory without narrowing maintained source', () => {
  const fixture = project()
  try {
    mkdirSync(join(fixture.root, 'reports'))
    const config = readConfig(fixture.root)
    config.maintained.push('reports')
    config.exclude = ['reports/**']
    writeFileSync(join(fixture.root, 'bonsai.json'), JSON.stringify(config))
    const result = invoke(fixture.root, ['--json', '--report', 'reports/check.html'])
    assert.equal(result.status, 0, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert(report.snapshot.source.files.some(({ file }: { file: string }) => file === 'app.ts'))
    assert.equal(
      report.snapshot.source.files.some(({ file }: { file: string }) =>
        file.startsWith('reports/'),
      ),
      false,
    )
    inspectHtml(join(fixture.root, 'reports/check.html'))
    assert.deepEqual(readConfig(fixture.root), config)
  } finally {
    fixture.dispose()
  }
})

test('maintained inputs and symlink aliases are preserved before any handler can run', () => {
  for (const destination of ['app.ts', 'linked-report.html']) {
    const fixture = project()
    try {
      const source = join(fixture.root, 'app.ts')
      const original = readFileSync(source)
      if (destination === 'linked-report.html') symlinkSync(source, join(fixture.root, destination))
      const result = invoke(fixture.root, ['--json', '--report', destination])
      assert.equal(result.status, 2, result.stderr || result.stdout)
      assert.equal(result.stdout, '')
      assert.equal(JSON.parse(result.stderr).status, 'incomplete')
      assert.deepEqual(readFileSync(source), original)
      assert.equal(existsSync(join(fixture.root, 'handler-calls')), false)
      if (destination === 'linked-report.html')
        assert.equal(lstatSync(join(fixture.root, destination)).isSymbolicLink(), true)
    } finally {
      fixture.dispose()
    }
  }
})

test('a late artifact failure preserves the actual gate decision and cannot make a passing command succeed', () => {
  for (const [outcome, exitCode] of [
    ['pass', 1],
    ['reject', 1],
    ['incomplete', 2],
  ] as const) {
    const fixture = nodeProject(
      {
        'package.json': '{"type":"module"}\n',
        'app.ts': `import { appendFileSync, mkdirSync } from 'node:fs'
export function ready() {
  appendFileSync(new URL('./handler-calls', import.meta.url), 'called\\n')
  mkdirSync(new URL('./report.html', import.meta.url))
  return { status: 'ok' }
}
`,
        'bindings.ts':
          "import { ready } from './app.ts'\nexport const actions = { ready: ready }\n",
        'ready.feature':
          'Feature: Readiness\nScenario: Read the current status\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n' +
          (outcome === 'incomplete'
            ? 'Scenario: A required action is not connected\n When I invoke "unbound" with {}\n Then response "status" equals "ok"\n'
            : ''),
      },
      outcome === 'reject' ? { bootstrap: 0, hardLimit: 0 } : {},
      'bonsai-html-write-failure-',
    )
    try {
      const result = invoke(fixture.root, ['--json', '--serial', '--report', 'report.html'])
      assert.equal(result.status, exitCode, result.stderr || result.stdout)
      const report = JSON.parse(result.stdout)
      assert.equal(report.decision.status, outcome)
      assert.equal(report.snapshot.evidence.checks[0].status, 'passed')
      const error = JSON.parse(result.stderr)
      assert.equal(error.code, 'REPORT_WRITE')
      assert.match(error.error, /report\.html/)
      assert.equal(lstatSync(join(fixture.root, 'report.html')).isDirectory(), true)
      assert.equal(readFileSync(join(fixture.root, 'handler-calls'), 'utf8'), 'called\n')
    } finally {
      fixture.dispose()
    }
  }
})
