# Purpose

Verify acceptance rules and observable CLI behavior.

## Ownership

Core gate tests, subprocess CLI tests, and `self-host.test.ts`, which checks the complete maintained root and an archived copy through the native CLI. `reference.ts` and `compiler.ts` own the independent development TypeScript oracle and bounded compiler-session regressions; neither ships in the npm package.

`cli.ts` supplies fixed-entry CLI launches and environment defaults. `runCli` returns raw results; an explicit `env` replaces defaults. `project.ts` writes provided fixture sources and policy. `terminal.ts` supplies PTY probing, quoting, and ANSI state. Keep specialized async, copied-checker, and PTY lifecycle handling local.

## Local Contracts

Assert outputs, streams, exit codes, and candidate behavior. Check presentation regressions use real PTYs and inspect ANSI foreground/dim state on meaningful text, including wrapped continuations and independently redirected streams. Use isolated fixtures and remove them in cleanup. CLI tests must exercise the executable rather than duplicate its parser.

## Work Guidance

Preserve regression coverage for budget, ancestry, evidence identity, worker deadlines, base policy, and interrupted runs.

Contract compilation regressions preserve every outline row and exact observation IDs/source lines when features are duplicated or split. Use the production Gherkin path; generated AST IDs stay local to each feature file.

Source-analysis and CLI regressions must exercise the production Rust collector or actual CLI; pure-module tests call the corresponding production functions directly. Use the independent TypeScript oracle as an additional comparison, never as the only execution path for a source behavior. Reference-only compiler/session tests may verify the oracle itself. Source conformance includes repeated literal imports, dot and quoted selections, ordinary strings/property references, and unused-export ancestry.

`package-install.test.ts` checks prebuilt target selection without network access. `bun run test:package` additionally packs and installs the production tarball in an isolated consumer with a fresh cache and scripts disabled, then exercises `bunx` and missing-dependency recovery. Only this explicit release check uses the package registry.

`subprocess-ancestry.test.ts` compares complete native source facts with the development oracle and exercises real child execution plus read-only explain. Preserve unused-export, uncontracted launch, test-to-production, builtin/global shadowing, launch-option, and missing-inventory regressions. Test-helper subject discovery must handle chains and cycles without propagating inherited support ancestry into unrelated tests or dead production.

Compiler-session regressions compare fresh diagnostics and source facts after changes to source, external declarations, package resolution, missing dependencies, and project roots. Reusing syntax must never authorize stale diagnostics or relationships. The lean-worker regression runs a real handler in a fresh evidence subprocess and checks that inventory validation alone does not load the TypeScript compiler.

Native CLI regressions compare default commands with the `--engine rust` compatibility spelling, preserving real pass/reject reports, evidence, streams, and presentation after normalizing measured durations. Reject `--engine typescript` without running handlers. Compare source facts independently with the development oracle; production never runs a reference pass. Cover interpolated templates, compiler errors, unsupported maintained source, native server failures, base analysis, package discovery outside the candidate directory, and cancellation of both the collector and its compiler server. CLI help and enum validation must work without starting a native server; CI installs the pinned tsrs package before real-native tests.

`native-installation.test.ts` uses the real pinned SDK in an isolated checker without platform packages, preserving actual host detection. Cover supported missing-package versus unsupported-platform repairs, ignored upstream overrides, invalid explicit overrides, JSON/human/quiet streams, and blocked handler execution. CI runs these on Intel and Apple Silicon macOS; a configured `BONSAI_NATIVE_BINARY` also requires real native analysis and passing evidence with the matching compiler version. The multi-command case has an explicit 30-second test timeout, and targeted CI uses the same isolation and timeout as the full suite.

Timing regressions exercise real CLI work and delayed handlers, retained measurements after feedback/command timeouts, skipped verification, and base analysis outside candidate feedback. Check nested source measurement, compiler setup, diagnostics, and graph phases recursively against their enclosing duration. Assert finite nonnegative durations and tolerant relationships to wall time rather than exact timings. Normalize only elapsed values when comparing presentation across separate runs; verify primary compiler and command duration colors, muted structure, and semantic interruption states through PTYs.

The native root regression measures the full committed inventory and verifies every declared observation through the actual CLI under the saved feedback policy; complete behavior still rejects real budget/ancestry violations. Both root regressions require exact observation IDs, fingerprints, loader receipts, the CLI/evidence/native-worker entry-point relationships, and ancestry for every `src/` implementation component. CI sets the test-only `BONSAI_SELF_CHECK_REPORT` path to save the real native report before assertions, including failed assertions' data; it is not a CLI configuration option. A copied archive fixture selects the same complete inventory and uses the same saved 15-second native deadline. Neither exclusions nor fabricated evidence may hide authored code. Separate consuming-project fixtures keep unsupported Rust measured and incomplete after the obsolete prototype's deletion.

Native runtime guards trap JS compiler factories while permitting lexical parsing/scanning. Require all diagnostic categories. Known native default-library directive gaps must produce a specific incomplete result for owned and imported declarations, never a missing-diagnostic pass. Preserve full fact parity for supported valid syntax; malformed lexical ASTs may be provisional only with blocking diagnostics and no evidence.

Lazy project startup regressions compare configuration values, object prototypes, validation, and exact syntax diagnostics with the reference parser. A runtime module-load guard must reject TypeScript in standard-config native CLI parents while allowing and observing its semantic-worker load. Prove the guard with a direct compiler-module load and JSONC fallback controls; metadata-only configuration inspection remains compiler-free for standard JSON.

Native session regressions prove lexical-worker reuse without sharing action results or application modules. Compare warm source facts against fresh reference analyses through edits to owned source, external declarations, import targets, and maintained roots. Exercise actual repeated stateful actions, separate owner scopes, caller-relative binary overrides, and changed runtime options; context changes must retain the fresh-worker behavior.

Package-install regressions must pack the actual npm payload and verify native checks outside the checkout with production dependencies, scripts disabled, a fresh Bun cache, and no native override. Help/version must remain usable without starting a server; missing optional packages and unsupported targets need actionable repairs.

Use asynchronous child invocations while a test owns the broker, so its event loop can serve requests. Protocol regressions cover busy-worker fallback through the real CLI, per-request diagnostic bounds, malformed identities and facts, worker death before acknowledgment, cancellation, and owner death after warm startup. A delayed native proxy must prove successful requests wait for process exit and cancellation still reaps it after the SDK clears its process field. Keep application call counts and process identities observable without changing compiler module contents.

## Verification

`bun run test` includes the executable product contracts and gives each test file a fresh module/global scope with Bun's `--isolate`; tests remain sequential. This prevents compiler-oracle and worker lifecycle state from being shared across files. It does not extend any product feedback deadline. `bun run test:features` runs the product contracts alone.

## Child DOX Index

None. This file owns the full subtree.
