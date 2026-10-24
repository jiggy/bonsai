import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { analyzeSource } from '../src/source.ts'

test('reused compiler documents preserve complete source facts through edits and errors', () => {
  mkdirSync(resolve('work'), { recursive: true })
  const root = mkdtempSync(resolve('work/source-session-'))
  const files = ['bindings.ts', 'dependency.ts', 'handler.ts', 'package.json']
  const collector = new URL('../src/source.ts', import.meta.url).href
  const compare = () => {
    const actual = analyzeSource(root, files, 'bindings.ts')
    const fresh = spawnSync(
      process.execPath,
      [
        '--eval',
        `import { analyzeSource } from ${JSON.stringify(collector)};
process.stdout.write(JSON.stringify(analyzeSource(${JSON.stringify(root)}, ${JSON.stringify(files)}, 'bindings.ts')));`,
      ],
      { encoding: 'utf8', timeout: 15000 },
    )
    assert.equal(fresh.error, undefined)
    assert.equal(fresh.status, 0, fresh.stderr)
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(fresh.stdout))
    return actual
  }
  try {
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    writeFileSync(
      join(root, 'bindings.ts'),
      "import { run } from './handler.ts'\nexport const actions = { run: run }\n",
    )
    writeFileSync(
      join(root, 'handler.ts'),
      "import { selected as execute, type Response } from './dependency.ts'\nexport function run(): Response { return execute() }\n",
    )
    writeFileSync(
      join(root, 'dependency.ts'),
      "export type Response = { status: string }\nexport function selected(): Response { return { status: 'ok' } }\nexport function unused() { return 'unused' }\n",
    )
    assert.deepEqual(compare().problems, [])
    assert.deepEqual(compare().problems, [])
    writeFileSync(
      join(root, 'dependency.ts'),
      'export type Response = { status: string }\nexport function selected(): Response { return { status: 42 } }\n',
    )
    assert.ok(compare().problems.some((problem) => problem.includes('not assignable')))
    writeFileSync(
      join(root, 'dependency.ts'),
      "export type Response = { status: string }\nexport function replacement(): Response { return { status: 'fixed' } }\n",
    )
    writeFileSync(
      join(root, 'handler.ts'),
      "import { replacement as execute, type Response } from './dependency.ts'\nexport function run(): Response { return execute() }\n",
    )
    const repaired = compare()
    assert.deepEqual(repaired.problems, [])
    assert.ok(repaired.relationships.some((edge) => edge.to === 'dependency.ts#replacement'))
    assert.ok(repaired.components.every((component) => component.name !== 'selected'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
