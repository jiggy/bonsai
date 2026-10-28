import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { invoke } from './cli.ts'

type ProjectInput = {
  examples?: number
  broken?: boolean
  unrooted?: boolean
  overBudget?: boolean
  missingContracts?: boolean
  unbound?: boolean
  ignoredCode?: boolean
  computedImport?: boolean
  engine?: 'rust'
  missingNative?: boolean
  subprocess?: 'live' | 'unused' | 'uncontracted' | 'missing'
}

function project(input: ProjectInput = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-self-host-'))
  const marker = join(root, 'handler-executed')
  const childMarker = join(root, 'child-executed')
  const usesChild = input.subprocess && input.subprocess !== 'uncontracted'
  if (input.subprocess) writeFileSync(join(root, 'package.json'), '{"type":"module"}\n')
  writeFileSync(
    join(root, 'orders.ts'),
    [
      "import { appendFileSync } from 'node:fs'",
      ...(input.subprocess
        ? [
            "import { spawnSync } from 'node:child_process'",
            "import { fileURLToPath } from 'node:url'",
            "const entry = fileURLToPath(new URL('./order-worker.ts', import.meta.url))",
            'function backgroundOrder(input: { quantity: number }) {',
            "  const child = spawnSync(process.execPath, [entry, JSON.stringify(input)], { encoding: 'utf8' })",
            '  if (child.error) throw child.error',
            "  if (child.status !== 0) throw new Error(child.stderr || 'Order worker stopped')",
            '  return JSON.parse(child.stdout)',
            '}',
          ]
        : []),
      `export ${input.computedImport ? 'async ' : ''}function placeOrder(input: { quantity: number }) {`,
      ...(input.computedImport
        ? ["  const modulePath = './orders.ts'; await import(modulePath)"]
        : []),
      `  appendFileSync(${JSON.stringify(marker)}, JSON.stringify(input) + '\\n')`,
      usesChild
        ? '  return backgroundOrder(input)'
        : `  return { status: ${input.broken ? "'accepted'" : "input.quantity > 0 ? 'accepted' : 'rejected'"} }`,
      '}',
      ...(input.unrooted ? ['export function unused() { return 42 }'] : []),
    ].join('\n'),
  )
  if (input.subprocess && input.subprocess !== 'missing') {
    writeFileSync(
      join(root, 'order-worker.ts'),
      [
        "import { writeFileSync } from 'node:fs'",
        'function evaluateOrder(input: { quantity: number }) {',
        `  writeFileSync(${JSON.stringify(childMarker)}, 'executed')`,
        "  return { status: input.quantity > 0 ? 'accepted' : 'rejected' }",
        '}',
        'console.log(JSON.stringify(evaluateOrder(JSON.parse(process.argv[2]!))))',
        ...(input.subprocess === 'unused' ? ['export function unused() { return 42 }'] : []),
      ].join('\n'),
    )
  }
  writeFileSync(
    join(root, 'bindings.ts'),
    input.unbound
      ? 'export const actions = {}\n'
      : "import { placeOrder } from './orders.ts'\nexport const actions = { 'place-order': placeOrder }\n",
  )
  const rows = Array.from(
    { length: input.examples ?? 2 },
    (_, index) => `      | ${index === 0 ? '1' : '0'} | ${index === 0 ? 'accepted' : 'rejected'} |`,
  )
  writeFileSync(
    join(root, 'orders.feature'),
    input.missingContracts
      ? '# No executable contract has been authored.\n'
      : [
          'Feature: Ordering',
          '  Scenario Outline: Submit an order',
          '    When I invoke "place-order" with {"quantity": <quantity>}',
          '    Then response "status" equals "<status>"',
          '    Examples:',
          '      | quantity | status |',
          ...rows,
          '',
        ].join('\n'),
  )
  if (input.ignoredCode) writeFileSync(join(root, 'ignored.ts'), 'export const unused = true\n')
  writeFileSync(
    join(root, 'bonsai.json'),
    JSON.stringify({
      maintained: [
        'orders.ts',
        'bindings.ts',
        'orders.feature',
        'bonsai.json',
        ...(input.ignoredCode ? ['ignored.ts'] : []),
        ...(input.subprocess ? ['package.json'] : []),
        ...(input.subprocess && input.subprocess !== 'missing' ? ['order-worker.ts'] : []),
      ],
      exclude: input.ignoredCode ? ['ignored.ts'] : [],
      bindings: 'bindings.ts',
      policy: {
        bootstrap: input.overBudget ? 1 : 1000,
        bootstrapSurface: 1,
        perDoubling: 0,
        hardLimit: input.overBudget ? 1 : 1000,
        maxFeedbackMs: 15000,
      },
    }),
  )
  return { root, marker, childMarker }
}

export function checkBasicProject(input: ProjectInput) {
  const { root, marker, childMarker } = project(input)
  try {
    const report = invoke(
      ['check', '--root', root, ...(input.engine ? ['--engine', input.engine] : [])],
      input.missingNative ? { BONSAI_NATIVE_BINARY: join(root, 'missing-collector') } : {},
    )
    return {
      ...report,
      handlerExecuted: existsSync(marker),
      invocationCount: existsSync(marker)
        ? readFileSync(marker, 'utf8').trim().split('\n').length
        : 0,
      ...(input.subprocess && {
        childExecuted: existsSync(childMarker),
      }),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function inspectConfiguration(input: ProjectInput) {
  const { root, marker } = project(input)
  try {
    return { ...invoke(['config', 'show', '--root', root]), handlerExecuted: existsSync(marker) }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function explainComponent(input: { target?: string }) {
  const { root, marker } = project()
  try {
    return {
      ...invoke(['explain', input.target ?? 'orders.ts#placeOrder', '--root', root]),
      handlerExecuted: existsSync(marker),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function initializeProject() {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-self-init-'))
  try {
    const originalSource = 'export function app() { return 1 }\n'
    writeFileSync(join(root, 'app.ts'), originalSource)
    const initialized = invoke(['init', '--root', root])
    const configFile = join(root, 'bonsai.json')
    const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : undefined
    return {
      ...initialized,
      savedConfig: config,
      originalSource: readFileSync(join(root, 'app.ts'), 'utf8'),
      sourceUnchanged: readFileSync(join(root, 'app.ts'), 'utf8') === originalSource,
      configurationExists: existsSync(configFile),
      bindingExists:
        typeof config?.bindings === 'string' && existsSync(join(root, config.bindings)),
      requirementsExist:
        Array.isArray(initialized.created) &&
        initialized.created.some(
          (file: string) => file.endsWith('.feature') && existsSync(join(root, file)),
        ),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function showHelp(input: { command?: string }) {
  return invoke(['help', ...(input.command ? [input.command] : [])], {
    BONSAI_ROOT: '/missing-bonsai-project',
    BONSAI_NATIVE_BINARY: '/missing-bonsai-checker',
  })
}

export function generateCompletion(input: { shell: string }) {
  return invoke(['completion', input.shell])
}

export function showVersion() {
  const report = invoke(['version'], {
    BONSAI_ROOT: '/missing-bonsai-project',
    BONSAI_NATIVE_BINARY: '/missing-bonsai-checker',
  })
  return {
    ...report,
    versionPresent: typeof report.version === 'string' && report.version.trim().length > 0,
  }
}

export function verifyIsolatedScenarios(input: { serial?: boolean }) {
  const { root, marker } = project()
  try {
    writeFileSync(
      join(root, 'orders.ts'),
      [
        "import { appendFileSync } from 'node:fs'",
        'let count = 0',
        'export function advance() {',
        '  count++',
        `  appendFileSync(${JSON.stringify(marker)}, String(count) + '\\n')`,
        '  return { count }',
        '}',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(root, 'bindings.ts'),
      "import { advance } from './orders.ts'\nexport const actions = { 'advance': advance }\n",
    )
    writeFileSync(
      join(root, 'orders.feature'),
      [
        'Feature: Independent counters',
        '  Scenario Outline: Keep steps ordered within a fresh scenario',
        '    When I invoke "advance" with {}',
        '    Then response "count" equals <first>',
        '    When I invoke "advance" with {}',
        '    Then response "count" equals <second>',
        '    Examples:',
        '      | first | second |',
        '      | 1 | 2 |',
        `      | ${input.serial ? 3 : 1} | ${input.serial ? 4 : 2} |`,
        '',
      ].join('\n'),
    )
    const report = invoke(['check', '--root', root, ...(input.serial ? ['--serial'] : [])])
    return {
      ...report,
      invocationCount: existsSync(marker)
        ? readFileSync(marker, 'utf8').trim().split('\n').length
        : 0,
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
