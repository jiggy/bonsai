# Purpose

Verify acceptance rules and observable CLI behavior.

## Ownership

Core gate tests, subprocess CLI tests, and `self-host.test.ts`, which checks the full maintained root and exercises every root `.feature` observation through an isolated TypeScript implementation's real CLI.

## Local Contracts

Assert outputs, streams, exit codes, and candidate behavior. Check presentation regressions use real PTYs and inspect ANSI foreground/dim state on meaningful text, including wrapped continuations and independently redirected streams. Use isolated fixtures and remove them in cleanup. CLI tests must exercise the executable rather than duplicate its parser.

## Work Guidance

Preserve regression coverage for budget, ancestry, evidence identity, worker deadlines, base policy, and interrupted runs.

Timing regressions exercise real CLI work and delayed handlers, retained measurements after feedback/command timeouts, skipped verification, and base analysis outside candidate feedback. Assert finite nonnegative durations and tolerant relationships to wall time rather than exact timings. Normalize only elapsed values when comparing presentation across separate runs; verify primary duration colors and semantic interruption states through PTYs.

The full root regression preserves committed inventory and requires exactly the known unsupported Rust-source blockers, no unexpected TypeScript or loader blockers, and no fabricated evidence. Rust sources stay measured until ancestry support exists. A separate copied fixture explicitly selects the authored non-Rust inventory and permits a 60-second test-only feedback window through policy input. Require complete matching-candidate evidence for every declared observation through that fixture's real CLI; preserve budget rules and genuine retained-size rejection. Fixture success never establishes root acceptance.

## Verification

`bun run test` includes the executable product contracts; `bun run test:features` runs those alone.

## Child DOX Index

None. This file owns the full subtree.
