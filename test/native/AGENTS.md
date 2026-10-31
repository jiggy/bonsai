# Purpose

Compare native source analysis with a development TypeScript oracle and measure complete native CLI checks.

## Ownership

Bun development tools in this directory: shared differential fixtures, canonical source facts, development-oracle comparisons, and fresh-process native CLI benchmarks. These are test support, outside the published package. Their actual references to contracted production subjects establish test ancestry; they cannot justify otherwise uncontracted production. The production native collector lives under `src/` at the repository root and uses the pinned tsrs package.

## Local Contracts

Compare component, relationship, token, binding, source-location, and diagnostic facts against the TypeScript reference. tsrs performs the native compiler work. Reference comparison belongs in development tooling; production native checks do not repeat the reference compiler pass.

Unsupported source or unresolved dependencies remain explicit. A matching source comparison does not establish runtime evidence or gate acceptance. Any assumed observations used to compare derived ancestry and policy decisions stay labeled as development inputs and never authorize acceptance.

Keep this authored tooling in maintained inventory. Retire obsolete implementations by deleting them, rather than excluding retained source. Other projects' authored Rust remains measured and unsupported until a Rust ancestry adapter exists.

Compare the native collector and development oracle on identical inputs. Benchmark protocol 3 launches fresh native CLI processes and preserves individual samples, compiler identity, decisions, and verification state. Repeated-run parity describes fact stability, not an engine comparison; do not report a speedup ratio between the default and its Rust compatibility spelling. Cold means a fresh process, without flushing operating-system file caches. Distinguish incomplete runs from completed verification and never report skipped work as a complete-check speedup.

The reference collector lives in `test/reference.ts` and uses development-only `test/compiler.ts`; it must not return to published runtime sources. No benchmark or comparison persists trusted diagnostics, source results, or runtime evidence.

## Work Guidance

Keep development commands small and their JSON reports versioned. Keep the native runtime and development oracle distinct; neither reference assumptions nor benchmark samples authorize a pass.

Primitive local path aliases must preserve subprocess entry ancestry when pruning irrelevant symbol requests.

## Verification

`bun run native:compare`, `bun run native:bench`, and the normal Bun suite's source conformance and native CLI regressions.

## Child DOX Index

None. This file owns the full subtree.
