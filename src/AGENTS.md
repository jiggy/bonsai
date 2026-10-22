# Purpose

Implement Bonsai’s CLI and contract-rooted budget gate.

## Ownership

`cli.ts` owns invocation and lifecycle. `cli-interface.ts` defines flags, command metadata, help, and shared presentation rules. `cli-completion.ts` generates command-aware shell completions from that metadata. Keep both independent of project analysis so metadata commands remain fast. `project.ts` joins contracts, source, retention, and evidence. `policy.ts` decides acceptance.

## Local Contracts

Preserve the published check/explain JSON keys and 0 pass, 1 reject, 2 incomplete gate codes. Help and version never load projects or run handlers. Keep diagnostics on stderr and machine data on stdout. Candidate code must not run during explain or config inspection. Formatting remains CI automation, not an agent invocation requirement.

Deadlines include startup and stdin waits; expired commands cannot succeed. File targets normalize against the project root. Recovery commands preserve effective project options and shell quoting. Bound human explanations with `--limit` (20 by default, 0 for all); machine reports stay complete. Terminal rendering uses stream-specific capabilities; canonical redirected help and generated documentation stay unstyled.

## Work Guidance

Use the repository CLI skills for changes to the command contract and presentation. Keep policy overrides explicit and preserve trusted base rules.

## Verification

`bun run check`, `bun run test`, and `bun run demo`

## Child DOX Index

None. This file owns the full subtree.
