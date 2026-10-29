import { invoke } from './cli.ts'
import { project } from './project.ts'

/** Same approval behavior, arranged with nested decisions or guard clauses. */
export function checkControlDepth(input: { layout: 'nested' | 'flat' }) {
  if (input.layout !== 'nested' && input.layout !== 'flat')
    throw new Error('Unknown control-depth layout')
  const conditions = ['valid', 'stocked', 'paid', 'authorized', 'available']
  const body =
    input.layout === 'nested'
      ? conditions.map((name) => `if (input.${name}) {`).join('\n') +
        "\nreturn { status: 'accepted' }\n" +
        conditions.map(() => '}').join('\n')
      : conditions.map((name) => `if (!input.${name}) return { status: 'denied' }`).join('\n') +
        "\nreturn { status: 'accepted' }"
  const fixture = project(
    {
      'approval.ts': `export function approve(input: { valid: boolean; stocked: boolean; paid: boolean; authorized: boolean; available: boolean }) {\n${body}${input.layout === 'nested' ? "\nreturn { status: 'denied' }" : ''}\n}\n`,
      'bindings.ts':
        "import { approve } from './approval.ts'\nexport const actions = { approve: approve }\n",
      'approval.feature': `Feature: Approval
Scenario: Accept a permitted request
 When I invoke "approve" with {"valid":true,"stocked":true,"paid":true,"authorized":true,"available":true}
 Then response "status" equals "accepted"
Scenario: Deny an unpaid request
 When I invoke "approve" with {"valid":true,"stocked":true,"paid":false,"authorized":true,"available":true}
 Then response "status" equals "denied"
`,
    },
    { structural: { metric: 'control-depth-v1', maxDepth: 4 } } as never,
  )
  try {
    return invoke(['check', '--root', fixture.root])
  } finally {
    fixture.dispose()
  }
}
