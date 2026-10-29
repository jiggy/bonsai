import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { measureSource } from '../src/source.ts'
import { readConfig } from '../src/project.ts'
import type { Decision, Snapshot } from '../src/model.ts'
import { executable, runCli } from './cli.ts'
import { createProject } from './project.ts'

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
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim()
}

test('the exact combined tree can exceed a protected ceiling even when each branch fits', {
  timeout: 60000,
}, () => {
  const project = createProject({
    'package.json': '{"type":"module"}\n',
    'left.ts': 'export function left() { return 1 }\n',
    'right.ts': 'export function right() { return 1 }\n',
    'handler.ts': `import { left } from './left.ts'
import { right } from './right.ts'
export function total() { return { amount: left() + right() } }
`,
    'bindings.ts': `import { total } from './handler.ts'
export const actions = { total: total }
`,
    'total.feature': `Feature: Combined admission
Scenario: Both maintained helpers contribute to the total
 When I invoke "total" with {}
 Then response "amount" equals 2
`,
  })
  const { root } = project
  try {
    // The harness selects its own checker, outside the candidate checkout. This
    // is a local admission regression, not an authenticated execution boundary.
    assert.ok(relative(root, executable).startsWith('..'))
    const protectedConfig = readConfig(root)
    const baseline = measureSource(root, project.files).files.reduce(
      (sum, file) => sum + file.tokens,
      0,
    )
    protectedConfig.policy.bootstrap = protectedConfig.policy.hardLimit = baseline + 750
    writeFileSync(join(root, 'bonsai.json'), JSON.stringify(protectedConfig))
    git(root, 'init', '-b', 'main')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'Reviewed policy and complete maintained scope')
    const base = git(root, 'rev-parse', 'HEAD')
    const retainedPayload = '\n// ' + 'retained '.repeat(500) + '\n'

    git(root, 'switch', '-c', 'left-change', base)
    appendFileSync(join(root, 'left.ts'), retainedPayload)
    // A candidate-controlled policy is deliberately more permissive. --base
    // must keep the reviewed ceiling for this branch and the combined tree.
    const relaxed = structuredClone(protectedConfig)
    relaxed.policy.bootstrap = relaxed.policy.hardLimit = 100000
    writeFileSync(join(root, 'bonsai.json'), JSON.stringify(relaxed))
    git(root, 'add', 'left.ts', 'bonsai.json')
    git(root, 'commit', '-m', 'Retain left implementation and relax local policy')
    const left = git(root, 'rev-parse', 'HEAD')

    git(root, 'switch', '-c', 'right-change', base)
    appendFileSync(join(root, 'right.ts'), retainedPayload)
    git(root, 'add', 'right.ts')
    git(root, 'commit', '-m', 'Retain right implementation')
    const right = git(root, 'rev-parse', 'HEAD')
    git(root, 'switch', '-c', 'combined-change', left)
    git(root, 'merge', '--no-ff', '--no-edit', right)
    const combined = git(root, 'rev-parse', 'HEAD')
    const combinedTree = git(root, 'rev-parse', 'HEAD^{tree}')
    assert.deepEqual(git(root, 'show', '-s', '--format=%P', 'HEAD').split(' '), [left, right])
    assert.ok(readFileSync(join(root, 'left.ts'), 'utf8').includes(retainedPayload))
    assert.ok(readFileSync(join(root, 'right.ts'), 'utf8').includes(retainedPayload))

    const check = (revision: string, trustedBase = true) => {
      git(root, 'switch', '--detach', revision)
      const before = git(root, 'rev-parse', 'HEAD^{tree}')
      const result = runCli(
        ['check', '--root', root, ...(trustedBase ? ['--base', base] : []), '--json'],
        { timeout: 30000 },
      )
      assert.equal(result.error, undefined, String(result.error))
      assert.equal(result.signal, null, result.stderr)
      const report = JSON.parse(result.stdout || result.stderr) as {
        decision: Decision
        snapshot: Snapshot
      }
      assert.ok(report.decision, result.stdout || result.stderr)
      assert.deepEqual(report.snapshot.source.problems, [])
      assert.deepEqual(report.snapshot.unrooted, [])
      assert.equal(report.snapshot.evidence?.complete, true)
      assert.equal(report.snapshot.evidence?.checks.length, 1)
      assert.equal(report.snapshot.evidence?.checks[0]?.status, 'passed')
      assert.equal(report.decision.surface, 1)
      if (trustedBase) assert.equal(report.decision.ceiling, protectedConfig.policy.hardLimit)
      assert.equal(git(root, 'rev-parse', 'HEAD'), revision)
      assert.equal(git(root, 'rev-parse', 'HEAD^{tree}'), before)
      return { ...report, exitCode: result.status, tree: before }
    }

    for (const revision of [left, right]) {
      const report = check(revision)
      assert.equal(report.exitCode, 0, JSON.stringify(report.decision))
      assert.equal(report.decision.status, 'pass')
      assert.equal(report.decision.requiredReduction, 0)
    }
    const merged = check(combined)
    assert.equal(merged.tree, combinedTree)
    assert.equal(merged.exitCode, 1, JSON.stringify(merged.decision))
    assert.equal(merged.decision.status, 'reject')
    assert.ok(merged.decision.requiredReduction > 0)
    assert.deepEqual(merged.decision.violations, [
      `Retained size exceeds ceiling by ${merged.decision.requiredReduction} tokens`,
    ])
    const candidateOnly = check(combined, false)
    assert.equal(candidateOnly.exitCode, 0, JSON.stringify(candidateOnly.decision))
    assert.equal(candidateOnly.decision.status, 'pass')
    assert.equal(candidateOnly.decision.ceiling, 100000)
    assert.equal(candidateOnly.decision.retained, merged.decision.retained)
  } finally {
    project.dispose()
  }
})
