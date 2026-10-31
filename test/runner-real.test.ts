import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Source } from '../src/model.ts'
import { runSupportingVerification, type RunnerRequirement } from '../src/runners.ts'

// The ordinary suite is network-free. CI opts into this consuming-project smoke
// explicitly; these are actual pinned framework CLIs, not simulated reports.
test('pinned Vitest, Cucumber and Stryker CLIs produce accepted fresh supporting evidence', {
  skip: process.env.BONSAI_RUNNER_SMOKE !== '1',
  timeout: 300000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-real-runners-'))
  const cache = mkdtempSync(join(tmpdir(), 'bonsai-runner-cache-'))
  const run = (args: string[]) => {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: { ...process.env, BUN_INSTALL_CACHE_DIR: cache },
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 1024 * 1024,
    })
    assert.equal(result.error, undefined, String(result.error))
    assert.equal(result.status, 0, result.stderr || result.stdout)
  }
  const execute = async (requirement: RunnerRequirement, source?: Source) => {
    const [result] = await runSupportingVerification(
      root,
      [requirement],
      'real-runner-smoke',
      60000,
      undefined,
      source,
    )
    assert.ok(result)
    return result
  }
  try {
    mkdirSync(join(root, '.bonsai'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        private: true,
        devDependencies: {
          vitest: '4.0.18',
          '@vitest/coverage-v8': '4.0.18',
          '@cucumber/cucumber': '13.3.0',
          '@stryker-mutator/core': '9.2.0',
        },
      }),
    )
    // Generate the consuming project's lock, then install exactly that resolution.
    run(['install', '--lockfile-only', '--ignore-scripts'])
    run(['install', '--frozen-lockfile', '--ignore-scripts'])
    const vitest: RunnerRequirement = {
      id: 'vitest',
      adapter: 'vitest-json',
      report: '.bonsai/vitest.json',
      coverage: { report: '.bonsai/coverage/coverage-summary.json', lines: 100 },
      command: [
        'node',
        'node_modules/vitest/vitest.mjs',
        'run',
        'order.test.ts',
        '--reporter=json',
        '--outputFile=.bonsai/vitest.json',
        '--maxWorkers=1',
        '--no-file-parallelism',
        '--coverage',
        '--coverage.reporter=json-summary',
        '--coverage.reportsDirectory=.bonsai/coverage',
      ],
    }
    writeFileSync(join(root, 'calculator.mjs'), 'export function add(a, b) { return a + b }\n')
    writeFileSync(
      join(root, 'order.test.ts'),
      "import { test, expect } from 'vitest'\nimport { add } from './calculator.mjs'\ntest('order is accepted', () => expect(add(1, 1)).toBe(2))\n",
    )
    const unit = await execute(vitest)
    assert.equal(unit.status, 'passed', JSON.stringify(unit))
    // Assumed scope facts isolate the real report format; native classification has its own CLI tests.
    const source: Source = {
      files: [{ file: 'calculator.mjs', tokens: 0, kind: 'production', executable: true }],
      components: [],
      relationships: [],
      actions: {},
      problems: [],
    }
    const scoped: RunnerRequirement = {
      ...vitest,
      coverage: {
        ...vitest.coverage!,
        scope: 'maintained-production',
      },
    }
    const scopedUnit = await execute(scoped, source)
    assert.equal(scopedUnit.status, 'passed', JSON.stringify(scopedUnit))
    assert.deepEqual(
      scopedUnit.coverageFiles?.map((file) => file.file),
      ['calculator.mjs'],
    )
    writeFileSync(join(root, 'omitted.mjs'), 'export const unmeasured = 1\n')
    source.files.push({ file: 'omitted.mjs', tokens: 0, kind: 'production', executable: true })
    const omitted = await execute(scoped, source)
    assert.equal(omitted.status, 'incomplete', JSON.stringify(omitted))
    assert.match(omitted.problems.join('\n'), /omits required production file: omitted.mjs/)
    writeFileSync(
      join(root, 'order.test.ts'),
      "import { test } from 'vitest'\ntest.skip('order is accepted', () => {})\n",
    )
    assert.equal(
      (await execute(vitest)).status,
      'incomplete',
      'Vitest skipped work must remain blocking',
    )

    const cucumber: RunnerRequirement = {
      id: 'cucumber',
      adapter: 'cucumber-messages',
      report: '.bonsai/cucumber.ndjson',
      command: [
        process.execPath,
        'node_modules/@cucumber/cucumber/bin/cucumber.js',
        'orders.feature',
        '--require',
        'steps.cjs',
        '--format',
        'message:.bonsai/cucumber.ndjson',
      ],
    }
    writeFileSync(
      join(root, 'orders.feature'),
      'Feature: Orders\nScenario: Accept an order\n When an order is submitted\n Then the order is accepted\n',
    )
    writeFileSync(
      join(root, 'steps.cjs'),
      "const { When, Then } = require('@cucumber/cucumber')\nconst assert = require('node:assert/strict')\nWhen('an order is submitted', function () { this.accepted = true })\nThen('the order is accepted', function () { assert.equal(this.accepted, true) })\n",
    )
    const behavior = await execute(cucumber)
    assert.equal(behavior.status, 'passed', JSON.stringify(behavior))
    writeFileSync(
      join(root, 'steps.cjs'),
      "const { When, Then } = require('@cucumber/cucumber')\nWhen('an order is submitted', function () { return 'skipped' })\nThen('the order is accepted', function () {})\n",
    )
    assert.equal(
      (await execute(cucumber)).status,
      'incomplete',
      'Cucumber success allows skipped steps, Bonsai requires execution',
    )

    writeFileSync(join(root, 'math.cjs'), 'exports.add = (a, b) => a + b\n')
    writeFileSync(
      join(root, 'check.cjs'),
      "const assert = require('node:assert/strict'); const { add } = require('./math.cjs'); assert.equal(add(1, 2), 3); assert.equal(add(-1, 2), 1)\n",
    )
    writeFileSync(
      join(root, 'stryker.config.json'),
      JSON.stringify({
        files: ['math.cjs', 'check.cjs', 'package.json', 'stryker.config.json'],
        mutate: ['math.cjs'],
        testRunner: 'command',
        commandRunner: { command: 'node check.cjs' },
        coverageAnalysis: 'off',
        reporters: ['json'],
        jsonReporter: { fileName: '.bonsai/stryker.json' },
        concurrency: 1,
        timeoutMS: 5000,
        thresholds: { high: 100, low: 0, break: 0 },
      }),
    )
    const stryker: RunnerRequirement = {
      id: 'stryker',
      adapter: 'stryker-json',
      report: '.bonsai/stryker.json',
      minimumMutationScore: 100,
      command: ['node', 'node_modules/@stryker-mutator/core/bin/stryker.js', 'run'],
    }
    const mutation = await execute(stryker)
    assert.equal(mutation.status, 'passed', JSON.stringify(mutation))
    assert.equal(mutation.mutationScore, 100)
    assert.ok(mutation.total > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
  }
})
