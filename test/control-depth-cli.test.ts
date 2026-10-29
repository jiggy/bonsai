import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { checkControlDepth } from '../features/support/control-depth.ts'
import { createProject } from './project.ts'
import { runCli } from './cli.ts'

test('real native checks distinguish excessive nesting from passing behavior, size, and ancestry', () => {
  for (const layout of ['nested', 'flat'] as const) {
    const report = checkControlDepth({ layout })
    assert.equal(report.exitCode, layout === 'nested' ? 1 : 0)
    assert.equal(report.decision.status, layout === 'nested' ? 'reject' : 'pass')
    assert.deepEqual(report.snapshot.source.problems, [])
    assert.deepEqual(report.snapshot.unrooted, [])
    assert.equal(report.snapshot.evidence.complete, true)
    assert.equal(report.snapshot.evidence.checks.length, 2)
    assert.ok(report.snapshot.evidence.checks.every((check: { status: string }) => check.status === 'passed'))
    assert.ok(report.decision.retained < report.decision.ceiling)
    assert.equal(report.snapshot.source.controlDepth.complete, true)
    const region = report.snapshot.source.controlDepth.regions.find((entry: { name: string }) => entry.name === 'approve')
    assert.equal(region.depth, layout === 'nested' ? 5 : 1)
    assert.equal(report.decision.violations.length, layout === 'nested' ? 1 : 0)
    if (layout === 'nested')
      assert.match(report.decision.violations[0], /Control-flow depth 5 exceeds 4 at approval.ts:/)
  }
})

test('trusted base structural policy cannot be relaxed by the candidate configuration', () => {
  const fixture = createProject({
    'app.ts': 'export function ready() { if (true) { if (true) { return { status: "ok" } } } return { status: "ok" } }',
    'bindings.ts': "import { ready } from './app.ts'\nexport const actions = { ready: ready }\n",
    'ready.feature': 'Feature: Ready\nScenario: Readiness\n When I invoke "ready" with {}\n Then response "status" equals "ok"\n',
  }, { structural: { metric: 'control-depth-v1', maxDepth: 1 } })
  try {
    execFileSync('git', ['init', '-b', 'main', fixture.root], { stdio: 'ignore' })
    execFileSync('git', ['-C', fixture.root, 'add', '.'])
    execFileSync('git', ['-C', fixture.root, '-c', 'user.name=Bonsai Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Reviewed policy'], { stdio: 'ignore' })
    writeFileSync(join(fixture.root, 'bonsai.json'), JSON.stringify({
      maintained: fixture.files, bindings: 'bindings.ts',
      policy: { bootstrap: 10000, bootstrapSurface: 1, perDoubling: 0, hardLimit: 10000, maxFeedbackMs: 15000, structural: { metric: 'control-depth-v1', maxDepth: 100 } },
    }))
    const protectedCheck = runCli(['check', '--root', fixture.root, '--base', 'HEAD', '--json'])
    assert.equal(protectedCheck.status, 1, protectedCheck.stderr)
    const rejected = JSON.parse(protectedCheck.stdout)
    assert.equal(rejected.decision.status, 'reject')
    assert.equal(rejected.decision.violations.length, 1)
    assert.match(rejected.decision.violations[0], /Control-flow depth 2 exceeds 1/)
    assert.ok(rejected.snapshot.evidence.checks.every((check: { status: string }) => check.status === 'passed'))
    const standalone = runCli(['check', '--root', fixture.root, '--json'])
    assert.equal(standalone.status, 0, standalone.stderr)
  } finally {
    fixture.dispose()
  }
})
