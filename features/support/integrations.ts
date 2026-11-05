import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { observedRequirements } from './basic.ts'
import { invoke } from './cli.ts'
import { project, write } from './project.ts'

type PublisherInput = {
  case: 'publisher'
  examples?: number
  missing?: 'sample' | 'materials'
}

export function checkIntegrations(input: PublisherInput) {
  const fixture = project({
    'publisher.feature': [
      'Feature: Commission a useful pilot',
      ...Array.from(
        { length: input.examples ?? 1 },
        (_, index) => `  Scenario: Commission ${index + 1}
    Given a publisher has chosen "daily practice"
    When they commission a pilot
    Then they receive a sample and its practice materials`,
      ),
      '',
    ].join('\n'),
    'bindings.ts': `import { pilot } from './publisher.ts'
export const actions = { pilot: pilot }
export const steps = [
  { given: 'a publisher has chosen {problem:string}', input: { problem: { parameter: 'problem' } } },
  { when: 'they commission a pilot', action: 'pilot' },
  { then: 'they receive a sample and its practice materials', observations: [
    { selector: 'sample.available', equals: true },
    { selector: 'materials.available', equals: true },
  ] },
]
`,
    'publisher.ts': `import { appendFileSync } from 'node:fs'
export function pilot(input: { problem: string }) {
  appendFileSync(new URL('./commissions.jsonl', import.meta.url), JSON.stringify(input.problem) + '\\n')
  return {
    sample: { available: ${input.missing === 'sample' ? 'false' : 'input.problem.length > 0'} },
    materials: { available: ${input.missing === 'materials' ? 'false' : 'input.problem.length > 0'} },
  }
}
`,
  })
  try {
    const report = invoke(['check', '--serial', '--root', fixture.root, '--no-report'])
    const log = join(fixture.root, 'commissions.jsonl')
    const inputValues = existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : []
    return { ...report, invocationCount: inputValues.length, inputValues }
  } finally {
    fixture.dispose()
  }
}

export function explainIntegrations(input: { target: string }) {
  const fixture = project({
    'pilot.feature': `Feature: Commission through a named route
  Scenario: Prepare a pilot
    When I invoke "pilot" with {}
    Then response "status" equals "ready"
`,
    'bindings.ts': `import { pilot } from './handler.ts'
export const actions = { pilot: pilot }
`,
    'handler.ts': `import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
writeFileSync(new URL('./application-loaded', import.meta.url), 'loaded')
export function pilot(input: unknown) {
  writeFileSync(new URL('./handler-executed', import.meta.url), 'executed')
  const child = spawnSync('jig', ['run', 'binding:pilot', '--input', JSON.stringify(input), '--json'], {
    cwd: new URL('./', import.meta.url), encoding: 'utf8',
  })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(child.stderr)
  return JSON.parse(child.stdout)
}
`,
    'jig.ts': `import { defineJig, discover } from '@jigging/jig'
export default defineJig({ flows: discover('./flows'), bindings: discover('./bindings') })
`,
    'bindings/pilot.ts': `import { defineBinding } from '@jigging/jig'
export default defineBinding({ package: 'flows/pilot' })
`,
    'flows/pilot/FLOW.ts': `import { handle } from '@jigging/flow'
import { execute } from './method.ts'
await handle(execute)
`,
    'flows/pilot/method.ts': `import { writeFileSync } from 'node:fs'
import { createMaterials } from './materials.ts'
writeFileSync(new URL('../../application-loaded', import.meta.url), 'loaded')
export async function execute() {
  return { outcome: 'done', output: { status: createMaterials() } }
}
`,
    'flows/pilot/materials.ts': `export function createMaterials() { return 'ready' }
`,
    'flows/unrelated/method.ts': `export async function execute() { return { outcome: 'done' } }
`,
  })
  try {
    // Type-only stand-ins make this static boundary inspectable without installing or running Jig.
    write(
      fixture.root,
      'node_modules/@jigging/jig/package.json',
      '{"name":"@jigging/jig","version":"0.0.0-spec","type":"module","types":"index.d.ts"}',
    )
    write(
      fixture.root,
      'node_modules/@jigging/jig/index.d.ts',
      'export declare function discover(pattern: string): string[];\n' +
        'export declare function defineJig(config: unknown): unknown;\n' +
        'export declare function defineBinding(config: unknown): unknown;\n',
    )
    write(
      fixture.root,
      'node_modules/@jigging/flow/package.json',
      '{"name":"@jigging/flow","version":"0.0.0-spec","type":"module","types":"index.d.ts"}',
    )
    write(
      fixture.root,
      'node_modules/@jigging/flow/index.d.ts',
      'export declare function handle(handler: () => Promise<unknown>): Promise<void>;\n',
    )
    const report = invoke(['explain', input.target, '--root', fixture.root])
    return {
      ...report,
      requirements:
        report.components &&
        observedRequirements(
          report.components.flatMap(
            (component: { checks: { action: string; selector: string; expected: unknown }[] }) =>
              component.checks,
          ),
        ),
      applicationLoaded: existsSync(join(fixture.root, 'application-loaded')),
      handlerExecuted: existsSync(join(fixture.root, 'handler-executed')),
    }
  } finally {
    fixture.dispose()
  }
}
