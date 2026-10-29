import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Config } from '../src/model.ts'
import { runCli } from './cli.ts'

const behavior = `Feature: Resource response
Scenario: Read the greeting
 When I invoke "sample" with {}
 Then response "status" equals "hello"
`
const handler = `import { readFileSync, writeFileSync } from 'node:fs'
export function sample() {
 writeFileSync(new URL('./executed', import.meta.url), 'executed')
 return { status: readFileSync(new URL('./message.txt', import.meta.url), 'utf8') }
}
`

function fixture(code = handler, extra: Record<string, string> = {}) {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/resource-dependencies-'))
  const content = {
    'package.json': '{"type":"module"}',
    'handler.ts': code,
    'bindings.ts':
      "import { sample } from './handler.ts'\nexport const actions = { sample: sample }\n",
    'message.txt': 'hello',
    'sample.feature': behavior,
    ...extra,
  }
  for (const [file, text] of Object.entries(content)) writeFileSync(resolve(root, file), text)
  const config: Config = {
    maintained: [...Object.keys(content), 'bonsai.json'],
    bindings: 'bindings.ts',
    policy: {
      bootstrap: 10000,
      bootstrapSurface: 1,
      perDoubling: 0,
      hardLimit: 10000,
      maxFeedbackMs: 15000,
    },
  }
  const save = () => writeFileSync(resolve(root, 'bonsai.json'), JSON.stringify(config))
  save()
  return { root, config, save, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

test('a literal UTF-8 resource has a read-only explanation after actual native verification', () => {
  const project = fixture()
  try {
    const check = runCli(['check', '--root', project.root, '--json'])
    assert.equal(check.error, undefined)
    assert.equal(check.status, 0, check.stderr || check.stdout)
    const verified = JSON.parse(check.stdout)
    assert.equal(verified.decision.status, 'pass')
    assert.equal(verified.snapshot.evidence.complete, true)
    assert.deepEqual(
      verified.snapshot.evidence.checks.map((check: { status: string }) => check.status),
      ['passed'],
    )
    assert.equal(existsSync(resolve(project.root, 'executed')), true)
    rmSync(resolve(project.root, 'executed'))
    const explanation = runCli([
      'explain',
      'message.txt#<resource>',
      '--root',
      project.root,
      '--json',
    ])
    assert.equal(explanation.error, undefined)
    assert.equal(explanation.status, 0, explanation.stderr || explanation.stdout)
    const report = JSON.parse(explanation.stdout)
    assert.equal(report.components.length, 1)
    assert.equal(report.components[0].checks.length, 1)
    assert.equal(existsSync(resolve(project.root, 'executed')), false)
  } finally {
    project.dispose()
  }
})

test('a literal resource outside maintained scope blocks before executing the otherwise working handler', () => {
  const project = fixture()
  try {
    project.config.maintained = project.config.maintained.filter((file) => file !== 'message.txt')
    project.save()
    const result = runCli(['check', '--root', project.root, '--json'])
    assert.equal(result.error, undefined)
    assert.equal(result.status, 2, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.decision.status, 'incomplete')
    assert.ok(
      report.snapshot.source.problems.some(
        (problem: string) => /resource/i.test(problem) && problem.includes('message.txt'),
      ),
    )
    assert.equal(existsSync(resolve(project.root, 'executed')), false)
  } finally {
    project.dispose()
  }
})
