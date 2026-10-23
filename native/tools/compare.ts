import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileContracts } from '../../src/contracts.ts'
import type { Contracts, Source } from '../../src/model.ts'
import { evaluate } from '../../src/policy.ts'
import { buildSnapshot } from '../../src/retention.ts'
import { analyzeSource } from '../../src/source.ts'
import { canonicalSource, collectNative } from './client.ts'
import { cases, materializeFixture } from './fixtures.ts'

const policy = {
  bootstrap: 100000,
  bootstrapSurface: 1,
  perDoubling: 0,
  hardLimit: 100000,
  maxFeedbackMs: 1000,
}

function structuralResult(source: Source, contracts: Contracts) {
  const snapshot = buildSnapshot('fixture-comparison', contracts, source)
  // These are assumed policy facts used only to compare the two source graphs.
  // The harness does not run handlers or produce admissible verification evidence.
  snapshot.evidence = {
    fingerprint: snapshot.fingerprint,
    profile: 'in-process-v1',
    complete: true,
    elapsedMs: 0,
    checks: contracts.checks.map((check) => ({ id: check.id, status: 'passed' })),
  }
  const decision = evaluate(undefined, snapshot, policy)
  return {
    ancestry: Object.fromEntries(
      Object.entries(snapshot.ancestry)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, checks]) => [id, [...checks].sort()]),
    ),
    unrooted: [...snapshot.unrooted].sort(),
    decision: {
      ...decision,
      violations: [...decision.violations].sort(),
    },
  }
}

export function compareCases() {
  const results = cases.map((fixture) => {
    const { root, files, dispose } = materializeFixture(fixture)
    let reference: Source | undefined
    let native: ReturnType<typeof collectNative> | undefined
    try {
      reference = analyzeSource(root, files, fixture.bindings)
      native = collectNative(root, files, fixture.bindings)
      if (native.typescriptDiagnostics !== 'not-run')
        throw new Error('Native capability must identify TypeScript diagnostics as not run')
      if (fixture.expect === 'unsupported') {
        assert.equal(native.structuralComplete, false, 'Unsupported syntax cannot be complete')
        const expectedProblem = fixture.expectedProblem
        assert.ok(expectedProblem, 'Unsupported fixtures must identify the intended blocker')
        assert.ok(
          native.source.problems.some((problem) => problem.startsWith(expectedProblem)),
          `Expected native blocker beginning with ${JSON.stringify(expectedProblem)}`,
        )
        return {
          name: fixture.name,
          expected: 'unsupported' as const,
          status: 'unsupported' as const,
          expectedProblem,
          referenceProblems: reference.problems,
          nativeProblems: native.source.problems,
        }
      }
      const contracts = compileContracts([{ file: 'behavior.feature', text: fixture.feature }])
      assert.deepEqual(contracts.problems, [], 'Comparison fixture contracts must compile')
      assert.deepEqual(reference.problems, [], 'Positive fixtures must pass reference diagnostics')
      assert.equal(native.structuralComplete, true, 'Supported fixture must be complete')
      assert.deepEqual(canonicalSource(native.source), canonicalSource(reference))
      const expected = structuralResult(reference, contracts)
      const actual = structuralResult(native.source, contracts)
      assert.deepEqual(actual, expected)
      return {
        name: fixture.name,
        expected: 'parity' as const,
        status: 'matched' as const,
        components: reference.components.length,
        relationships: reference.relationships.length,
        structuralDecision: actual.decision.status,
      }
    } catch (error) {
      return {
        name: fixture.name,
        expected: fixture.expect ?? 'parity',
        status: 'mismatch' as const,
        error: error instanceof Error ? error.message : String(error),
        referenceSource: reference ? canonicalSource(reference) : undefined,
        nativeSource: native ? canonicalSource(native.source) : undefined,
      }
    } finally {
      dispose()
    }
  })
  return {
    protocol: 1,
    comparison: 'structural facts and decisions under assumed fixture observations',
    nativeTypeScriptDiagnostics: 'not-run',
    handlersRun: false,
    matched: results.filter((result) => result.status === 'matched').length,
    unsupported: results.filter((result) => result.status === 'unsupported').length,
    mismatches: results.filter((result) => result.status === 'mismatch').length,
    cases: results,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = compareCases()
  const output = JSON.stringify(report, null, 2) + '\n'
  process.stdout.write(output)
  const destination = process.argv[2]
  if (destination) writeFileSync(resolve(destination), output)
  if (report.mismatches) process.exitCode = 1
}
