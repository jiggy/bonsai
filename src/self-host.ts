import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

type ProjectInput = {
  examples?: number
  broken?: boolean
  unrooted?: boolean
  overBudget?: boolean
  missingContracts?: boolean
  unbound?: boolean
  ignoredCode?: boolean
  computedImport?: boolean
  engine?: 'typescript' | 'rust'
  missingNative?: boolean
  subprocess?: 'live' | 'unused' | 'uncontracted' | 'missing'
}

const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const repository = fileURLToPath(new URL('../', import.meta.url))

function invoke(args: string[], environment: NodeJS.ProcessEnv = {}) {
  const selected = process.env.BONSAI_SELF_HOST_ENGINE
  const engine =
    (args[0] === 'check' || args[0] === 'explain') &&
    !args.includes('--engine') &&
    (selected === 'rust' || selected === 'typescript')
      ? ['--engine', selected]
      : []
  const result = spawnSync(process.execPath, [cli, ...args, ...engine, '--json'], {
    cwd: repository,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      BONSAI_ROOT: undefined,
      BONSAI_BASE: undefined,
      BONSAI_POLICY: undefined,
      FORCE_COLOR: undefined,
      NO_COLOR: '1',
      CI: '1',
      ...environment,
    },
  })
  if (result.error) throw result.error
  if (result.status === null) throw new Error(`Bonsai stopped before reporting: ${result.signal}`)
  const report = JSON.parse(result.stdout || result.stderr)
  return { exitCode: result.status, ...report }
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
      "import { writeFileSync } from 'node:fs'",
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
      `  writeFileSync(${JSON.stringify(marker)}, 'executed')`,
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

export function checkProject(input: ProjectInput) {
  const { root, marker, childMarker } = project(input)
  try {
    const report = invoke(
      ['check', '--root', root, ...(input.engine ? ['--engine', input.engine] : [])],
      input.missingNative ? { BONSAI_NATIVE_BINARY: join(root, 'missing-collector') } : {},
    )
    return {
      ...report,
      handlerExecuted: existsSync(marker),
      ...(input.subprocess && {
        childExecuted: existsSync(childMarker),
        childMeasured: report.snapshot?.source.files.some(
          (file: { file: string }) => file.file === 'order-worker.ts',
        ),
        childHasAncestry: !!report.snapshot?.ancestry['order-worker.ts#evaluateOrder']?.length,
      }),
      timingMeasured: [report.timing?.elapsedMs, report.snapshot?.timing?.elapsedMs].every(
        (elapsed) => Number.isFinite(elapsed) && elapsed > 0,
      ),
      verificationTiming: report.snapshot?.timing?.stages.find(
        (stage: { name: string }) => stage.name === 'verification',
      ),
      sourceTiming: report.snapshot?.timing?.stages.find(
        (stage: { name: string }) => stage.name === 'source',
      ),
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
    writeFileSync(join(root, 'app.ts'), 'export function app() { return 1 }\n')
    const initialized = invoke(['init', '--root', root])
    const config = JSON.parse(readFileSync(join(root, 'bonsai.json'), 'utf8'))
    return {
      ...initialized,
      savedConfig: config,
      check: invoke(['check', '--root', root]),
      originalSource: readFileSync(join(root, 'app.ts'), 'utf8'),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export function showHelp(input: { command?: string }) {
  return invoke(['help', ...(input.command ? [input.command] : [])])
}

export function generateCompletion(input: { shell: string }) {
  return invoke(['completion', input.shell])
}
