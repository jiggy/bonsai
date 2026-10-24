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

`model.ts` defines their shared facts. `project.ts` joins collection, `binding-target.ts` validates the configured registry target against its measured snapshot, `timing.ts` retains monotonic phase durations, and `worker.ts` hosts execution. There is no database, daemon, LLM call, or external service.

## Initial adapter choices

TypeScript was selected because the repository had no existing language stack and its compiler supplies symbol resolution. Gherkin uses the official Cucumber parser and pickle compiler; Bonsai deliberately supports a small executable grammar instead of implementing a second general test runner.

A literal `export const actions = { 'external-action': namedHandler }` is both executable registration and static connection. Generic response observations are implemented by Bonsai. This avoids a handwritten feature manifest and makes every supported assertion visible to the collector.

Production traversal precedes test association. Edges out of the action registry do not root every registered handler: only actions actually referenced by the contracts supply production roots. Lower-level test associations propagate into test support, without opening a second traversal into production.

`pass`, `reject`, and `incomplete` remain distinct. Incomplete takes precedence when both missing analysis and measured violations exist; all violations remain in the report.

Initialization captures project Gitignore patterns and proposed exclusions in the
configuration, including boundaries around nested Bonsai projects. Inventory uses
those saved rules from the effective policy source. Candidate ignore-file edits
or new nested project markers cannot silently narrow a trusted base inventory.

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

## Self-verification

Root `.feature` files specify observable Bonsai behavior; executable bindings run
the real CLI against isolated projects. The normal suite checks the committed root
inventory and requires exactly the known unsupported Rust source blockers, with no
evidence collected. A second check copies the explicitly selected non-Rust inventory
into an isolated fixture and invokes its actual CLI. That supported-scope check
requires successful source analysis and every required observation through the
evidence worker. Its test-only 60-second feedback window preserves the size budget;
genuine budget violations still reject.

Literal dynamic imports resolve selected exports without retaining unused siblings.
The internal binding-loader adapter recognizes only this checker's collector and
target implementations, matching module contents and symbol linkage even in archived
copies. Runtime validation checks inventory membership and the
effective snapshot fingerprint before importing; acceptance requires the matching
adapter, binding path, and fingerprint receipt. The source boundary retains its
location without granting registry-wide handler ancestry. Other computed imports
remain incomplete, and subprocess entry-point ancestry requires further adapters.
The root's saved 15-second feedback ceiling and retained-code limits remain in
force; passing the regression does not assert full root acceptance.

## Native collector prototype

An experimental Rust/Oxc collector implements the source-fact boundary alongside
the default TypeScript engine. `check --engine rust` and `explain --engine rust`
use the existing Bun CLI and presentation in strict compatibility mode. The Rust
binary is built separately from a source checkout. Versioned JSONL requests carry
the measured inventory and binding path; responses contain structural facts,
explicit problems, and collection time. The binary declares TypeScript diagnostics
as not run and provides no runtime evidence.

Compatibility mode runs the full TypeScript reference collector and its diagnostics
on the same input. Only matching native source facts may continue to verification.
Unsupported native analysis and mismatches keep the gate incomplete; TypeScript
facts may supply provisional reporting but cannot authorize a fallback pass.
Runtime worker failures use the CLI's existing error path. Engine selection applies
to base and candidate analysis and remains explicit in recovery commands. Optional
analysis metadata records the Rust engine, reference validation, and match status.

Differential fixtures compare exact supported facts and derived policy results
under the same assumed observations. Those observations test the evaluator and
cannot establish acceptance. Separate benchmarks measure the full TypeScript
collector, native structural collector, and TypeScript diagnostics alone, with
fresh-process and persistent-process samples. Their responsibilities differ, so
these timings do not establish an equivalent full-gate speedup. Strict compatibility
mode deliberately runs both collectors and can be slower than the default.

Authored Rust remains in the maintained inventory and receives explicit unsupported
source-language diagnostics from the default collector. Generated build output is
excluded. Adoption requires broader parity, preserved diagnostic and evidence
guarantees without repeating the full reference collector, a Rust ancestry adapter,
and measured improvement of complete checks under the saved policy. See
[the prototype protocol, scope, and commands](native-prototype.md).

## Deliberate gaps

The original design calls for broader evidence and trusted CI integration than this first adapter provides. The README documents the executable scope precisely. Keep unsupported capabilities incomplete or explicitly outside the configured deployment scope; do not manufacture passing coverage, mutation, unit-runner, or framework evidence.

A policy change is an explicit change to the rules. Loading base policy is useful but does not make a candidate-controlled executable trustworthy. A production merge gate must obtain its checker and effective policy independently, review scope and inventory changes, and run candidate code in suitable isolation.
