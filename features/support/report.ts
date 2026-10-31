import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCli } from './cli.ts'
import { project } from './project.ts'

type ReportInput = { case: 'rejected-mixed' | 'missing-binding' }

/** Observe the saved representation independently of the CLI's JSON stream. */
function readHtmlReport(path: string) {
  if (!existsSync(path)) return { artifacts: { exists: false }, htmlReport: null }
  const html = readFileSync(path, 'utf8')
  const data = html.match(
    /<script\b(?=[^>]*\bid=["']bonsai-report-data["'])[^>]*>([\s\S]*?)<\/script>/i,
  )?.[1]
  try {
    return {
      artifacts: { exists: true },
      htmlReport: data === undefined ? null : JSON.parse(data),
    }
  } catch (error) {
    return {
      artifacts: { exists: true },
      htmlReport: null,
      htmlReadError: error instanceof Error ? error.message : String(error),
    }
  }
}

export function checkHtmlReport(input: ReportInput) {
  if (input.case !== 'rejected-mixed' && input.case !== 'missing-binding')
    throw new Error(`Unknown HTML report arrangement: ${input.case}`)
  const missingBinding = input.case === 'missing-binding'
  const ceiling = missingBinding ? 10000 : 100
  const application = project(
    {
      'orders.ts': [
        'export function placeOrder(input: { quantity: number }) {',
        "  return { status: input.quantity > 0 ? 'accepted' : 'rejected' }",
        '}',
        "export function legacyPromotion() { return 'retired promotion' }",
        '',
      ].join('\n'),
      'bindings.ts': missingBinding
        ? 'export const actions = {}\n'
        : "import { placeOrder } from './orders.ts'\nexport const actions = { 'place-order': placeOrder }\n",
      'orders.feature': [
        'Feature: Place an order',
        '  Scenario: Order one item',
        '    When I invoke "place-order" with {"quantity": 1}',
        '    Then response "status" equals "accepted"',
        '',
      ].join('\n'),
    },
    { bootstrap: ceiling, hardLimit: ceiling },
  )
  try {
    const destination = join(application.root, 'reports', 'check.html')
    const result = runCli([
      'check',
      '--serial',
      '--root',
      application.root,
      '--report',
      destination,
      '--json',
    ])
    let command: Record<string, unknown>
    try {
      command = JSON.parse(result.stdout)
    } catch {
      command = { stdout: result.stdout, stderr: result.stderr }
    }
    return { ...command, exitCode: result.status, ...readHtmlReport(destination) }
  } finally {
    application.dispose()
  }
}
