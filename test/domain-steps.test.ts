import { test } from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { compileContracts } from '../src/contracts.ts'
import {
  collectDomainSteps,
  validDomainStepDefinitions,
  type DomainStepDefinition,
} from '../src/domain-steps.ts'

const definitions: DomainStepDefinition[] = [
  {
    kind: 'given',
    pattern: 'a publisher has chosen {problem:string}',
    input: { problem: { parameter: 'problem' } },
    sourceRef: { file: 'bindings.ts', line: 3 },
  },
  {
    kind: 'when',
    pattern: 'they commission a pilot',
    action: 'pilot',
    sourceRef: { file: 'bindings.ts', line: 7 },
  },
  {
    kind: 'then',
    pattern: 'they receive a sample and its practice materials',
    observations: [
      { selector: 'sample.available', equals: true },
      { selector: 'materials.available', equals: true },
    ],
    sourceRef: { file: 'bindings.ts', line: 11 },
  },
]

const feature = `Feature: Commission useful material
  Scenario: Commission a sample
    Given a publisher has chosen "confusing feedback"
    When they commission a pilot
    Then they receive a sample and its practice materials
`

test('domain context and independent consequences compile to the canonical action', () => {
  const contracts = compileContracts([{ file: 'pilot.feature', text: feature }], definitions)
  assert.deepEqual(contracts.problems, [])
  assert.equal(contracts.cases.length, 1)
  assert.deepEqual(contracts.cases[0]!.steps[0], {
    kind: 'action',
    action: 'pilot',
    input: { problem: 'confusing feedback' },
    definitionRefs: [definitions[0]!.sourceRef, definitions[1]!.sourceRef],
  })
  assert.deepEqual(
    contracts.checks.map(({ id, file, line, action, selector, expected }) => ({
      id,
      file,
      line,
      action,
      selector,
      expected,
    })),
    [
      {
        id: 'pilot.feature:0:2:0',
        file: 'pilot.feature',
        line: 5,
        action: 'pilot',
        selector: 'sample.available',
        expected: true,
      },
      {
        id: 'pilot.feature:0:2:1',
        file: 'pilot.feature',
        line: 5,
        action: 'pilot',
        selector: 'materials.available',
        expected: true,
      },
    ],
  )
  assert.deepEqual(contracts.pairs, [
    '["pilot","materials.available"]',
    '["pilot","sample.available"]',
  ])
  for (const check of contracts.checks)
    assert.deepEqual(
      check.definitionRefs,
      definitions.map((definition) => definition.sourceRef),
    )
})

test('literal metadata is inspected without importing or evaluating the registry', () => {
  const source = `throw new Error('must not execute')
export const steps = [
  { given: 'a publisher has chosen {problem:string}', input: { problem: { parameter: 'problem' } } },
  { when: 'they commission a pilot', action: 'pilot' },
  { then: 'they receive a sample and its practice materials', observations: [
    { selector: 'sample.available', equals: true },
    { selector: 'materials.available', equals: true },
  ] },
] as const
`
  const collected = collectDomainSteps(
    ts,
    ts.createSourceFile('bindings.ts', source, ts.ScriptTarget.Latest, true),
    'bindings.ts',
  )
  assert.deepEqual(collected.problems, [])
  assert.equal(collected.definitions.length, 3)
  assert.deepEqual(
    collected.definitions.map((definition) => definition.sourceRef.line),
    [3, 4, 5],
  )
  assert.equal(validDomainStepDefinitions(collected.definitions), true)
  assert.equal(
    compileContracts([{ file: 'pilot.feature', text: feature }], collected.definitions).checks
      .length,
    2,
  )
})

test('outline context is isolated while canonical surface and every obligation are preserved', () => {
  const text = `Feature: Reader problems
  Scenario Outline: Commission a sample
    Given a publisher has chosen "<problem>"
    When they commission a pilot
    Then they receive a sample and its practice materials
    Examples:
      | problem            |
      | confusing feedback |
      | slow review        |
`
  const contracts = compileContracts(
    [
      { file: 'first.feature', text },
      { file: 'second.feature', text },
    ],
    definitions,
  )
  assert.deepEqual(contracts.problems, [])
  assert.equal(contracts.cases.length, 4)
  assert.equal(contracts.checks.length, 8)
  assert.equal(new Set(contracts.checks.map((check) => check.id)).size, 8)
  assert.deepEqual(
    contracts.cases.map((scenario) =>
      scenario.steps[0]!.kind === 'action' ? scenario.steps[0]!.input : undefined,
    ),
    [
      { problem: 'confusing feedback' },
      { problem: 'slow review' },
      { problem: 'confusing feedback' },
      { problem: 'slow review' },
    ],
  )
  assert.equal(contracts.pairs.length, 2)
  assert.ok(contracts.checks.every((check) => check.line === 5))
})

test('quoted, integer, and final JSON parameters preserve actual values and authored expectations', () => {
  const extended: DomainStepDefinition[] = [
    definitions[0]!,
    {
      kind: 'given',
      pattern: 'a print run of {quantity:int}',
      input: { quantity: { parameter: 'quantity' } },
      sourceRef: { file: 'bindings.ts', line: 20 },
    },
    {
      kind: 'when',
      pattern: 'they commission a pilot with {draft:json}',
      action: 'pilot',
      input: { draft: { parameter: 'draft' } },
      sourceRef: { file: 'bindings.ts', line: 21 },
    },
    {
      kind: 'then',
      pattern: 'the status is {status:string}',
      observations: [{ selector: 'status', equals: { parameter: 'status' } }],
      sourceRef: { file: 'bindings.ts', line: 22 },
    },
    {
      kind: 'then',
      pattern: 'the quantity is {quantity:int}',
      observations: [{ selector: 'quantity', equals: { parameter: 'quantity' } }],
      sourceRef: { file: 'bindings.ts', line: 23 },
    },
  ]
  const contracts = compileContracts(
    [
      {
        file: 'parameters.feature',
        text: `Feature: Parameters
  Scenario: Preserve author values
    Given a publisher has chosen "a \\"quoted\\" problem"
    And a print run of 3
    When they commission a pilot with {"chapters":["practice"],"parameter":"ordinary data"}
    Then the status is "ready"
    And the quantity is 3
`,
      },
    ],
    extended,
  )
  assert.deepEqual(contracts.problems, [])
  const invocation = contracts.cases[0]!.steps[0]!
  assert.equal(invocation.kind, 'action')
  if (invocation.kind === 'action')
    assert.deepEqual(invocation.input, {
      problem: 'a "quoted" problem',
      quantity: 3,
      draft: { chapters: ['practice'], parameter: 'ordinary data' },
    })
  assert.deepEqual(
    contracts.checks.map((check) => check.expected),
    ['ready', 3],
  )
  assert.equal(contracts.checks[1]!.definitionRefs?.length, 4)
})

test('domain aliases and the technical DSL keep the same canonical surface', () => {
  const aliases: DomainStepDefinition[] = [
    ...definitions,
    {
      kind: 'when',
      pattern: 'they request a pilot',
      action: 'pilot',
      sourceRef: { file: 'bindings.ts', line: 20 },
    },
  ]
  const domain = compileContracts(
    [
      {
        file: 'pilot.feature',
        text:
          feature +
          feature
            .slice(feature.indexOf('  Scenario:'))
            .replace('they commission a pilot', 'they request a pilot'),
      },
    ],
    aliases,
  )
  assert.deepEqual(domain.problems, [])
  assert.equal(domain.checks.length, 4)
  assert.equal(domain.pairs.length, 2)
  const technical = [
    {
      file: 'technical.feature',
      text: `Feature: Existing grammar
  Scenario Outline: Read selected positions
    When I invoke "pilot" with {"position": <position>}
    Then response "items[<position>].status" equals "ready"
    Examples:
      | position |
      | 0        |
      | 3        |
`,
    },
  ]
  assert.deepEqual(compileContracts(technical, aliases), compileContracts(technical))
  assert.deepEqual(
    compileContracts(technical).checks.map((check) => check.id),
    ['technical.feature:0:1', 'technical.feature:1:1'],
  )
  assert.deepEqual(compileContracts(technical).pairs, ['["pilot","items[*].status"]'])
})

test('technical invocations cannot discard established domain context', () => {
  const text = feature.replace('they commission a pilot', 'I invoke "pilot" with {"edition":2}')
  const contracts = compileContracts([{ file: 'pilot.feature', text }], definitions)
  assert.deepEqual(contracts.problems, [])
  assert.deepEqual(contracts.cases[0]!.steps[0], {
    kind: 'action',
    action: 'pilot',
    input: { problem: 'confusing feedback', edition: 2 },
    definitionRefs: [definitions[0]!.sourceRef],
  })
  for (const input of ['null', '3', '[]', '{"problem":"replacement"}']) {
    const invalid = compileContracts(
      [
        {
          file: 'pilot.feature',
          text: feature.replace('they commission a pilot', `I invoke "pilot" with ${input}`),
        },
      ],
      definitions,
    )
    assert.ok(
      invalid.problems.some((problem) => /Given/.test(problem)),
      input,
    )
  }
})

test('unknown, ambiguous, misplaced, and skipped domain steps block compilation', () => {
  const cases: [string, DomainStepDefinition[], RegExp][] = [
    [
      feature.replace('they commission a pilot', 'they commission a novel'),
      definitions,
      /unsupported or unbound step/,
    ],
    [feature, [...definitions, definitions[1]!], /ambiguous domain step/],
    [
      feature.replace('Given a publisher', 'When a publisher'),
      definitions,
      /Given\/When\/Then role/,
    ],
    [
      feature.replace(
        'When they commission a pilot',
        'Then they receive a sample and its practice materials',
      ),
      definitions,
      /no preceding action/,
    ],
    [
      feature.replace(
        '    Then they receive',
        '    Given a publisher has chosen "another problem"\n    Then they receive',
      ),
      definitions,
      /must precede every action/,
    ],
    [
      feature.replace(
        '    When they commission',
        '    And a publisher has chosen "another problem"\n    When they commission',
      ),
      definitions,
      /already set by Given/,
    ],
    [feature.replace('  Scenario:', '  @skip\n  Scenario:'), definitions, /skip tags/],
    [
      feature.replace('    Then they receive a sample and its practice materials\n', ''),
      definitions,
      /must invoke an action and observe/,
    ],
  ]
  for (const [text, registry, message] of cases) {
    const contracts = compileContracts([{ file: 'pilot.feature', text }], registry)
    assert.ok(
      contracts.problems.some((problem) => message.test(problem)),
      JSON.stringify(contracts.problems),
    )
  }
})

test('overlapping parameter patterns and technical overrides cannot silently select a definition', () => {
  const overlap: DomainStepDefinition = {
    kind: 'given',
    pattern: 'a publisher has chosen {problem:json}',
    input: { problem: { parameter: 'problem' } },
    sourceRef: { file: 'bindings.ts', line: 20 },
  }
  assert.match(
    compileContracts(
      [{ file: 'pilot.feature', text: feature }],
      [...definitions, overlap],
    ).problems.join('\n'),
    /ambiguous domain step/,
  )
  const technical: DomainStepDefinition = {
    kind: 'when',
    pattern: 'I invoke "pilot" with {input:json}',
    action: 'other',
    input: { payload: { parameter: 'input' } },
    sourceRef: { file: 'bindings.ts', line: 21 },
  }
  const text =
    'Feature: Ambiguity\n  Scenario: Original invocation\n    When I invoke "pilot" with {}\n    Then response "status" equals "ready"\n'
  assert.match(
    compileContracts([{ file: 'technical.feature', text }], [technical]).problems.join('\n'),
    /ambiguous domain step/,
  )
})

test('malformed captures and unsafe integer values remain blocking', () => {
  const parameterized: DomainStepDefinition = {
    kind: 'given',
    pattern: 'a print run of {quantity:int}',
    input: { quantity: { parameter: 'quantity' } },
    sourceRef: { file: 'bindings.ts', line: 20 },
  }
  for (const step of [
    'a print run of 9007199254740992',
    'a print run of 3.2',
    'a print run of 01',
  ]) {
    const contracts = compileContracts(
      [
        {
          file: 'pilot.feature',
          text: feature.replace('a publisher has chosen "confusing feedback"', step),
        },
      ],
      [...definitions, parameterized],
    )
    assert.ok(contracts.problems.length, step)
  }
})

test('unsupported metadata is rejected without executing expressions', () => {
  const expressions = [
    'export const steps = makeSteps()',
    'export let steps = []',
    'const supplied = []; export { supplied as steps }',
    'export const steps = [...other]',
    "export const steps = [{ when: 'pilot', action: run() }]",
    "export const steps = [{ when: 'pilot', action: 'pilot', action: 'other' }]",
    "export const steps = [{ ['when']: 'pilot', action: 'pilot' }]",
    "export const steps = [{ given: 'chosen', input: {} }]",
    "export const steps = [{ when: 'pilot', action: 'pilot', callback: () => {} }]",
    "export const steps = [{ then: 'received', observations: [] }]",
    "export const steps = [{ then: 'received', observations: [{ selector: 'x', equals: undefined }] }]",
    "export const steps = [{ then: 'received', observations: [{ selector: 'x[*]', equals: true }] }]",
    "export const steps = [{ given: 'chosen {name:string}', input: { name: { parameter: 'missing' } } }]",
    "export const steps = [{ given: 'chosen {name:string}', input: { name: 'ignored parameter' } }]",
    "export const steps = [{ given: 'chosen {name:regex}', input: { name: { parameter: 'name' } } }]",
    "export const steps = [{ given: 'chosen {name:json} now', input: { name: { parameter: 'name' } } }]",
  ]
  for (const text of expressions) {
    const collected = collectDomainSteps(
      ts,
      ts.createSourceFile('bindings.ts', text, ts.ScriptTarget.Latest, true),
      'bindings.ts',
    )
    assert.ok(collected.problems.length, text)
    assert.deepEqual(collected.definitions, [], text)
  }
  assert.equal(
    validDomainStepDefinitions([
      { ...definitions[1], sourceRef: { file: 'bindings.ts', line: 0 } },
    ]),
    false,
  )
  assert.equal(validDomainStepDefinitions([{ ...definitions[1], callback: 'unsupported' }]), false)
  assert.deepEqual(
    collectDomainSteps(
      ts,
      ts.createSourceFile('bindings.ts', 'export const actions = {}', ts.ScriptTarget.Latest, true),
      'bindings.ts',
    ),
    { definitions: [], problems: [] },
  )
})
