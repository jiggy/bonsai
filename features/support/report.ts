import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCli } from './cli.ts'
import { project } from './project.ts'

type ReportInput = {
  case: 'rejected-mixed' | 'missing-binding' | 'default' | 'disabled-read-only'
}

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
  if (!['rejected-mixed', 'missing-binding', 'default', 'disabled-read-only'].includes(input.case))
    throw new Error(`Unknown HTML report arrangement: ${input.case}`)
  const missingBinding = input.case === 'missing-binding'
  const implicitDestination = input.case === 'default' || input.case === 'disabled-read-only'
  const readOnly = input.case === 'disabled-read-only'
  const ceiling = input.case === 'rejected-mixed' ? 100 : 10000
  const application = project(
    {
      'orders.ts': [
        'export function placeOrder(input: { quantity: number }) {',
        "  return { status: input.quantity > 0 ? 'accepted' : 'rejected' }",
        '}',
        ...(implicitDestination
          ? []
          : ["export function legacyPromotion() { return 'retired promotion' }"]),
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
    const destination = implicitDestination
      ? join(application.root, '.bonsai', 'report.html')
      : join(application.root, 'reports', 'check.html')
    if (readOnly) {
      for (const file of application.config.maintained)
        chmodSync(join(application.root, file), 0o444)
      chmodSync(application.root, 0o555)
    }
    const result = runCli([
      'check',
      '--serial',
      '--root',
      application.root,
      ...(readOnly ? ['--no-report'] : implicitDestination ? [] : ['--report', destination]),
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
    if (readOnly) {
      chmodSync(application.root, 0o700)
      for (const file of application.config.maintained)
        chmodSync(join(application.root, file), 0o600)
    }
    application.dispose()
  }
}
