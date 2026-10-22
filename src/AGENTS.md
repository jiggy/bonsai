# Purpose

Implement Bonsai’s CLI and contract-rooted budget gate.

## Ownership

`cli.ts` owns invocation and lifecycle. `cli-interface.ts` defines flags, command metadata, help, and shared presentation rules. `cli-completion.ts` generates command-aware shell completions from that metadata. Keep both independent of project analysis so metadata commands remain fast. `init.ts` creates local configuration and unfinished contract starters from filesystem discovery. `exclusions.ts` compiles saved ignore rules and scopes initialization's Gitignore patterns. `project.ts` joins contracts, source, retention, and evidence. `policy.ts` decides acceptance. `check-diagnostics.ts` turns incomplete analysis into grouped causes, source locations, and concrete fixes while preserving raw machine facts. `self-host.ts` binds Bonsai’s feature contracts to real CLI runs in isolated projects.

## Local Contracts

Preserve the published check/explain JSON keys and 0 pass, 1 reject, 2 incomplete gate codes. Help and version never load projects or run handlers. Keep diagnostics on stderr and machine data on stdout. Candidate code must not run during explain or config inspection. Formatting remains CI automation, not an agent invocation requirement.

Deadlines include startup, stdin waits, and stdout delivery; await report writes before clearing them. Cancel blocked output on timeout or signal, and preserve the first failure status through late stream errors. Expired commands cannot succeed. File targets normalize against the project root. Recovery commands preserve effective project options and shell quoting. Bound human explanations with `--limit` (20 by default, 0 for all); machine reports stay complete. Terminal rendering uses stream-specific capabilities; canonical redirected help and generated documentation stay unstyled.

Initialization never executes project code or overwrites existing files. Capture root/nested Gitignore rules, standard generated/lock/cache exclusions, symlinks, and nested project boundaries in optional `config.exclude`; report skipped paths. Keep directories as inventory entries so future authored files count. Runtime inventory uses the effective configuration's exclusions, never mutable candidate ignore files or newly added project markers. Required starters must not be excluded. Starter contracts remain commented and draft policy defaults require calibration; initialization never manufactures passing evidence.

Incomplete human reports lead with deduplicated blockers, distinguish unrun checks, and label budget/ancestry consequences as provisional. Full JSON/plain facts remain compatible. Resolve literal dynamic imports to their selected exports; preserve unused sibling accounting. Computed module paths and computed namespace selections remain incomplete with source locations and expressions. Inventory membership covers measured JSON modules as well as TypeScript; data imports remain charged and fingerprinted without treating computed module paths as resolved.

## Work Guidance

Use the repository CLI skills for changes to the command contract and presentation. Keep policy overrides explicit and preserve trusted base rules.

## Verification

`bun run check`, `bun run test`, and `bun run demo`

## Child DOX Index

None. This file owns the full subtree.
