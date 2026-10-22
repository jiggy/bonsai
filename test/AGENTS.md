# Purpose

Verify acceptance rules and observable CLI behavior.

## Ownership

Core gate tests and subprocess CLI tests.

## Local Contracts

Assert outputs, streams, exit codes, and candidate behavior. Use isolated fixtures and remove them in cleanup. CLI tests must exercise the executable rather than duplicate its parser.

## Work Guidance

Preserve regression coverage for budget, ancestry, evidence identity, worker deadlines, base policy, and interrupted runs.

## Verification

`bun run test`

## Child DOX Index

None. This file owns the full subtree.
