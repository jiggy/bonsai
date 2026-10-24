# Purpose

Implement Bonsai’s CLI and contract-rooted budget gate.

## Ownership

`cli.ts` owns invocation and lifecycle. `cli-interface.ts` defines flags, command metadata, help, and shared presentation rules. `cli-completion.ts` generates command-aware shell completions from that metadata. Keep both independent of project analysis so metadata commands remain fast. `init.ts` creates local configuration and unfinished contract starters from filesystem discovery. `exclusions.ts` compiles saved ignore rules and scopes initialization's Gitignore patterns. `project.ts` joins contracts, source, retention, and evidence. `collector.ts` checks native source facts against the TypeScript reference and manages the native subprocess. `timing.ts` records monotonic phase durations, including partial and skipped work. `binding-target.ts` validates the effective project binding target before execution. `policy.ts` decides acceptance. `check-diagnostics.ts` explains analysis blockers. `check-report.ts` groups human check reports by cause and file, bounds details with `--limit`, and selects cause-specific recovery while preserving raw machine facts. `self-host.ts` binds Bonsai’s feature contracts to real CLI runs in isolated projects.

`inventory.ts` owns filesystem scope and content fingerprints without loading the TypeScript compiler. Verification workers use this lean boundary; `source.ts` reexports its existing inventory API for compatibility.

`compiler.ts` owns bounded, process-local reuse of exact-content parsed documents through TypeScript's DocumentRegistry. Every request uses a fresh compiler host, program, filesystem resolution, and full diagnostics with unchanged options and ambient type discovery. Re-read all requested source/declaration text; package changes, newly created modules, root sets, and NodeNext parse context must remain visible. Keep only the preceding request's documents within the memory cap; do not persist analysis or evidence in a candidate-controlled cache.

## Local Contracts

Preserve the published check/explain JSON keys and 0 pass, 1 reject, 2 incomplete gate codes. Help and version never load projects or run handlers. Keep diagnostics on stderr and machine data on stdout. Candidate code must not run during explain or config inspection. Formatting remains CI automation, not an agent invocation requirement.

Deadlines include startup, stdin waits, and stdout delivery; await report writes before clearing them. Cancel blocked output on timeout or signal, and preserve the first failure status through late stream errors. Expired commands cannot succeed. File targets normalize against the project root. Recovery commands preserve effective project options and shell quoting. Bound human check details and explanations with `--limit` (20 by default, 0 for all); machine reports stay complete. Human failed check reports go to stderr, successful reports to stdout; JSON/plain gate records stay on stdout. Carry semantic roles through wrapping: red critical alerts, amber incomplete/provisional states, primary values, neutral detail, muted structure, and cyan whole commands. Quiet mode keeps errors and repairs while suppressing progress, metrics, and next-step hints. Terminal rendering uses stream-specific capabilities; canonical redirected help and generated documentation stay unstyled.

Human check summaries include elapsed time; verbose reports add measured phases. JSON includes command timing and candidate timing even without complete evidence; early errors retain partial timing on stderr. Skipped phases use null durations and interrupted phases remain explicit. Keep command setup/base work separate from candidate feedback, whose measurement and limit preserve policy semantics. Command elapsed runs from runtime clock origin through report preparation; final serialization, delivery, and cleanup are outside the normal report. Quiet suppresses timing metrics, explicit JSON retains data, and plain TSV columns stay stable.

Source timings nest retained-size measurement, compiler setup, full type checking, and dependency graph collection beneath source analysis. Rust adds its compatibility comparison. Child measurements survive parent reports and interruptions without exposing mutable internal arrays.

Static identifier and quoted registry keys identify the same action names. Computed keys, spreads, and inline handlers remain unsupported.

Initialization never executes project code or overwrites existing files. Capture root/nested Gitignore rules, standard generated/lock/cache exclusions, symlinks, and nested project boundaries in optional `config.exclude`; report skipped paths. Keep directories as inventory entries so future authored files count. Runtime inventory uses the effective configuration's exclusions, never mutable candidate ignore files or newly added project markers. Required starters must not be excluded. Starter contracts remain commented and draft policy defaults require calibration; initialization never manufactures passing evidence.

Incomplete human reports lead with deduplicated blockers, distinguish unrun checks, and label budget/ancestry consequences as provisional. Full JSON/plain facts remain compatible. Resolve literal dynamic imports to their selected exports; preserve unused sibling accounting. Computed module paths and computed namespace selections remain incomplete with source locations and expressions. Inventory membership covers measured JSON modules as well as TypeScript; data imports remain charged and fingerprinted without treating computed module paths as resolved.

The internal `project-bindings-v1` adapter recognizes only the known evidence collector's `import(target.url)`, where a const target comes directly from `projectBindingTarget` with the collector's own project/config/fingerprint parameters. Match both modules' contents to the installed checker implementation, including in archives; symbol linkage alone or filenames never authorize a loader. Validate maintained membership and fingerprint before loading; require a matching binding-import receipt in evidence. Record source provenance without granting registry-export ancestry. Other computed imports, including lookalike helpers, remain unsupported. Pass the effective configuration through the worker; never substitute candidate-local scope for trusted policy input.

`check` and `explain` accept `--engine typescript|rust`, defaulting to TypeScript. Rust is a compatibility mode: run the full TypeScript collector, compare native structural facts before allowing evidence, preserve compiler diagnostics and binding-import provenance, and retain reference ordering in matching results. Unsupported or mismatched native facts make analysis incomplete; any TypeScript facts shown then are explicitly provisional and cannot authorize acceptance. Rust-only `analysis` metadata identifies the requested engine, reference check, and match status. Both base and candidate use the selected engine; unsupported base comparisons stop before candidate verification.

Use the existing frontend for both engines. Preserve engine selection in valid recovery commands. Native workers run asynchronously with bounded output, signal cleanup, and the candidate's remaining feedback window. Resolve the default binary from the checker checkout, independently of candidate root or caller directory. Missing, crashed, or malformed workers are runtime failures; help and version never need a binary and commands never build automatically. Compatibility timings include both collectors and do not establish a migration speedup. Maintained `.rs` files consume retained cost and explicitly block unsupported source ancestry.

## Work Guidance

Use the repository CLI skills for changes to the command contract and presentation. Keep policy overrides explicit and preserve trusted base rules.

## Verification

`bun run check`, `bun run test`, and `bun run demo`

## Child DOX Index

None. This file owns the full subtree.
