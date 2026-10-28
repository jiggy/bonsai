---
name: bonsai
description: "Bonsai: use when adopting a complexity budget in a project, implementing changes in a Bonsai-gated codebase, or resolving a rejected or incomplete Bonsai check."
---

# Work within Bonsai

Keep required product behavior within the project's retained-code allowance. Use measured changes to earn headroom.

## 1. Establish the gate

Locate the project's agent instructions, `bonsai.json`, executable bindings, and existing Bonsai command or CI invocation. Identify the effective policy, maintained inventory, checker checkout/version, and base revision used for acceptance.

For first-time adoption, read [Set up a project](references/adoption.md). Finish that branch with a passing baseline and a demonstrated rejection before returning here.

Use the installed checker's `--help` and README for its supported commands and adapter. This skill targets the current TypeScript adapter with named in-process handlers. Its `check` executes application code; use the project's approved execution environment.

**Done:** you can name the exact command, inventory, and policy governing this change. Record any gap between the requested project scope and what the adapter can analyze.

## 2. Measure the starting point

Run the project's gate with JSON output. If no wrapper exists, use a separate Bonsai checkout:

```sh
bun run --cwd "$BONSAI_DIR" --silent bonsai check --root "$PROJECT_DIR" --json
```

`BONSAI_DIR` is the absolute checker checkout; `PROJECT_DIR` is the absolute consuming-project root. Preserve any `--base` or `--policy` arguments required by the project's acceptance command. Read the exit status and the report: normal results contain `decision` and `snapshot`; setup errors report `status: incomplete` with a string `error` and actionable metadata on stderr.

Record retained size, ceiling, required reduction, contract surface, violations, and individual required-check outcomes. A pre-existing failure remains a blocker to claiming acceptance.

**Done:** the starting result and every reported blocker are accounted for. If execution is unavailable, record the concrete missing prerequisite and continue work that does not depend on its result.

## 3. Specify, implement, and prune

Discover the stakeholder rule before choosing selectors: whose problem does it solve, in what situation, and with what observable consequence? Agree on the fewest examples that distinguish the rule and its important boundaries. Their meaning should survive a replacement implementation. Safety and rejection cases qualify when users depend on them. Gherkin, public JSON, actual application execution, and red/green alone do not establish BDD.

Put those rules and expected outcomes in executable contracts connected to actual application handlers. Explain context in feature prose; fixture identifiers alone cannot carry the requirement. Keep canonical public actions and domain observations. Do not replace technical fields with friendly aliases or an opaque `scenarioPassed` oracle. See [the adoption example](references/adoption.md#4-connect-one-real-behavior) for the supported invocation/response grammar; arbitrary `Given` steps do not execute.

For new or changed behavior, write or reuse the acceptance example before implementation. Run it and identify a failure caused by the missing or incorrect product behavior; a broken fixture, missing binding, or unavailable checker does not establish that red step. Implement the smallest passing change, then refactor under the same observations. Use the project's focused acceptance runner when available, followed by the complete Bonsai gate.

When specifying behavior that already works, establish a green control and use an isolated, reversible product fault or rejection probe to show that the intended observation detects the violation. Restore and rerun the control. Report this as retrospective coverage rather than claiming a spec-first failure. Fault sensitivity establishes detection of that fault, not BDD quality. Fixtures arrange, execute, and observe domain facts; they must not calculate expected verdicts or manufacture passed checks.

Keep implementation identities, incidental report layout, compiler diagnostics, protocol details, and performance proofs in technical tests. A public compatibility promise can warrant a product feature, but field visibility alone cannot. Preserve product promises and technical regression assertions during migration: record the tests receiving moved assertions and run them. Do not simply delete checks or retain technical features for headroom. Removing a product promise requires an authorized scope change.

Bonsai counts every maintained `.feature` file, including one placed under `test/`. Keep technical cases in test-source data or disposable generated projects rather than moving them to another maintained `.feature` path. The technical tests and support themselves remain charged.

For a refactor or technical regression with no product behavior change, say so and use the relevant tests. Do not invent a new product feature for that work.

Retain code through contract ancestry. Before adding an abstraction, inspect the existing dependency path for a smaller extension. For an unnecessary layer, rewire its callers, preserve meaningful assertions, and remove the obsolete code and exclusive support together.

Reviewed product observations supply one global allowance. The checker currently counts literal action names paired with normalized selectors; it cannot identify semantic equivalence or distinguish product promises from technical proof artifacts. Audit every added pair against its stakeholder rule. Test counts, fixture names, and aliases do not qualify as new capabilities; there is no second allowance ledger. Every product observation remains required. Technical tests grant no product scope and cannot justify otherwise unrooted production code. Ancestry is structural, not proof of behavioral completeness.

Keep the governing inventory and policy intact while implementing ordinary features or compaction. Treat a requested rule change as an explicit policy change, with its effect reported separately. Never manufacture external promises or remove required assertions to obtain a pass.

**Done:** the stakeholder rule and examples meet that review bar, meaningful red/green or control/probe evidence is recorded, moved regression assertions retain verified destinations, and added retained components have contract connections. Report surface/allowance changes separately from actual code savings; moving assertions can lower allowance without reducing retained code.

## 4. Resolve the verdict

Rerun the same gate against the changed candidate. Use its result to choose the next action:

| Result | Action | Completion criterion |
| --- | --- | --- |
| `reject`: size | Reclaim at least `requiredReduction` through actual deletion, inlining, consolidation, or a smaller implementation. Whole-file retained totals determine savings. | A fresh measurement fits the ceiling. |
| `reject`: ancestry | Run `explain` for each reported component. Delete unsupported scope, repair its real executable connection, or restore a contract required by the authorized behavior. | Every retained component has contract ancestry. |
| `reject`: assertion or feedback time | Repair the behavior or shorten the required verification path while preserving every obligation. | All required checks pass within the configured deadline. |
| `incomplete` | Resolve the reported missing binding, unsupported syntax, analysis error, interrupted execution, changed files, or missing evidence. | A complete report evaluates the current candidate. |
| `pass` | Run the project's other required checks. | The gate and those checks pass for the final candidate. |

For a component investigation, use the project's wrapper or:

```sh
bun run --cwd "$BONSAI_DIR" --silent bonsai explain 'src/orders.ts#placeOrder' --root "$PROJECT_DIR"
```

Substitute an actual reported component or file. `explain` performs static analysis; it does not verify behavior. Its ancestry and relationship references guide inspection, while a fresh `check` establishes acceptance. Recheck after every subsequent change to the candidate.

If the remaining blocker requires a new adapter, a product decision, or a policy decision outside the task's authority, report the exact gap and the decision needed. Keep rejection and incompleteness visible until resolved.

## 5. Report the result

Report the final verdict, retained size versus ceiling, measured change from the baseline, required checks passed, and other project checks run. State unresolved violations and unsupported scope explicitly. Exit **0** means pass, **1** reject, and **2** incomplete or invalid input; only a fresh pass supports claiming the gate passed.

Bonsai's current unit-test ancestry is a static association. Run the project's unit suite separately. Coverage, mutation effectiveness, structural quality floors, and trusted merge enforcement need additional integration; a prototype pass establishes only the implemented gate's guarantees.
