import { createProject } from './project.ts'

/** Arrange independent invalid files; assertions and copied-checker execution belong to tests. */
export function invalidContractProject() {
  const text = `Feature: Observe the application
  Scenario: Observe value 1
    When I invoke "sample" with {"value": 1}
    Then response "status" equals "accepted"
`
  const invalid = {
    skipped: text.replace('  Scenario:', '  @skip\n  Scenario:'),
    malformed: text.replace('{"value": 1}', '{invalid}'),
    unobserved: text.replace(/    Then response.*\n/, ''),
    unsupported: text.replace('Then response', 'Then maybe response'),
    selector: text.replace('response "status"', 'response "items[*].price"'),
    docstring: text.replace(
      '    Then response',
      '      """\n      unsupported argument\n      """\n    Then response',
    ),
    datatable: text.replace(
      '    Then response',
      '      | value |\n      | 1     |\n    Then response',
    ),
  }
  return createProject(
    {
      'package.json': '{"type":"module"}\n',
      'handler.ts': `import { writeFileSync } from 'node:fs'
export function sample() {
  writeFileSync(new URL('./handler-ran', import.meta.url), 'executed')
  return { status: 'accepted' }
}
`,
      'bindings.ts':
        "import { sample } from './handler.ts'\nexport const actions = { 'sample': sample }\n",
      ...Object.fromEntries(
        Object.entries(invalid).map(([kind, requirement]) => [`${kind}.feature`, requirement]),
      ),
    },
    { bootstrap: 1000, bootstrapSurface: 2, hardLimit: 1000 },
  )
}
