# Bonsai

**Deliberate growth. Continuous pruning.**

Bonsai gives a codebase a finite space to grow. Executable product contracts earn a global allowance; retained code consumes it. Code without contract ancestry blocks acceptance, even when its own unit test imports it.

This is an initial working prototype for **TypeScript with in-process application handlers**. It includes contract compilation and execution, symbol-level analysis, a generated retention graph, a pure policy evaluator, and a CLI. It does not yet provide a hardened merge gate or general framework support.

## Try it

Requires Bun 1.4.3 or later. Bun manages dependencies and runs the CLI, tests, and verification workers.

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run demo
bun run bonsai explain src/checkout.ts --root examples/checkout
bun run bonsai check --root examples/checkout --json
```

## Commands

| Command | Purpose |
| --- | --- |
| `bonsai check` | Check required behavior, ancestry, and retained size |
| `bonsai explain <target>` | Show ancestry and relationships without running handlers |
| `bonsai config show` | Inspect effective configuration and its origin |
| `bonsai completion <shell>` | Generate bash, zsh, fish, or PowerShell completions |
| `bonsai help [command]` | Show help, or capabilities with `--json` |
| `bonsai version` | Show the installed version |

See the [generated CLI reference](docs/cli.md) for every flag, default, and example.
Root and command help support `-h` (concise), `--help` (complete), and `--json`.
`--help` takes priority over other options and never loads a project.

Data goes to stdout; progress, errors, and diagnostics go to stderr. At a terminal,
results use concise human output. Pipes default to headerless tab-separated records.
Use `--json` for the complete stable report and `--pretty` to indent it in a pipe.
`--quiet` suppresses human results and progress; explicit JSON/plain data and errors
remain available. `--verbose` wins over `--quiet` and shows all violations.

### Configuration and environment

`--root`, `--base`, and `--policy` override `BONSAI_ROOT`, `BONSAI_BASE`, and
`BONSAI_POLICY`, respectively. The default root is the current directory; base and
policy overrides are unset. An empty environment override is an input error.
`config show --json` includes each value's origin. Project configuration stays in
`bonsai.json` and accepts JSON comments. There are no user/system configuration
files, persistent CLI state, telemetry, network calls, or automatic updates.

With `--base`, the base revision supplies the effective policy and maintained
inventory unless `--policy` is explicit. Environment policy overrides have the
same explicit effect and should be controlled in trusted CI. CLI timeout limits
never increase the project's feedback budget.

`NO_COLOR`, `BONSAI_NO_COLOR`, `TERM=dumb`, and `--no-color` disable ANSI styling,
even with `FORCE_COLOR`. Otherwise `FORCE_COLOR=1` enables color, while
`FORCE_COLOR=0` disables it. Each stream's terminal status is independent.
`COLUMNS` sets human/help width (default 80). `TERM=dumb` and `LANG`/`LC_ALL` set
to `C` or `POSIX` select ASCII status glyphs. JSON and plain records never use ANSI.
`CI` and `--no-input` disable prompts; an explicit `--interactive` can override
`CI` only when stdin and stderr are terminals. `--no-input` always wins.

`explain -` reads one target per line from piped stdin. `--policy -` reads JSON or
JSONC from piped stdin; both inputs cannot share stdin. Neither form reads from a
terminal. Use `--timeout 30` to bound a command to 30 seconds. Signals stop active
verification workers and remove temporary base archives. Candidate handlers still
run with the caller's privileges, as described under Limits.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success or gate pass |
| 1 | Gate rejection or runtime failure, including CLI timeout |
| 2 | Incomplete gate, invalid input/configuration, or usage error |
| 3 | Configuration access denied |
| 4 | `explain` target not found |
| 130 | Interrupted with SIGINT |
| 143 | Stopped with SIGTERM |

Only exit 0 establishes acceptance for `check`. For compatibility, incomplete
analysis stays exit 2 rather than changing an existing automation contract.
JSON gate reports retain `decision` and `snapshot`; explanation reports retain
`fingerprint`, `components`, and `problems`. JSON setup errors keep the existing
`status` and string `error` fields, adding `code`, `exit_code`, `run`, and
`retryable` metadata on stderr. Stack traces require `--debug`.

### Shell completions

Generate scripts without changing shell configuration automatically:

```sh
bonsai completion bash > bonsai.bash
source bonsai.bash
bonsai completion zsh > _bonsai
bonsai completion fish > bonsai.fish
bonsai completion powershell > bonsai.ps1
```

Load zsh scripts from a directory in `$fpath` after `compinit`, fish scripts from
`$XDG_CONFIG_HOME/fish/completions/` (or `~/.config/fish/completions/`), and
PowerShell scripts from your profile. Completions use the same command/flag registry
as help and include filesystem completion where supported. They don't run handlers.

### CLI migration

Existing `check` and `explain` invocations and their `--json` report fields are
preserved. Default output is now human-oriented at a terminal and plain records
in pipes; scripts parsing the old formatted summary or default explanation JSON
should request `--json` explicitly. JSON is compact in pipes; add `--pretty` for
indentation. Plain check columns are, in order: status, retained tokens, ceiling,
required reduction, surface pairs, passed checks, required checks, unrooted symbols.
Plain explanation columns are component ID, tokens, check count, and source location.
Empty piped targets produce no plain records, or an explanation with empty components
under `--json`. No match for an explicitly named target exits 4.

### Contributing

Use `bun install --frozen-lockfile`, `bun run check`, `bun run test`, and
`bun run demo`. Regenerate the command reference with
`bun run --silent bonsai help --markdown > docs/cli.md` after command changes.
Bun remains the supported distribution/runtime; static binary releases and a
self-updater are outside this CLI rewrite.

## Publish an alpha

Install Bun before using the published CLI. To publish this scoped package publicly
under the prerelease tag, run `bun publish --access public --tag alpha`.
`publishConfig` declares public access and the `alpha` tag; pass `--tag alpha`
explicitly to ensure prereleases never use `latest` across client versions.
Use `npm publish --access public --tag alpha` if publishing with npm.
Preview package contents with `npm pack --dry-run`; only runtime sources, the
skill, documentation, and the example are included alongside package metadata.

## Formatting and Codex cloud

Formatting rules and `.editorconfig` come from [jiggy/jig](https://github.com/jiggy/jig).
Biome ignores unsupported file types, including Gherkin `.feature` files.
Run `bun run format` to apply formatting and `bun run format:check` to check it.
Biome is pinned to the configuration's schema version.

In the Codex cloud environment setup script, install Bun 1.4.3
(or use an image that includes it), then run `bun install --frozen-lockfile`.
Setup runs before agent edits; it does not format the completed change.
CI runs `bun run format` for branch pushes and pull requests from this repository,
then commits any fixes back to the branch as `github-actions[bot]`. It checks
formatting, types, tests, and the demo against the formatted result in the same
run. Pull requests validate GitHub’s merge result, including any new formatting
commit. Because `GITHUB_TOKEN` pushes do not trigger another workflow run, CI
explicitly reports a `verify` check on the formatting commit as well.
Formatting and validation run in read-only jobs without persisted Git credentials.
An isolated write-capable job applies the patch and pushes it with Git hooks
disabled; it never executes candidate scripts. Check reporting uses a separate
job without a candidate checkout.
Fork pull requests and tags only check formatting. Fork contributors must apply
fixes in their own checkout. Make the CI job a required branch protection check
to block merging changes with formatting errors. Repository rules must allow
the workflow's token to push formatting commits to the target branch.

At an interactive terminal, the checkout example passes three assertions while earning **one** action–observation pair:

```text
bonsai · check

✓ Pass
  ├─ Retained: 212 / 400 tokens
  ├─ Contract surface: 1 pair
  └─ Required checks: 3 / 3 passed

3 checks passed
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
import { placeOrder } from './src/checkout.ts'
export const actions = { 'place-order': placeOrder }
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
bun run bonsai check --root /path/to/project --json
bun run bonsai explain src/orders.ts#placeOrder --root /path/to/project
```

Read the violations, simplify the actual candidate, preserve its required behavior, and rerun. `explain` returns the component's check ancestry and incoming/outgoing relationships with source references. It performs static analysis without executing handlers.

Exit codes are **0 pass**, **1 reject**, **2 incomplete or invalid input**. Both reject and incomplete block acceptance. JSON check output contains the decision, file costs, graph, obligations, evidence, and content fingerprint.

For a Git repository configured at its root:

```sh
bun run bonsai check --root /path/to/project --base origin/main --json
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
