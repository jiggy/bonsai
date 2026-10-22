import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

function fixture(dynamic: boolean) {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/incomplete-'))
  const marker = join(root, 'handler-ran')
  writeFileSync(
    join(root, 'handler.ts'),
    [
      "import { writeFileSync } from 'node:fs'",
      'export async function handler() {',
      `  writeFileSync(${JSON.stringify(marker)}, 'executed')`,
      ...(dynamic
        ? [
            "  const modulePath = './helper.ts'",
            '  const helper = await import(modulePath)',
            '  return { status: helper.status }',
          ]
        : ["  return { status: 'ok' }"]),
      '}',
    ].join('\n'),
  )
  writeFileSync(join(root, 'helper.ts'), "export const status = 'ok'\nexport const unused = true\n")
  writeFileSync(
    join(root, 'bindings.ts'),
    dynamic
      ? "import { handler } from './handler.ts'\nexport const actions = { 'sample': handler }\n"
      : 'export const actions = {}\n',
  )
  writeFileSync(
    join(root, 'check.feature'),
    'Feature: Sample\nScenario: Check handler\n When I invoke "sample" with {}\n Then response "status" equals "ok"\n',
  )
  writeFileSync(
    join(root, 'bonsai.json'),
    JSON.stringify({
      maintained: ['handler.ts', 'helper.ts', 'bindings.ts', 'check.feature', 'bonsai.json'],
      bindings: 'bindings.ts',
      policy: {
        bootstrap: 1,
        bootstrapSurface: 1,
        perDoubling: 0,
        hardLimit: 1,
        maxFeedbackMs: 15000,
      },
    }),
  )
  return { root, marker, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function run(root: string, output: string, verbose = false) {
  return spawnSync(
    process.execPath,
    ['src/cli.ts', 'check', '--root', root, '--output', output, ...(verbose ? ['--verbose'] : [])],
    {
      encoding: 'utf8',
      timeout: 20000,
      env: {
        ...process.env,
        BONSAI_ROOT: undefined,
        BONSAI_BASE: undefined,
        BONSAI_POLICY: undefined,
        NO_COLOR: '1',
        TERM: 'dumb',
        COLUMNS: '120',
      },
    },
  )
}

test('an empty registry leads with one actionable blocker instead of pruning consequences', () => {
  const { root, marker, dispose } = fixture(false)
  try {
    const result = run(root, 'human')
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stderr, '')
    assert.equal(existsSync(marker), false)
    const verbose = run(root, 'human', true)
    assert.equal(verbose.status, 2, verbose.stderr)
    assert.match(verbose.stdout, /Additional findings \(provisional\)/)
    assert.match(verbose.stdout, /No contract ancestry/)
    assert.match(
      result.stdout,
      /^! Incomplete\n\nBlocking issues\n- 1 action has no executable binding/,
    )
    assert.match(result.stdout, /"sample" required by check.feature:4/)
    assert.match(result.stdout, /Fix: Export each action from bindings.ts/)
    assert.match(result.stdout, /Required checks: 1 failed \(1 expected\)/)
    assert.match(result.stdout, /Inventory measurements/)
    assert.match(result.stdout, /Potential overage: \d+ tokens \(provisional\)/)
    assert.doesNotMatch(result.stdout, /No contract ancestry|Required reduction|Failed check:/)
    assert.ok(result.stdout.includes(`Next -> bonsai check --root ${root}`))
  } finally {
    dispose()
  }
})

test('unsupported analysis reports checks not run while keeping JSON and plain facts complete', () => {
  const { root, marker, dispose } = fixture(true)
  try {
    const human = run(root, 'human')
    assert.equal(human.status, 2, human.stderr)
    assert.match(human.stdout, /^! Incomplete\n\nBlocking issues\n- Can't trace 1 runtime import/)
    assert.match(human.stdout, /handler.ts#handler at handler.ts:5:\d+.*import\(modulePath\)/)
    assert.match(human.stdout, /Fix: Use a static import for a fixed target/)
    assert.match(human.stdout, /which source components these imports retain/)
    assert.match(human.stdout, /Required checks: not run \(1 expected\)/)
    assert.doesNotMatch(
      human.stdout,
      /0 \/ 1 passed|No contract ancestry|Required reduction|Required evidence is missing/,
    )
    assert.ok(
      human.stdout.indexOf('Blocking issues') < human.stdout.indexOf('Inventory measurements'),
    )
    assert.ok(human.stdout.includes(`Next -> bonsai check --root ${root}`))
    const json = run(root, 'json')
    assert.equal(json.status, 2, json.stderr)
    assert.equal(json.stderr, '')
    const report = JSON.parse(json.stdout)
    assert.equal(report.decision.status, 'incomplete')
    assert.ok(
      report.decision.violations.some((message: string) =>
        message.startsWith('No contract ancestry:'),
      ),
    )
    assert.ok(
      report.decision.violations.some((message: string) =>
        message.startsWith('Retained size exceeds ceiling'),
      ),
    )
    assert.ok(
      report.decision.violations.includes(
        'Required evidence is missing, incomplete, or belongs to another candidate',
      ),
    )
    assert.equal(report.snapshot.evidence, undefined)
    const plain = run(root, 'plain')
    assert.equal(plain.status, 2, plain.stderr)
    assert.equal(
      plain.stdout,
      [
        'incomplete',
        report.decision.retained,
        report.decision.ceiling,
        report.decision.requiredReduction,
        report.decision.surface,
        0,
        report.snapshot.contracts.checks.length,
        report.snapshot.unrooted.length,
      ].join('\t') + '\n',
    )
    assert.equal(existsSync(marker), false)
  } finally {
    dispose()
  }
})

test('an interrupted verification reports missing completion rather than claiming checks were skipped', () => {
  const { root, marker, dispose } = fixture(false)
  try {
    writeFileSync(
      join(root, 'bindings.ts'),
      "import { handler } from './handler.ts'\nexport const actions = { 'sample': handler }\n",
    )
    const path = join(root, 'bonsai.json')
    const config = JSON.parse(readFileSync(path, 'utf8'))
    config.policy.maxFeedbackMs = 0.000001
    writeFileSync(path, JSON.stringify(config))
    const result = run(root, 'human')
    assert.equal(result.status, 2, result.stderr)
    assert.match(result.stdout, /Evidence collection interrupted/)
    assert.match(result.stdout, /Required checks: not completed \(1 expected\)/)
    assert.equal(existsSync(marker), false)
  } finally {
    dispose()
  }
})

test('a commented initialization starter explains both the missing scenarios and the empty registry', () => {
  const { root, marker, dispose } = fixture(false)
  try {
    writeFileSync(
      join(root, 'check.feature'),
      '# Feature: Sample\n# Scenario: Replace this starter\n# When I invoke "sample" with {}\n# Then response "status" equals "ok"\n',
    )
    const result = run(root, 'human')
    assert.equal(result.status, 2, result.stderr)
    assert.match(result.stdout, /No executable scenarios in 1 .feature file/)
    assert.match(result.stdout, /check.feature/)
    assert.match(result.stdout, /Commented starter scenarios don't run/)
    assert.match(result.stdout, /No action handlers are registered in bindings.ts/)
    assert.match(
      result.stdout,
      /Fix: Add an uncommented Scenario with When I invoke and Then response steps/,
    )
    assert.match(result.stdout, /bind its action in bindings.ts/)
    assert.match(result.stdout, /Required checks: not run \(0 expected\)/)
    assert.doesNotMatch(result.stdout, /Next -> bonsai config show/)
    assert.equal(existsSync(marker), false)
  } finally {
    dispose()
  }
})

test('missing .feature inventory and repeated runtime imports each get one concrete explanation', () => {
  const { root, marker, dispose } = fixture(true)
  try {
    const path = join(root, 'bonsai.json')
    const config = JSON.parse(readFileSync(path, 'utf8'))
    config.maintained = config.maintained.filter((file: string) => !file.endsWith('.feature'))
    writeFileSync(path, JSON.stringify(config))
    writeFileSync(
      join(root, 'handler.ts'),
      readFileSync(join(root, 'handler.ts'), 'utf8') +
        '\nexport async function secondHandler(path: string) { return import(path) }\n',
    )
    const result = run(root, 'human')
    assert.equal(result.status, 2, result.stderr)
    assert.match(result.stdout, /No .feature files in the maintained inventory/)
    assert.match(result.stdout, /Fix: Add a .feature file under a maintained path/)
    assert.match(result.stdout, /Can't trace 2 runtime imports/)
    assert.match(result.stdout, /handler.ts#handler at handler.ts:5:/)
    assert.match(result.stdout, /handler.ts#secondHandler at handler.ts:8:/)
    assert.equal(result.stdout.match(/Fix: Use a static import for a fixed target/g)?.length, 1)
    assert.equal(existsSync(marker), false)
  } finally {
    dispose()
  }
})
