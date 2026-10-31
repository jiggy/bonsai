# Purpose

Specify the developer outcomes and domain rules that make Bonsai useful, through executable Gherkin examples.

## Ownership

`adoption.feature` covers Python/Rust teams connecting native bindings with the same admission gate. Its Rust example uses an explicitly installed pinned toolchain and the existing check exit/status observations; grouping native adoption keeps cold-start work early without granting execution-order semantics between isolated scenarios. `check.feature` covers trustworthy admission, executable behavior, and reviewed control-flow nesting limits. `accounting.feature` specifies allowance, required calls, and compaction under unchanged rules. `ancestry.feature` covers production justification and reviewed policy scope. `evidence.feature` specifies required execution, freshness, shutdown, and rejection of candidate attempts to rewrite verification outcomes. `project.feature` covers safe adoption; `ux.feature` covers useful diagnostics and automation. `inspect.feature` covers read-only answers; `discover.feature` covers help, version, and usable completion. `github-action.feature` covers a maintainer's PR allowance gate, including base-policy integrity and incomplete verification. Its canonical public action is the reusable repository identity `jiggy/bonsai`.

Root `bonsai.bindings.ts` connects stable public command identities to `support/actions.ts`.

`report.feature` covers saving a check for later HTML inspection while retaining rejected or incomplete decisions and clean machine-readable output.

Technical compiler, parser, protocol, schema, scheduling, and presentation regressions belong in `test/`. They preserve detailed proof without adding product allowance.

## Local Contracts

Start with the stakeholder, meaningful context, rule, and observable consequence. A scenario must remain valid after an internal redesign preserving that promise. Use the minimum examples that distinguish the rule, including important user-facing failures and boundaries. Real CLI execution and Gherkin alone do not establish this bar.

Assert actual public results or independently observed effects. Preserve product promises and technical regression coverage when moving assertions between layers; name the technical destinations in review. Do not retain an internal assertion in a feature merely because it used to be there. Surface deduplication must still preserve every observation declared by the qualifying contracts.

Review every action–observation pair for product significance: the engine only counts literal names and normalized selectors. Public JSON visibility does not qualify a field automatically. Cases, files, technical proof artifacts, and aliases do not establish more product scope. Keep command identities stable and make fixture context understandable in the feature's prose. Helpers arrange, execute, and observe; they must not calculate expected verdicts, fabricate evidence, or hide internal assertions behind friendlier names. Follow [the BDD workflow](../docs/bdd.md).

## Work Guidance

Cover successful and blocking user outcomes. Backend identity, exact parser strings, incidental token goldens, ANSI numbers, report offsets, and exhaustive syntax permutations belong in technical regressions. Public domain facts such as the budget and a uniquely requested component remain legitimate observations. Keep actual unsupported analysis and root budget failures visible.

Default verification keeps scenarios independent and completes every required observation; `--serial` preserves shared state across ordered scenarios. Actual completion and shutdown belong in product examples. CPU sizing, held-worker progress, shard identities, queue bounds, and protocol permutations retain direct scheduling regressions, including on a one-CPU machine.

## Verification

`bun run test:features` verifies that the committed contracts execute and their assertions pass.

## Child DOX Index

- [support/AGENTS.md](support/AGENTS.md): disposable projects, real CLI launches, factual observations, and public command bindings.

The coverage example in `evidence.feature` requires the selected production-file scope to be represented even when a narrower report claims 100%. Exact report paths, count recomputation, erased syntax, and metadata shapes remain technical regressions.
