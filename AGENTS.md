# Working on Bonsai

Read README.md and docs/design.md before changing behavior. Bonsai should embody its own restraint: prefer one small package and concrete adapters over speculative extension machinery.

Preserve these invariants:
- Surface deduplication never removes verification obligations.
- Tests cannot root otherwise unsupported production code.
- Unrooted source still consumes the full retained budget.
- Missing or mismatched evidence cannot produce a pass.
- A reachable wrapper receives no cost discount.
- No per-feature grants or accumulated allowance ledgers.

Use Bun by default for dependency installation and package scripts. Install with `bun install --frozen-lockfile`; keep `bun.lock` current and do not generate npm lockfiles. Bun also runs the CLI, tests, and verification workers.

Run `bun run check`, `bun run test`, and `bun run demo`. Add behavioral tests for changes to acceptance or graph propagation. Do not claim broader framework or verification support than the collector actually supplies. Keep README limitations current.
