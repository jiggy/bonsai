import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { invoke } from './cli.ts'
import { project, write } from './project.ts'

type AccountingInput = {
  case: 'ceiling' | 'duplicate-contracts' | 'selectors' | 'background' | 'compaction'
  surface?: number
  layout?: 'duplicate' | 'split'
  revision?: 'base' | 'pruned'
}

const handler = `import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const calls = fileURLToPath(new URL('./calls.log', import.meta.url))
export function sample(input: { value: number }) {
  appendFileSync(calls, JSON.stringify({ ...input, pid: process.pid }) + '\\n')
  return { status: input.value > 0 ? 'accepted' : 'rejected', items: [{ price: 10 }, { price: 20 }], v0: 0, v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7 }
}
`
const bindings =
  "import { sample } from './handler.ts'\nexport const actions = { 'sample': sample }\n"
const policy = { bootstrap: 1000, bootstrapSurface: 2, perDoubling: 500, hardLimit: 1800 }

function scenario(value: number, expected = value > 0 ? 'accepted' : 'rejected') {
  return `  Scenario: Observe value ${value}
    When I invoke "sample" with {"value": ${value}}
    Then response "status" equals "${expected}"
`
}

function observations(root: string) {
  const log = join(root, 'calls.log')
  const inputs = existsSync(log)
    ? readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { value: number; pid: number })
    : []
  return {
    invocationCount: inputs.length,
    inputValues: inputs.map((input) => input.value).sort((a, b) => a - b),
  }
}

export function accountingProject(input: AccountingInput) {
  let text = 'Feature: Observe the application\n' + scenario(1)
  let registry = bindings
  const sources: Record<string, string> = { 'handler.ts': handler, 'bindings.ts': registry }
  if (input.case === 'ceiling') {
    text =
      'Feature: Observable fields\n  Scenario: Observe independent fields\n    When I invoke "sample" with {"value": 1}\n' +
      Array.from(
        { length: input.surface! },
        (_, index) => `    Then response "v${index}" equals ${index}\n`,
      ).join('')
  } else if (input.case === 'duplicate-contracts') {
    if (input.layout === 'duplicate') {
      sources['second.feature'] = 'Feature: Repeated observations\n' + scenario(1) + scenario(0)
      text = sources['second.feature']
    } else {
      text = 'Feature: Positive observations\n' + scenario(1) + scenario(1)
      sources['second.feature'] = 'Feature: Negative observations\n' + scenario(0) + scenario(0)
    }
  } else if (input.case === 'selectors') {
    sources['handler.ts'] += `export function other(input: { value: number }) {
  appendFileSync(calls, JSON.stringify(input) + '\\n')
  return { items: [{ price: 30 }] }
}
`
    registry =
      "import { sample, other } from './handler.ts'\nexport const actions = { 'sample': sample, 'other': other }\n"
    sources['bindings.ts'] = registry
    text = `Feature: Collections retain every observation
  Scenario: Observe collection positions and different actions
    When I invoke "sample" with {"value": 1}
    Then response "items[0].price" equals 10
    And response "items[1].price" equals 20
    When I invoke "other" with {"value": 0}
    Then response "items[0].price" equals 30
`
  } else if (input.case === 'background') {
    text = `Feature: Background obligations
  Background: Establish each scenario's prerequisite
    When I invoke "sample" with {"value": 1}
    Then response "status" equals "accepted"
  Scenario: Reject a nonpositive value
    When I invoke "sample" with {"value": 0}
    Then response "status" equals "rejected"
  Scenario: Accept a positive value
    When I invoke "sample" with {"value": 2}
    Then response "status" equals "accepted"
`
  }
  sources['observations.feature'] = text
  return project(sources, policy)
}

export function checkAccounting(input: AccountingInput) {
  if (input.case === 'compaction') return compactRetainedSource(input.revision ?? 'pruned')
  const fixture = accountingProject(input)
  try {
    const report = invoke(['check', '--serial', '--root', fixture.root])
    return {
      ...report,
      ...observations(fixture.root),
    }
  } finally {
    fixture.dispose()
  }
}

export function compactionProject() {
  const compact = `import { value } from './shared.ts'
export function first() { return value() }
export function second() { return value() }
`
  const wrapped =
    compact.replaceAll('return value()', 'return wrapper()') +
    'function wrapper() { return value() }\nexport function abandoned() { return 99 }\n'
  const fixture = project(
    {
      'shared.ts': 'export function value() { return { value: 7 } }\n',
      'handlers.ts': wrapped,
      'bindings.ts':
        "import { first, second } from './handlers.ts'\nexport const actions = { 'first': first, 'second': second }\n",
      'retention.feature': `Feature: Shared application dependencies
  Scenario: First operation
    When I invoke "first" with {}
    Then response "value" equals 7
  Scenario: Second operation
    When I invoke "second" with {}
    Then response "value" equals 7
`,
    },
    { bootstrap: 213, hardLimit: 213 },
  )
  return { ...fixture, compact }
}

function compactRetainedSource(revision: 'base' | 'pruned') {
  const fixture = compactionProject()
  try {
    if (revision === 'base') return invoke(['check', '--serial', '--root', fixture.root])
    for (const args of [
      ['init', '-b', 'main', fixture.root],
      ['-C', fixture.root, 'add', '.'],
      [
        '-C',
        fixture.root,
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgSign=false',
        '-c',
        'user.name=Bonsai Specification',
        '-c',
        'user.email=specification@example.invalid',
        'commit',
        '-m',
        'Retain the existing behavior and allowance',
      ],
    ])
      execFileSync('git', args, { stdio: 'ignore' })
    write(fixture.root, 'handlers.ts', fixture.compact)
    return invoke(['check', '--serial', '--root', fixture.root, '--base', 'HEAD'])
  } finally {
    fixture.dispose()
  }
}
