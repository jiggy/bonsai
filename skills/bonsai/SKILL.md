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

## 3. Implement and prune

Express requested external behavior in the project's executable contracts and connect it to actual application handlers. Preserve all existing obligations unless the task authorizes a product-scope change. Extend an existing action or observation where it already represents the behavior.

Retain code through contract ancestry. Before adding an abstraction, inspect the existing dependency path for a smaller extension. For an unnecessary layer, rewire its callers, preserve meaningful assertions, and remove the obsolete code and exclusive support together.

Surface is the deduplicated external action–observation set. Extra examples strengthen verification without earning allowance. Shared code consumes its full cost once; adding callers or unit tests does not justify otherwise unrooted production code.

Keep the governing inventory and policy intact while implementing ordinary features or compaction. Treat a requested rule change as an explicit policy change, with its effect reported separately. Never manufacture external promises or remove required assertions to obtain a pass.

**Done:** the candidate implements the requested behavior and every added retained component has an identifiable contract connection.

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
