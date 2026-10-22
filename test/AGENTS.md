# Purpose

Verify acceptance rules and observable CLI behavior.

## Ownership

Core gate tests, subprocess CLI tests, and `self-host.test.ts`, which executes root `.feature` contracts through the evidence worker.

## Local Contracts

Assert outputs, streams, exit codes, and candidate behavior. Check presentation regressions use real PTYs and inspect ANSI foreground/dim state on meaningful text, including wrapped continuations and independently redirected streams. Use isolated fixtures and remove them in cleanup. CLI tests must exercise the executable rather than duplicate its parser.

## Work Guidance

Preserve regression coverage for budget, ancestry, evidence identity, worker deadlines, base policy, and interrupted runs.

## Verification

`bun run test` includes the executable product contracts; `bun run test:features` runs those alone.

## Child DOX Index

None. This file owns the full subtree.
