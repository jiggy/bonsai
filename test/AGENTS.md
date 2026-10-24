# Purpose

Verify acceptance rules and observable CLI behavior.

## Ownership

Core gate tests, subprocess CLI tests, and `self-host.test.ts`, which checks the full maintained root and exercises every root `.feature` observation through an isolated TypeScript implementation's real CLI.

## Local Contracts

Assert outputs, streams, exit codes, and candidate behavior. Check presentation regressions use real PTYs and inspect ANSI foreground/dim state on meaningful text, including wrapped continuations and independently redirected streams. Use isolated fixtures and remove them in cleanup. CLI tests must exercise the executable rather than duplicate its parser.

## Work Guidance

Preserve regression coverage for budget, ancestry, evidence identity, worker deadlines, base policy, and interrupted runs.

Compiler-session regressions compare fresh diagnostics and source facts after changes to source, external declarations, package resolution, missing dependencies, and project roots. Reusing syntax must never authorize stale diagnostics or relationships. The lean-worker regression runs a real handler in a fresh evidence subprocess and checks that inventory validation alone does not load the TypeScript compiler.

Native CLI regressions exercise the same `check` and `explain` frontend with both engines. Compare real Rust-backed pass/reject reports, evidence, output streams, and presentation after normalizing measured durations, the native worker overhead timing row, explicit engine selection, and engine metadata. Assert overhead and native diagnostic identity separately; the production Rust path uses tsrs without a TypeScript reference pass. Cover interpolated templates, compiler errors, unsupported maintained source, native server failures, base analysis, package discovery outside the candidate directory, and cancellation of both the collector and its compiler server. CLI help and enum validation must work without starting a native server; CI installs the pinned tsrs package before real-native tests.

Timing regressions exercise real CLI work and delayed handlers, retained measurements after feedback/command timeouts, skipped verification, and base analysis outside candidate feedback. Check nested source measurement, compiler setup, diagnostics, and graph phases recursively against their enclosing duration. Assert finite nonnegative durations and tolerant relationships to wall time rather than exact timings. Normalize only elapsed values when comparing presentation across separate runs; verify primary compiler and command duration colors, muted structure, and semantic interruption states through PTYs.

The native root regression measures the full committed inventory and verifies every declared observation through the actual CLI under the saved feedback policy; complete behavior still rejects real budget/ancestry violations. A copied reference fixture selects the same complete inventory and permits a 60-second test-only window with the TypeScript engine. Neither exclusions nor fabricated evidence may hide authored code. Separate consuming-project fixtures keep unsupported Rust measured and incomplete after the obsolete prototype's deletion.

Native runtime guards trap JS compiler factories while permitting lexical parsing/scanning. Require all diagnostic categories. Known native default-library directive gaps must produce a specific incomplete result for owned and imported declarations, never a missing-diagnostic pass. Preserve full fact parity for supported valid syntax; malformed lexical ASTs may be provisional only with blocking diagnostics and no evidence.

## Verification

`bun run test` includes the executable product contracts; `bun run test:features` runs those alone.

## Child DOX Index

None. This file owns the full subtree.
