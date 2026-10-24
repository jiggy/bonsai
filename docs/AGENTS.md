# Purpose

Explain Bonsai’s supported behavior and limits.

## Ownership

Design baseline, roadmap, command reference, CLI review evidence (`check-ux-review.md`), native collector evaluation (`native-prototype.md`), performance profiling and native checker research (`performance.md`), and the distinction between executable behavior contracts and full self-budget acceptance.

## Local Contracts

Document actual commands, defaults, streams, and exit codes. Keep unsupported adapters and admission guarantees explicit. Distinguish the internal validated binding-loader boundary from general computed imports, and the full-check regression's test-only feedback window from committed root admission policy.

Keep command elapsed time, candidate phase durations, and policy feedback measurements distinct. Document timing endpoints and partial/interrupted measurements; profiling doesn't change acceptance or deadline limits.

Keep native structural parity separate from TypeScript diagnostics and runtime evidence. Label benchmark process reuse, timing endpoints, workloads, and engine responsibilities; never present structural-only timing as an equivalent full-gate speedup. The default CLI remains TypeScript, and authored Rust stays measured with explicit unsupported analysis until an adapter exists.

Document `--engine rust` as strict compatibility mode through the shared Bun frontend. It runs the full TypeScript reference, blocks native unsupported analysis or mismatches, and may be slower. Preserve the distinction between per-input fact validation, presentation consistency, and universal behavioral equivalence; no default migration follows from structural benchmarks alone.

## Work Guidance

Update CLI reference and migration notes with behavior changes.

## Verification

Compare examples with `bun run bonsai --help` and the executable

## Child DOX Index

None. This file owns the full subtree.
