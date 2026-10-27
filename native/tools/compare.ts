import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileContracts } from '../../src/contracts.ts'
import type { Contracts, Source } from '../../src/model.ts'
import { evaluate } from '../../src/policy.ts'
import { buildSnapshot } from '../../src/retention.ts'
import { analyzeSource } from '../../test/reference.ts'
import { canonicalSource, collectNative } from './client.ts'
import { cases, materializeFixture } from './fixtures.ts'

const policy = {
  bootstrap: 100000,
  bootstrapSurface: 1,
  perDoubling: 0,
  hardLimit: 100000,
  maxFeedbackMs: 1000,
}

function derivedResult(source: Source, contracts: Contracts) {
  const candidate = buildSnapshot('fixture-comparison', contracts, source)
  // Assumed observations compare policy behavior only. They are not executed
  // evidence and cannot establish acceptance outside this development harness.
  candidate.evidence = {
    fingerprint: candidate.fingerprint,
    profile: 'in-process-v1',
    complete: true,
    elapsedMs: 0,
    checks: contracts.checks.map((check) => ({ id: check.id, status: 'passed' })),
  }
  const decision = evaluate(undefined, candidate, policy)
  return {
    ancestry: Object.fromEntries(
      Object.entries(candidate.ancestry)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, checks]) => [id, [...checks].sort()]),
    ),
    unrooted: [...candidate.unrooted].sort(),
    decision: { ...decision, violations: [...decision.violations].sort() },
  }
}

export async function compareCases() {
  const results = []
  for (const fixture of cases) {
    const { root, files, dispose } = materializeFixture(fixture)
    let reference: Source | undefined
    let native: Awaited<ReturnType<typeof collectNative>> | undefined
    try {
      reference = analyzeSource(root, files, fixture.bindings)
      native = await collectNative(root, files, fixture.bindings)
      const contracts = compileContracts([{ file: 'behavior.feature', text: fixture.feature }])
      assert.deepEqual(contracts.problems, [], 'Comparison fixture contracts must compile')
      assert.deepEqual(canonicalSource(native.source), canonicalSource(reference))
      const expected = derivedResult(reference, contracts)
      assert.deepEqual(derivedResult(native.source, contracts), expected)
      results.push({
        name: fixture.name,
        status: 'matched' as const,
        analysis: reference.problems.length ? ('incomplete' as const) : ('complete' as const),
        components: reference.components.length,
        relationships: reference.relationships.length,
        problems: reference.problems,
        assumedDecision: expected.decision.status,
      })
    } catch (error) {
      results.push({
        name: fixture.name,
        status: 'mismatch' as const,
        error: error instanceof Error ? error.message : String(error),
        referenceSource: reference ? canonicalSource(reference) : undefined,
        nativeSource: native ? canonicalSource(native.source) : undefined,
      })
    } finally {
      dispose()
    }
  }
  return {
    protocol: 2,
    comparison: 'source facts, diagnostics, ancestry, and decisions under assumed observations',
    referenceCompiler: 'typescript',
    nativeCompiler: 'tsrs',
    handlersRun: false,
    matched: results.filter((result) => result.status === 'matched').length,
    incomplete: results.filter(
      (result) => result.status === 'matched' && result.analysis === 'incomplete',
    ).length,
    mismatches: results.filter((result) => result.status === 'mismatch').length,
    cases: results,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await compareCases()
  const output = JSON.stringify(report, null, 2) + '\n'
  process.stdout.write(output)
  if (process.argv[2]) writeFileSync(resolve(process.argv[2]), output)
  if (report.mismatches) process.exitCode = 1
}
