import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inventory } from '../src/inventory.ts'
import { readConfig } from '../src/project.ts'
import type { ContractCase } from '../src/model.ts'
import { verifySpecifications } from './specs.ts'

const repository = fileURLToPath(new URL('../', import.meta.url))

function copiedChecker() {
  const config = readConfig(repository)
  const files = inventory(repository, config.maintained, config.exclude)
  const work = resolve(repository, 'work')
  mkdirSync(work, { recursive: true })
  const root = mkdtempSync(join(work, 'spec-sensitivity-'))
  try {
    for (const file of files) {
      const target = join(root, file)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(repository, file), target)
    }
    symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir')
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function inputMatches(expected: Record<string, unknown>) {
  return (scenario: ContractCase) =>
    scenario.steps.some((step) => {
      if (step.kind !== 'action' || step.action !== 'check') return false
      if (step.input === null || typeof step.input !== 'object') return false
      const input = step.input as Record<string, unknown>
      return Object.entries(expected).every(([key, value]) => input[key] === value)
    })
}

async function detectsFault(
  expectedInput: Record<string, unknown>,
  file: string,
  before: string,
  after: string,
  observedSelector: string,
) {
  const checker = copiedChecker()
  try {
    const options = { select: inputMatches(expectedInput) }
    const control = await verifySpecifications(checker.root, options)
    assert.equal(control.contracts.cases.length, 1, 'Choose one authored product example')
    assert.equal(control.evidence.complete, true)
    assert.deepEqual(
      control.evidence.checks.filter((check) => check.status !== 'passed'),
      [],
      'The unmodified real checker must satisfy the authored example',
    )
    const path = join(checker.root, file)
    const original = readFileSync(path, 'utf8')
    assert.equal(original.split(before).length, 2, `Fault anchor must occur once in ${file}`)
    writeFileSync(path, original.replace(before, after))
    const faulty = await verifySpecifications(checker.root, options)
    assert.equal(
      faulty.evidence.complete,
      true,
      'A fixture or worker failure is not sensitivity evidence',
    )
    const target = faulty.contracts.checks.find((check) => check.selector === observedSelector)
    assert.ok(target, `The authored example must observe ${observedSelector}`)
    const outcome = faulty.evidence.checks.find((check) => check.id === target.id)
    assert.equal(
      outcome?.status,
      'failed',
      'The intended product observation must detect the fault',
    )
    assert.doesNotMatch(outcome?.error ?? '', /Missing response field|Unbound action|SyntaxError/)
    for (const check of faulty.contracts.checks.filter((check) => check.selector === 'exitCode')) {
      // Preserve the normal command result, including incomplete for the grammar
      // fixture's other rejected files. Only the ancestry fault changes reject
      // to pass rather than causing a setup, compiler, or protocol error.
      const result = faulty.evidence.checks.find((entry) => entry.id === check.id)
      if (observedSelector !== 'decision.status')
        assert.equal(result?.status, 'passed', result?.error)
      else assert.match(result?.error ?? '', /0[^\d]*!==[^\d]*1/s)
    }
    if (observedSelector !== 'decision.status') {
      const normal = faulty.contracts.checks.filter(
        (check) => check.selector === 'exitCode' || check.selector === 'decision.status',
      )
      assert.ok(
        normal.length,
        'The example must distinguish a normal CLI result from setup failure',
      )
      for (const check of normal)
        assert.equal(
          faulty.evidence.checks.find((entry) => entry.id === check.id)?.status,
          'passed',
        )
    }
    for (const check of faulty.contracts.checks.filter(
      (check) => check.selector === 'snapshot.source.problems',
    ))
      assert.equal(faulty.evidence.checks.find((entry) => entry.id === check.id)?.status, 'passed')
    writeFileSync(path, original)
    const restored = await verifySpecifications(checker.root, options)
    assert.equal(
      restored.fingerprint,
      control.fingerprint,
      'Restoration must recover the original inputs',
    )
    assert.equal(restored.evidence.complete, true)
    assert.deepEqual(
      restored.evidence.checks.filter((check) => check.status !== 'passed'),
      [],
      'Restoring the real product rule must make the same authored example green again',
    )
  } finally {
    checker.dispose()
  }
}

test('the authored allowance example detects an incorrect growth formula', async () => {
  await detectsFault(
    { fixture: 'accounting', case: 'ceiling', surface: 3 },
    'src/policy.ts',
    'Math.log2(',
    'Math.log10(',
    'decision.ceiling',
  )
})

test('the authored ancestry example detects production retained through a unit test', async () => {
  await detectsFault(
    { fixture: 'ancestry', case: 'mixed-test' },
    'src/retention.ts',
    "if (!target || (!allowProduction && target.kind === 'production')) continue",
    'if (!target) continue',
    'decision.status',
  )
})

test('the authored obligation example detects duplicate handler execution', async () => {
  const call = 'response = await module.actions[step.action](structuredClone(step.input))'
  await detectsFault(
    { examples: 5 },
    'src/evidence.ts',
    call,
    `await module.actions[step.action](structuredClone(step.input))\n            ${call}`,
    'invocationCount',
  )
})

test('the authored grammar example detects accepted files even while other files block', async () => {
  await detectsFault(
    { fixture: 'accounting', case: 'invalid-contract' },
    'src/contracts.ts',
    'if (step.argument)',
    'if (false)',
    'snapshot.contracts.cases.length',
  )
})
