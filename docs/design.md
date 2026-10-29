# Design baseline

Derived from the supplied “Define Complexity Budgets” discussion, dated 2026-10-20. This records the final direction rather than the alternatives explored earlier in that discussion.

## Principles

Code is a maintained liability. Product behavior, implementation ancestry, and verified outcomes together justify retention; raw activity and additional abstractions do not. The tool should give the existing coding agent a concrete constraint and evidence it can inspect. It should itself stay small.

1. Use one global ceiling derived from the current contract set. Do not introduce feature allocations, accumulated grants, budget reservations, or a negotiation service.
2. Count unique external action–observation pairs across executable specifications. File boundaries, prose, concrete values, and extra examples earn no extra allowance.
3. Keep every individual behavioral obligation. Deduplicating surface must never deduplicate required verification.
4. Establish production ancestry from contracts first. Lower-level tests inherit that ancestry; they cannot grant product scope to otherwise unused code.
5. Measure retained material independently of ancestry, counting shared material once at its full cost. A popular wrapper can still be removed.
6. Compaction only creates capacity after an actual candidate change demonstrates lower retained cost while preserving required behavior.
7. Keep authored inputs to executable `.feature` files, ordinary bindings and registrations, and one project policy. Generate the inventory, graph, evidence associations, ancestry, and decisions.
8. Missing analysis or verification blocks acceptance. Spare size allowance never overrides failed quality requirements.
9. Trust acceptance rules independently of the candidate, and evaluate the combined merge candidate before merging.
10. Product judgment still decides whether a new external promise is warranted. No deterministic counter can settle that question.

## Development contract

[The BDD workflow](bdd.md) governs development of Bonsai and the workflow taught
to consuming agents. Discover and agree on stakeholder rules and distinguishing
examples before selecting test mechanics. Product specifications express context
and consequences that survive a replacement implementation. Gherkin, a real CLI,
public JSON, and red/green or fault evidence alone do not establish that level.

Reviewed product observations supply one global allowance; the current engine
still counts literal normalized action–selector pairs. Human review must reject
incidental implementation metadata and aliases as product scope. No semantic
counter or additional allowance ledger is implied. Use stable public actions.

Use meaningful red/green/refactor for new behavior and green controls with
controlled violations for specifications added retrospectively. Keep technical
proofs in the relevant tests, preserving their assertions when migrating them
out of features. Report surface and allowance changes separately from retained
code savings. Keep specification support outside published runtime sources, and
preserve product promises unless their scope change is authorized. Complete
behavior evidence, structural ancestry, retained size, and trusted admission
remain separate claims.

## Internal boundaries

One package, with six principal modules:

| Module | Responsibility |
| --- | --- |
| `contracts` | Compile Gherkin into unique surface pairs and individual required checks. |
| `source` | Inventory maintained material, measure retained size, resolve TypeScript symbol references and literal handler registrations. |
| `evidence` | Execute required checks and report candidate-bound outcomes and feedback time. |
| `retention` | Generate contract ancestry and expose unsupported components and relationship sources. |
| `policy` | Pure evaluation of candidate facts under the configured ceiling and admission requirements. |
| `cli` | Collect facts, compare a base, explain components, and return actionable output. |

`model.ts` defines their shared facts. `project.ts` joins collection, `inventory.ts` supplies filesystem scope and fingerprints without loading the compiler, `binding-target.ts` validates the configured registry target against its measured snapshot, `timing.ts` retains monotonic phase durations, and `worker.ts` hosts execution. `compiler-options.ts` defines the native and development oracle's shared options. `features/support/` owns development acceptance arrangements and actual CLI launches; `test/compiler.ts` and `test/reference.ts` own the separate JavaScript compiler oracle. Neither belongs to the published runtime. There is no database, persistent daemon, LLM call, or external service.

## Initial adapter choices

TypeScript was selected because the repository had no existing language stack and its compiler supplies symbol resolution. Gherkin uses the official Cucumber parser and pickle compiler; Bonsai deliberately supports a small executable grammar instead of implementing a second general test runner.

A literal `export const actions = { 'external-action': namedHandler }` is both executable registration and static connection. Generic response observations are implemented by Bonsai. This avoids a handwritten feature manifest and makes every supported assertion visible to the collector.

Production traversal precedes test association. Edges out of the action registry do not root every registered handler: only actions actually referenced by the contracts supply production roots. Lower-level test associations propagate into test support, without opening a second traversal into production.
Subject discovery follows test-helper references to already rooted production,
independently of ancestry granted to supporting tests. A shared assertion helper
cannot pass its inherited ancestry back to unrelated callers.

`pass`, `reject`, and `incomplete` remain distinct. Incomplete takes precedence when both missing analysis and measured violations exist; all violations remain in the report.

Initialization captures project Gitignore patterns and proposed exclusions in the
configuration, including boundaries around nested Bonsai projects. Inventory uses
those saved rules from the effective policy source. Candidate ignore-file edits
or new nested project markers cannot silently narrow a trusted base inventory.

## Verification execution profiles

`check` defaults to `isolated-scenarios-v1`: independent scenarios may overlap,
with one worker per runtime-reported available CPU, bounded by the scenario count.
Each scenario gets a fresh application subprocess and module cache; its steps
remain sequential. Files, databases, and services are still shared resources.

`check --serial` selects `in-process-v1`: all scenarios run in contract order in
one fresh application subprocess, retaining module state within that run. This
is an invocation choice; project configuration contains no execution-mode or
worker-count setting. Even a one-worker concurrent plan keeps per-scenario
isolation, so shared-state suites must explicitly use `--serial`.

Both profiles require every observation and retain deterministic result ordering.
All workers use one feedback deadline, including startup and cleanup; an
interrupted or incomplete worker cannot produce accepted evidence. Snapshots
record the selected runtime profile and worker count, and the evaluator requires
evidence with that profile. The maintained content and effective project policy
remain fingerprinted independently of the invocation's execution mode.

Versioned snapshots and product evidence also carry installed checker/toolchain
content and Bun/preload identities. Application workers compare checker/runtime content before
loading bindings and carry the validated analysis compiler receipt; the final
integrity phase detects later content changes.
Structural-only facts can omit identity, but they cannot satisfy acceptance.

An effective configuration can additionally require concrete supporting runners.
Their commands share the same feedback deadline and must replace prior reports.
Vitest assertions, Cucumber execution messages, coverage counts, and Stryker
mutation results remain separate evidence facts. Missing or insufficient configured
results block the one evaluator; they never create ancestry or allowance. See
[supporting verification](verification.md) for actual format/runtime boundaries.

## Timing boundaries

The command profile measures elapsed wall time from the runtime clock origin through
report preparation, with separate stages for setup, base work, configuration,
candidate collection and verification, and evaluation. Final serialization, output
delivery, and cleanup follow that reported total. Candidate timings nest within
the command profile; base work stays outside candidate feedback.

The parent retains partial measurements when verification or the command is
interrupted. Completed phases retain durations, interrupted work retains its elapsed
duration, and skipped work has a null duration. Timing facts remain available when
no complete verification evidence exists and cannot substitute for that evidence.
The separate feedback measurement preserves its policy boundary before the final
integrity check; collecting timings never changes a limit or gate decision.

Source analysis nests retained-size measurement, compiler setup, type checking,
and dependency graph collection. Rust records native worker overhead separately. These child phases remain available in parent reports,
including partial failures.

## Self-verification

Root `.feature` files specify observable Bonsai behavior; executable bindings run
the real CLI against isolated projects. The root uses the same automatic concurrent
execution as consuming projects; its actions own separate temporary projects.
The native root check measures the complete
committed inventory and requires every observation under the saved feedback
policy. Nested check/explain commands use the same sole native engine. A copied
archive fixture checks the same full inventory under the saved 15-second window.
Both preserve the budget and must reject genuine retained-size violations. The retired prototype was deleted, without exclusions or a claim of
Rust source ancestry support.

The root's size overage is deferred during stabilization. Both regressions require
ancestry for every retained component and allow only that budget violation.
Development comparison and benchmark tools live under `test/native/`: their
actual references to already-contracted production establish test ancestry,
without allowing tests to justify unrelated production code. Maintained test
subprocess entries expose their real dependencies to the same graph collector.
The maintained `native/README.md` migration note preserves the directory selected
by historical policies while the tools remain measured under `test/`.

Literal dynamic imports resolve selected exports without retaining unused siblings.
The internal binding-loader adapter recognizes only this checker's collector and
target implementations, matching module contents and symbol linkage even in archived
copies. Runtime validation checks inventory membership and the
effective snapshot fingerprint before importing; acceptance requires the matching
adapter, binding path, and fingerprint receipt. The source boundary retains its
location without granting registry-wide handler ancestry. Other computed imports
remain incomplete.

The fixed subprocess adapter resolves literal module-relative URLs and immutable
`fileURLToPath` path aliases at named `node:child_process` calls. It authorizes the
default Bun/Node runtime, never a shell or overridden executable. Launch locations
supply static `entry-point` edges to executable top-level statements and immediately
effectful initializers in the maintained child module. Inert exports stay unrooted.
These relationships connect the self-host CLI, evidence worker, and native lexical
worker without new authored manifests or runtime-evidence receipts. Computed or
cwd-relative targets receive no relationship; recognized targets outside the measured
TypeScript inventory block verification. General import side effects and class
initialization remain separate adapter gaps.

The full-root regressions require exact observation IDs, candidate fingerprints,
binding receipts, and all three executable boundaries. CI archives the native
regression report for evidence and timing comparisons without running another check.
The root's saved 15-second feedback ceiling and retained-code limits remain in
force; passing the regression does not assert full root acceptance.

## Native semantic backend

`check` and `explain` use the pinned tsrs compiler for
program construction, all compiler diagnostic categories, and symbol resolution.
The existing Bun frontend launches a Bun semantic worker using tsrs's asynchronous
SDK. `--engine rust` remains a compatibility spelling; other engines are rejected.
No TypeScript reference compiler ships in the runtime sources. TypeScript's lexical
scanner and source parser still supply the exact metric and local ASTs; shared
Bonsai rules consume native semantic facades. Batched symbol and type queries
avoid a request for each identifier. Owned and imported declarations are resolved
back to source locations without granting unused exports ancestry.

The native CLI parent defers compiler dependencies to its semantic worker.
Standard JSON configuration objects use equivalent native parsing; JSONC,
malformed input, and unusual property keys retain the reference parser and exact
diagnostics. Contract compilation loads inside its measured phase. These startup
changes do not cache action results. Concurrent verification isolates scenarios;
`--serial` preserves ordered scenarios with shared modules in a fresh process.

Native verification opens a private local broker scoped to that invocation.
The isolated profile owns a broker per execution lane, avoiding contention between
its concurrent scenarios. Matching nested CLI processes reuse that lane's Bun
lexical worker, which starts lazily.
Each request creates and closes its own SDK and native compiler process, using
fresh programs, file reads, diagnostics, and source maps. Application modules and
runtime evidence remain isolated in fresh verification processes. The broker
does not cache source facts or action responses. Simple projects without nested
native requests never start another semantic worker.

Worker reuse requires the same installed checker, selected binary, and compiler
environment, including runtime preload options. Private CLI settings and cosmetic
output controls do not change the compiler context. Lazy startup uses the captured
environment rather than later mutations in the owning process.
An explicitly busy worker permits concurrent callers to use their ordinary fresh
native path; broken matching sessions fail explicitly. Request identities and
collector validation acknowledgments prevent stale or malformed output from
becoming another request's facts. Cancellation retires the active worker and its
compiler; owning verification closes the broker and sockets before completing.
The existing command and feedback deadlines include this work. The session is
private execution context, not a user configuration or a persistent cache.

The adapter supplies the same explicit root files and preserves the reference's
ambient type discovery. TypeScript 5.9 and tsrs's pinned TypeScript 7 compiler are
not universally equivalent. Known default-library directive differences and local
parser gaps produce explicit incomplete analysis, never a fallback pass. Compiler
diagnostics, unsupported inputs, and interrupted analysis prevent verification.

The parent validates protocol identity, complete diagnostic categories, source
facts, and timing shapes. It bounds output and deadlines, requests graceful worker
cancellation so the compiler is killed and reaped, and forces process-group cleanup
if necessary. Missing or broken installations use the existing CLI error path.
Native metadata records the backend, pinned version, native diagnostic validation,
and completion state. Base and candidate both use the native checker.

Development comparisons run the TypeScript reference separately on identical
inputs, comparing diagnostics, token costs, graph facts, ancestry, and policy
results. Real CLI tests require candidate-bound observations. Fresh-process
benchmarks record completed checks and actual evidence as well as timings; an
incomplete run cannot establish a completed-gate speedup. Native benchmark protocol 3
records repeated-run consistency and completion without comparing identical runtime
aliases as different engines. See [native scope and commands](native-prototype.md).

## Deliberate gaps

The original design calls for broader evidence and trusted CI integration than this first adapter provides. The README documents the executable scope precisely. Keep unsupported capabilities incomplete or explicitly outside the configured deployment scope; do not manufacture passing coverage, mutation, unit-runner, or framework evidence.

A policy change is an explicit change to the rules. Loading base policy is useful but does not make a candidate-controlled executable trustworthy. A production merge gate must obtain its checker and effective policy independently, review scope and inventory changes, and run candidate code in suitable isolation.
