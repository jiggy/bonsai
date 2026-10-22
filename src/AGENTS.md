# Purpose

Implement Bonsai’s CLI and contract-rooted budget gate.

## Ownership

`cli.ts` owns invocation and lifecycle. `cli-interface.ts` defines flags, command metadata, help, completion scripts, and shared presentation rules. Keep it independent of project analysis so metadata commands remain fast. `project.ts` joins contracts, source, retention, and evidence. `policy.ts` decides acceptance.

## Local Contracts

Preserve the published check/explain JSON keys and 0 pass, 1 reject, 2 incomplete gate codes. Help and version never load projects or run handlers. Keep diagnostics on stderr and machine data on stdout. Candidate code must not run during explain or config inspection. Formatting remains CI automation, not an agent invocation requirement.

## Work Guidance

Use the repository CLI skills for changes to the command contract and presentation. Keep policy overrides explicit and preserve trusted base rules.

## Verification

`bun run check`, `bun run test`, and `bun run demo`

## Child DOX Index

None. This file owns the full subtree.
