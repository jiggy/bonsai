import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { invoke } from './cli.ts'
import { project, write } from './project.ts'

type Input = {
  case:
    | 'test-only'
    | 'mixed-test'
    | 'shared-helper'
    | 'uncontracted-registration'
    | 'missing-inventory'
    | 'trusted-budget'
    | 'trusted-scope'
    | 'explicit-policy'
    | 'literal-import'
    | 'unsupported-language'
    | 'type-error'
    | 'computed-registration'
    | 'spread-registration'
    | 'inline-registration'
    | 'json-dependency'
    | 'default-library-directive'
}

const behavior = `Feature: A supported operation
Scenario: Observe its result
 When I invoke "live" with {}
 Then response "status" equals "ok"
`

function observedHandler(body: string, asynchronous = false) {
  return `import { writeFileSync } from 'node:fs'
export ${asynchronous ? 'async ' : ''}function live() {
 writeFileSync(new URL('./handler-ran', import.meta.url), 'executed')
 ${body}
}
`
}

function history(root: string) {
  for (const args of [
    ['init', '-b', 'main', root],
    ['-C', root, 'add', '.'],
    [
      '-C',
      root,
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
      'Reviewed base policy',
    ],
  ])
    execFileSync('git', args, { stdio: 'ignore' })
}

function policyComparison(kind: Input['case'], operation: 'check' | 'config-show') {
  const fixture = project(
    {
      'src/app.ts': `import { writeFileSync } from 'node:fs'
export function live() {
 writeFileSync(new URL('../handler-ran', import.meta.url), 'executed')
 return { status: 'ok' }
}
`,
      'bindings.ts':
        "import { live } from './src/app.ts'\nexport const actions = { 'live': live }\n",
      'orders.feature': behavior,
      '.gitignore': '*.generated.ts\n',
    },
    {
      bootstrap: kind === 'trusted-scope' ? 10000 : 400,
      hardLimit: kind === 'trusted-scope' ? 10000 : 400,
    },
    {
      maintained: [
        'src',
        'bindings.ts',
        'orders.feature',
        'bonsai.json',
        '.gitignore',
        'package.json',
      ],
      exclude: ['*.generated.ts'],
    },
  )
  try {
    history(fixture.root)
    const candidate = structuredClone(fixture.config)
    if (kind === 'trusted-scope') {
      write(fixture.root, 'src/dead.ts', 'export function dead() { return true }\n')
      write(fixture.root, 'src/nested/bonsai.json', '{}\n')
      write(fixture.root, 'src/nested/hidden.ts', 'export function hidden() { return true }\n')
      write(fixture.root, '.gitignore', 'src/dead.ts\nsrc/nested/\n')
      candidate.maintained = [
        'src/app.ts',
        'bindings.ts',
        'orders.feature',
        'bonsai.json',
        '.gitignore',
        'package.json',
      ]
      candidate.exclude = ['*.generated.ts', 'src/dead.ts', 'src/nested/']
    } else {
      candidate.policy.bootstrap = 100000
      candidate.policy.hardLimit = 100000
      write(
        fixture.root,
        'src/app.ts',
        readFileSync(join(fixture.root, 'src/app.ts'), 'utf8') + '\n// ' + 'retained '.repeat(500),
      )
    }
    write(fixture.root, 'bonsai.json', JSON.stringify(candidate))
    const options = ['--root', fixture.root, '--base', 'HEAD']
    if (kind === 'explicit-policy') options.push('--policy', join(fixture.root, 'bonsai.json'))
    const command = operation === 'check' ? ['check'] : ['config', 'show']
    const report = invoke([...command, ...options])
    return {
      ...report,
      handlerExecuted: existsSync(join(fixture.root, 'handler-ran')),
    }
  } finally {
    fixture.dispose()
  }
}

export function inspectAncestryConfiguration(input: Input) {
  if (!['trusted-budget', 'trusted-scope', 'explicit-policy'].includes(input.case))
    throw new Error(`Unknown ancestry inspection fixture: ${input.case}`)
  return policyComparison(input.case, 'config-show')
}

export function checkAncestry(input: Input) {
  if (['trusted-budget', 'trusted-scope', 'explicit-policy'].includes(input.case))
    return policyComparison(input.case, 'check')
  const sources: Record<string, string> = {
    'app.ts': "export function live() { return { status: 'ok' } }\n",
    'bindings.ts': "import { live } from './app.ts'\nexport const actions = { 'live': live }\n",
    'orders.feature': behavior,
    'dead.ts': 'export function dead() { return true }\n',
  }
  if (input.case === 'test-only') {
    sources['unit.test.ts'] = `import { test } from 'node:test'
import { dead } from './dead.ts'
test('an uncontracted subject', () => { dead() })
`
  } else if (input.case === 'mixed-test') {
    sources['unit.test.ts'] = `import { test } from 'node:test'
import { live } from './app.ts'
import { dead } from './dead.ts'
test('a contracted and an uncontracted subject', () => { live(); dead() })
`
  } else if (input.case === 'shared-helper') {
    sources['helpers.test.ts'] = `import { live } from './app.ts'
import { dead } from './dead.ts'
export function common() { return true }
export function liveSupport() { return live().status === 'ok' && common() }
export function deadSupport() { return dead() && common() }
`
    sources['unit.test.ts'] = `import { test } from 'node:test'
import { liveSupport, deadSupport, common } from './helpers.test.ts'
export function liveCase() { liveSupport() }
export function deadCase() { deadSupport(); common() }
test('a contracted subject', liveCase)
test('an uncontracted subject', deadCase)
`
  } else if (input.case === 'uncontracted-registration') {
    sources['bindings.ts'] =
      "import { live } from './app.ts'\nimport { dead } from './dead.ts'\nexport const actions = { 'live': live, 'dead': dead }\n"
  } else if (input.case === 'missing-inventory') {
    sources['app.ts'] =
      "import { dead } from './dead.ts'\nexport function live() { return { status: dead() ? 'ok' : 'broken' } }\n"
  } else if (input.case === 'literal-import') {
    delete sources['dead.ts']
    sources['app.ts'] = observedHandler(
      "const { format } = await import('./format.ts'); return format()",
      true,
    )
    sources['format.ts'] = `export function format() { return { status: 'ok' } }
export function unused() { return 42 }
`
  } else if (input.case === 'unsupported-language') {
    delete sources['dead.ts']
    sources['app.ts'] = observedHandler("return { status: 'ok' }")
    sources['unsupported.rs'] = 'pub fn unsupported() {}\n'
  } else if (input.case === 'type-error') {
    delete sources['dead.ts']
    sources['app.ts'] =
      "const invalid: number = 'wrong'\n" +
      observedHandler("return { status: 'ok', value: invalid }")
  } else if (input.case === 'default-library-directive') {
    delete sources['dead.ts']
    sources['app.ts'] = observedHandler("return { status: 'ok' }")
    sources['globals.d.ts'] = '/// <REFERENCE NO-DEFAULT-LIB="true"/>\n'
  } else if (input.case === 'json-dependency') {
    delete sources['dead.ts']
    sources['settings.json'] = '{"status":"ok"}\n'
    sources['app.ts'] =
      "import settings from './settings.json' with { type: 'json' }\n" +
      observedHandler('return { status: settings.status }')
  } else if (
    input.case === 'computed-registration' ||
    input.case === 'spread-registration' ||
    input.case === 'inline-registration'
  ) {
    delete sources['dead.ts']
    sources['app.ts'] = observedHandler("return { status: 'ok' }")
    const declaration = {
      'computed-registration': "const key = 'live'; export const actions = { [key]: live }",
      'spread-registration':
        "const entries = { 'live': live }; export const actions = { ...entries }",
      'inline-registration': "export const actions = { 'live': () => live() }",
    }[input.case]
    sources['bindings.ts'] = "import { live } from './app.ts'\n" + declaration + '\n'
  } else {
    throw new Error(`Unknown ancestry fixture: ${input.case}`)
  }
  const fixture = project(sources)
  try {
    if (input.case === 'missing-inventory') {
      fixture.config.maintained = fixture.config.maintained.filter((file) => file !== 'dead.ts')
      write(fixture.root, 'bonsai.json', JSON.stringify(fixture.config))
    }
    const report = invoke(['check', '--root', fixture.root])
    const ancestry = report.snapshot?.ancestry ?? {}
    return {
      ...report,
      deadHasAncestry: !!ancestry['dead.ts#dead']?.length,
      sharedHelperHasAncestry: !!ancestry['helpers.test.ts#common']?.length,
      deadTestHasAncestry: !!ancestry['unit.test.ts#deadCase']?.length,
      handlerExecuted: existsSync(join(fixture.root, 'handler-ran')),
      verificationTiming: report.snapshot?.timing?.stages.find(
        (stage: { name: string }) => stage.name === 'verification',
      ),
    }
  } finally {
    fixture.dispose()
  }
}
