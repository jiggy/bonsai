import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { compileContracts } from '../src/contracts.ts'
import { countTokens, inventory } from '../src/source.ts'
import { snapshot, readConfig } from '../src/project.ts'
import { ceiling, evaluate } from '../src/policy.ts'
import { runEvidence } from '../src/evidence.ts'

const example = resolve('examples/checkout')
const feature = readFileSync(join(example, 'features/checkout.feature'), 'utf8')
const contracts = (text = feature) => compileContracts([{ file: 'checkout.feature', text }])

function fixture(): { root: string; dispose: () => void } {
  // Keep fixtures under the repository so TS can resolve the installed Node type definitions.
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/fixture-'))
  cpSync(example, root, { recursive: true })
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

test('outline rows and duplicated or split files cannot earn extra allowance', () => {
  const single = contracts()
  assert.equal(single.pairs.length, 1)
  assert.equal(single.checks.length, 3)
  const duplicate = compileContracts([
    { file: 'a.feature', text: feature },
    { file: 'b.feature', text: feature },
  ])
  assert.deepEqual(duplicate.pairs, single.pairs)
  assert.equal(duplicate.checks.length, 6)
  assert.equal(new Set(duplicate.checks.map((check) => check.id)).size, 6)
})

test('collection positions normalize without combining different actions or values', () => {
  const result = contracts(`Feature: Cart
Scenario: Observe
 When I invoke "cart" with {}
 Then response "items[0].price" equals 10
 And response "items[3].price" equals 20
 When I invoke "other" with {}
 Then response "items[0].price" equals 10
`)
  assert.equal(result.problems.length, 0)
  assert.equal(result.pairs.length, 2)
  assert.equal(result.checks.length, 3)
})

test('unsupported, skipped, malformed and unobserved scenarios fail closed', () => {
  for (const text of [
    feature.replace('Then response', 'Then maybe response'),
    feature.replace('Scenario Outline:', '@skip\n  Scenario Outline:'),
    feature.replace('{"quantity": <quantity>}', '{invalid}'),
    'Feature: Empty\nScenario: Empty\n When I invoke "cart" with {}\n',
    'not a feature',
  ])
    assert.ok(contracts(text).problems.length, text)
})

test('the ceiling grows per doubling, is capped, and rejects invalid configuration', () => {
  const policy = {
    bootstrap: 20000,
    bootstrapSurface: 20,
    perDoubling: 2000,
    hardLimit: 25000,
    maxFeedbackMs: 15000,
  }
  assert.equal(ceiling(0, policy), 20000)
  assert.equal(ceiling(21, policy), 20140)
  assert.equal(ceiling(40, policy), 22000)
  assert.equal(ceiling(80, policy), 24000)
  assert.equal(ceiling(160, policy), 25000)
  assert.throws(() => readConfig('/not-a-project'))
})

test('formatting does not reduce code cost; string and comment payloads consume space', () => {
  assert.equal(countTokens('const x = 1;', true), countTokens('const\n x=1 ;', true))
  assert.ok(countTokens('const x = "' + 'a'.repeat(1000) + '";', true) > 250)
  assert.ok(countTokens('// retained comment\nconst x=1', true) > countTokens('const x=1', true))
})

test('inventory includes nested assets once and refuses paths outside the root', () => {
  const files = inventory(example, ['src', 'src/./checkout.ts', 'features'])
  assert.equal(files.filter((file) => file === 'src/checkout.ts').length, 1)
  assert.throws(() => inventory(example, ['../checkout/bindings.ts/../../../../package.json']))
})

test('checkout runs every assertion and produces passing candidate-bound evidence', async () => {
  const result = await snapshot(example, readConfig(example))
  assert.deepEqual(result.source.problems, [])
  assert.deepEqual(result.unrooted, [])
  assert.equal(result.evidence?.checks.length, 3)
  assert.ok(result.evidence?.checks.every((check) => check.status === 'passed'))
  assert.equal(evaluate(undefined, result, readConfig(example).policy).status, 'pass')
  assert.ok(result.ancestry['src/checkout.ts#validQuantity'].length)
})

test('unit tests cannot root dead code, including an unused symbol in a live module and a cycle', async () => {
  const { root, dispose } = fixture()
  try {
    writeFileSync(
      join(root, 'src/unused.ts'),
      `export function unused(): number { return other(); }\nexport function other(): number { return unused(); }`,
    )
    writeFileSync(
      join(root, 'src/unused.test.ts'),
      `import { unused } from './unused.ts';\nimport { test } from 'node:test';\ntest('unused', () => { unused(); });`,
    )
    writeFileSync(
      join(root, 'src/checkout.ts'),
      readFileSync(join(root, 'src/checkout.ts'), 'utf8') +
        '\nexport function unusedInLiveModule() { return 42; }\n',
    )
    const result = await snapshot(root, readConfig(root), false)
    assert.deepEqual(result.source.problems, [])
    assert.ok(result.unrooted.includes('src/unused.ts#unused'))
    assert.ok(result.unrooted.includes('src/unused.ts#other'))
    assert.ok(result.unrooted.includes('src/checkout.ts#unusedInLiveModule'))
    assert.ok(result.unrooted.some((id) => id.startsWith('src/unused.test.ts#')))
  } finally {
    dispose()
  }
})

test('lower-level tests inherit ancestry, without rescuing another subject they happen to import', async () => {
  const { root, dispose } = fixture()
  try {
    writeFileSync(join(root, 'src/other.ts'), 'export function other() { return 1; }')
    writeFileSync(
      join(root, 'src/checkout.test.ts'),
      `import { validQuantity } from './checkout.ts';
import { other } from './other.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('quantity', () => { assert.ok(validQuantity(1)); other(); });`,
    )
    const result = await snapshot(root, readConfig(root), false)
    assert.deepEqual(result.source.problems, [])
    const lowerTest = result.source.components.find((c) => c.file === 'src/checkout.test.ts')!
    assert.ok(result.ancestry[lowerTest.id]?.length)
    assert.ok(result.unrooted.includes('src/other.ts#other'))
  } finally {
    dispose()
  }
})

test('uncontracted action registrations do not justify their production handlers', async () => {
  const { root, dispose } = fixture()
  try {
    writeFileSync(join(root, 'src/extra.ts'), 'export function extra() { return 1; }')
    writeFileSync(
      join(root, 'bindings.ts'),
      `import { placeOrder } from './src/checkout.ts';
import { extra } from './src/extra.ts';
export const actions = { 'place-order': placeOrder, 'extra': extra };`,
    )
    const result = await snapshot(root, readConfig(root), false)
    assert.deepEqual(result.source.problems, [])
    assert.ok(result.unrooted.includes('src/extra.ts#extra'))
  } finally {
    dispose()
  }
})

test('shared helpers are counted once and a reachable wrapper receives its full cost', async () => {
  const { root, dispose } = fixture()
  try {
    const original = readFileSync(join(root, 'src/checkout.ts'), 'utf8')
    writeFileSync(
      join(root, 'src/checkout.ts'),
      original.replace('validQuantity(input.quantity)', 'wrapper(input.quantity)') +
        '\nexport function wrapper(quantity: number) { return validQuantity(quantity); }\n',
    )
    const wrapped = await snapshot(root, readConfig(root))
    assert.equal(evaluate(undefined, wrapped, readConfig(root).policy).status, 'pass')
    assert.ok(wrapped.ancestry['src/checkout.ts#wrapper'].length)
    writeFileSync(join(root, 'src/checkout.ts'), original)
    const compacted = await snapshot(root, readConfig(root))
    const exactCeiling = compacted.source.files.reduce((sum, file) => sum + file.tokens, 0)
    const policy = { ...readConfig(root).policy, bootstrap: exactCeiling }
    assert.equal(evaluate(undefined, wrapped, policy).status, 'reject')
    const decision = evaluate(wrapped, compacted, policy)
    assert.equal(decision.status, 'pass')
    assert.ok(decision.base!.retainedChange < 0)
    assert.equal(compacted.source.files.filter((file) => file.file === 'src/checkout.ts').length, 1)
  } finally {
    dispose()
  }
})

test('missing, stale, duplicate and failed evidence all block acceptance', async () => {
  const result = await snapshot(example, readConfig(example))
  const policy = readConfig(example).policy
  for (const alter of [
    (s: typeof result) => {
      delete s.evidence
    },
    (s: typeof result) => {
      s.evidence!.fingerprint = 'another-candidate'
    },
    (s: typeof result) => {
      s.evidence!.complete = false
    },
    (s: typeof result) => {
      s.evidence!.checks.pop()
    },
    (s: typeof result) => {
      s.evidence!.checks.push(s.evidence!.checks[0])
    },
  ]) {
    const candidate = structuredClone(result)
    alter(candidate)
    assert.equal(evaluate(undefined, candidate, policy).status, 'incomplete')
  }
  const failed = structuredClone(result)
  failed.evidence!.checks[0].status = 'failed'
  assert.equal(evaluate(undefined, failed, policy).status, 'reject')
  assert.equal(evaluate(undefined, result, { ...policy, maxFeedbackMs: 1 }).status, 'reject')
})

test('actual wrong behavior fails observations rather than earning a pass', async () => {
  const { root, dispose } = fixture()
  try {
    writeFileSync(
      join(root, 'src/checkout.ts'),
      'export function placeOrder() { return { status: "accepted" }; }',
    )
    const result = await snapshot(root, readConfig(root))
    assert.equal(result.evidence?.checks.filter((c) => c.status === 'failed').length, 2)
    assert.equal(evaluate(undefined, result, readConfig(root).policy).status, 'reject')
  } finally {
    dispose()
  }
})

test('local dependencies outside the maintained inventory are incomplete', async () => {
  const { root, dispose } = fixture()
  try {
    writeFileSync(join(root, 'outside.ts'), 'export function outside() { return true; }')
    writeFileSync(
      join(root, 'src/checkout.ts'),
      `import { outside } from '../outside.ts';\nexport function placeOrder() { return { status: outside() ? 'accepted' : 'rejected' }; }`,
    )
    const result = await snapshot(root, readConfig(root), false)
    assert.ok(result.source.problems.some((problem) => problem.includes('outside.ts')))
    assert.equal(evaluate(undefined, result, readConfig(root).policy).status, 'incomplete')
  } finally {
    dispose()
  }
})

test('a nonterminating action is stopped by the evidence worker deadline', async () => {
  const { root, dispose } = fixture()
  try {
    writeFileSync(
      join(root, 'bindings.ts'),
      'export const actions = { "place-order": () => { while (true) {} } };',
    )
    await assert.rejects(
      runEvidence(root, 'bindings.ts', contracts(), 'candidate', 500),
      /deadline expired/,
    )
  } finally {
    dispose()
  }
})

test('CLI compares a Git base using trusted base rules and emits usable JSON and exit codes', async () => {
  const { execFileSync, spawnSync } = await import('node:child_process')
  const { root, dispose } = fixture()
  try {
    execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' })
    execFileSync('git', ['-C', root, 'add', '.'])
    execFileSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'user.name=Bonsai Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'Base',
      ],
      { stdio: 'ignore' },
    )
    const config = readConfig(root)
    config.policy.bootstrap = 100000
    config.policy.hardLimit = 100000
    writeFileSync(join(root, 'bonsai.json'), JSON.stringify(config))
    const source = join(root, 'src/checkout.ts')
    writeFileSync(source, readFileSync(source, 'utf8') + '\n// ' + 'retained '.repeat(500))
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, ['src/cli.ts', ...args], {
        encoding: 'utf8',
        timeout: 30000,
      })
    const rejected = cli('check', '--root', root, '--base', 'HEAD', '--json')
    assert.equal(rejected.status, 1, rejected.stderr)
    const report = JSON.parse(rejected.stdout)
    assert.equal(report.decision.status, 'reject')
    assert.equal(report.decision.ceiling, 400)
    assert.ok(report.decision.requiredReduction > 0)
    assert.equal(report.decision.base.additionalCapacity, 0)
    const allowed = cli('check', '--root', root, '--policy', join(root, 'bonsai.json'), '--json')
    assert.equal(allowed.status, 0, allowed.stderr)
    const explained = cli('explain', 'src/checkout.ts#validQuantity', '--root', root, '--json')
    assert.equal(explained.status, 0, explained.stderr)
    assert.ok(JSON.parse(explained.stdout).components[0].contracts.length)
    const invalid = cli('check', '--root', '/does-not-exist', '--json')
    assert.equal(invalid.status, 2)
    assert.equal(JSON.parse(invalid.stderr).status, 'incomplete')
  } finally {
    dispose()
  }
})

test('verification detects maintained source changed by the application', async () => {
  const { root, dispose } = fixture()
  try {
    writeFileSync(
      join(root, 'src/checkout.ts'),
      `import { appendFileSync } from 'node:fs';
export function placeOrder(input: { quantity: number }) {
  appendFileSync(new URL('./checkout.ts', import.meta.url), '\\n// changed');
  return { status: input.quantity > 0 ? 'accepted' : 'rejected' };
}`,
    )
    const result = await snapshot(root, readConfig(root))
    assert.ok(
      result.source.problems.some((problem) => problem.includes('changed during verification')),
    )
    assert.equal(evaluate(undefined, result, readConfig(root).policy).status, 'incomplete')
  } finally {
    dispose()
  }
})
