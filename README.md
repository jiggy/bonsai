# Bonsai

**Deliberate growth. Continuous pruning.**

Bonsai gives a codebase a finite space to grow. Executable product contracts earn a global allowance; retained code consumes it. Code without contract ancestry blocks acceptance, even when its own unit test imports it.

This is an initial working prototype for **TypeScript with in-process application handlers**. It includes contract compilation and execution, symbol-level analysis, a generated retention graph, a pure policy evaluator, and a CLI. It does not yet provide a hardened merge gate or general framework support.

## Try it

Requires Node 22.18+ and npm.

```sh
npm ci
npm run check
npm test
npm run demo
npm run bonsai -- explain src/checkout.ts --root examples/checkout
npm run bonsai -- check --root examples/checkout --json
```

The checkout example passes three assertions while earning **one** action–observation pair:

```text
PASS

Contract surface: 1 pairs
Retained size: 216 tokens
Ceiling: 400 tokens
Required reduction: 0 tokens
Required checks: 3 / 3 passed
Unrooted components: 0
```

Add an exported, unused function to `examples/checkout/src/checkout.ts`, then rerun the demo. It rejects that symbol even though the file's other functions are used. Delete the function and the check passes again. The automated tests also demonstrate a reachable wrapper that exceeds a tight ceiling, then passes after inlining and deletion.

## Agent skill

Use the [Bonsai skill](skills/bonsai/SKILL.md) to adopt the gate in a project, implement changes within its allowance, or resolve a failing check. Copy the entire `skills/bonsai/` directory into your agent's skill location, such as `.agents/skills/bonsai/`; keep its `references/` directory alongside `SKILL.md`.

The skill is model-invoked: its description makes it discoverable for those tasks. First-time setup is disclosed in a separate reference, while the main file carries the measure, implement, prune, and verify loop.

## Describe behavior once

`features/checkout.feature`:

```gherkin
Feature: Checkout
  Scenario Outline: Place an order
    When I invoke "place-order" with {"quantity": <quantity>}
    Then response "status" equals "<status>"

    Examples:
      | quantity | status   |
      | 1        | accepted |
      | 0        | rejected |
```

`bindings.ts` connects the external operation to an actual handler:

```ts
import { placeOrder } from './src/checkout.ts';
export const actions = { 'place-order': placeOrder };
```

The same registry is statically resolved and executed. Bonsai owns the response assertions; a binding cannot declare an observation passed by merely entering a step. Every scenario outline row becomes a separate required check. Duplicated scenarios and files do not create extra allowance. Array indices normalize for accounting: `items[0].price` and `items[3].price` both count as `items[*].price`. Their assertions still check the exact positions.

The first grammar supports only these two literal step forms, JSON inputs and expected values, ordinary dotted selectors, and numeric array indices. Backgrounds and outline expansion come from the official Gherkin parser. Unsupported steps, skip tags, DocStrings, DataTables, missing bindings, and analysis errors block acceptance.

## Set the constraint

One `bonsai.json` specifies the maintained inventory, executable registry, and project-wide policy:

```json
{
  "maintained": ["src", "features", "bindings.ts", "bonsai.json"],
  "bindings": "bindings.ts",
  "policy": {
    "bootstrap": 20000,
    "bootstrapSurface": 20,
    "perDoubling": 2000,
    "hardLimit": 30000,
    "maxFeedbackMs": 15000
  }
}
```

For current external surface `S`:

```text
ceiling = floor(min(hardLimit,
  bootstrap + perDoubling * log2(max(1, S / bootstrapSurface))))
requiredReduction = max(0, retainedSize - ceiling)
```

All files in the inventory count, including unrooted source, tests, bindings, features, fixtures, and configuration. Shared files count once, without a reuse discount. The initial metric counts TypeScript lexical tokens, charges literal payload in four-byte blocks, and counts comment content. Other files use Unicode word and punctuation tokens. This is a deterministic pressure metric, not a claim to measure human comprehension. Binary assets, JSX, and other languages need dedicated adapters; keep them out of a prototype deployment rather than assuming meaningful analysis.

The inventory is explicit and must be reviewed. Unlisted local TypeScript imports are detected. An unrelated file outside the inventory is outside the gate's scope. Dependencies, lockfiles, generated outputs, and documentation are not automatically included or excluded; choose maintained paths deliberately. Formatting outside literals does not create TypeScript headroom. Source-symbol costs in explanations exclude some statement scaffolding; the authoritative repository total always comes from whole files.

## Agent loop

```sh
npm run bonsai -- check --root /path/to/project --json
npm run bonsai -- explain src/orders.ts#placeOrder --root /path/to/project
```

Read the violations, simplify the actual candidate, preserve its required behavior, and rerun. `explain` returns the component's check ancestry and incoming/outgoing relationships with source references. It performs static analysis without executing handlers.

Exit codes are **0 pass**, **1 reject**, **2 incomplete or invalid input**. Both reject and incomplete block acceptance. JSON check output contains the decision, file costs, graph, obligations, evidence, and content fingerprint.

For a Git repository configured at its root:

```sh
npm run bonsai -- check --root /path/to/project --base origin/main --json
```

The base is read from an archive without running its code. Its `bonsai.json` supplies the candidate's rules and inventory by default, so changing the candidate's policy does not enlarge its allowance. Base reporting compares retained size and contract surface; it does not claim that the historical base passed verification. `--policy /trusted/bonsai.json` explicitly overrides this configuration. A trusted CI deployment must control that argument and the checker executable. `--base` requires `--root` to be the Git repository root; the nested checkout example uses standalone checks.

## What the prototype establishes

- Top-level functions, classes, variables, and type declarations are separate components. Importing one function does not retain every declaration in its file.
- Contracted handlers root production dependencies through TypeScript symbol references, including imports, aliases, and type references.
- A unit test can inherit ancestry from retained production subjects. It cannot root another production subject or a dead dependency cycle.
- Tests are identified by `test/`, `tests/`, `.test.`, or `.spec.` paths. This is static subject association, **not evidence that the unit tests passed**.
- Verification runs in a fresh subprocess with a deadline, so stale module caches and nonterminating handlers cannot silently pass. Feedback time includes candidate collection and execution, excluding optional base analysis and final report formatting.
- Evidence is bound to the maintained content and effective configuration. Changes during verification, missing obligations, failed assertions, and mismatched evidence block acceptance.

## Limits and next steps

This is a static ancestry approximation. Classes and function bodies are atomic; Bonsai does not yet prove necessity of individual methods or statements. References establish eligibility, not actual use or minimality. HTTP routes, queues, dependency injection, computed dispatch, side-effect-only imports, asset reads, and dynamically accessed module exports need adapters. Dynamic `import()` is flagged, but this is not comprehensive detection of dynamic behavior. Use straightforward named handlers for this release.

The worker executes project code with the developer's privileges. Its process boundary provides timeout and module-cache separation, **not isolation from hostile code**. It does not attest runtime identity or defend against malicious code forging process messages. Run untrusted candidates in an external sandbox. The fingerprint is a content identity for this prototype, not a complete supply-chain or execution-environment attestation.

Coverage, mutation effectiveness, unit-runner evidence, structural quality floors, trusted checker distribution, merge-candidate enforcement, and branch protection are **not implemented yet**. The repository's CI checks this prototype and its example; it is not the trusted admission system described in the design. See [the design](docs/design.md) and [the implementation roadmap](docs/roadmap.md).
