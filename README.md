# Bonsai

[![Bonsai — Grow the product. Prune the code.](website/public/assets/readme-banner.png)](https://jiggy.github.io/bonsai/)

**Deliberate growth. Continuous pruning.**

Bonsai gives a codebase a finite space to grow. Executable product contracts earn a global allowance; retained code consumes it. Code without contract ancestry blocks acceptance, even when its own unit test imports it.

This is an initial working prototype for **TypeScript with in-process application handlers**. It includes contract compilation and execution, symbol-level analysis, a generated retention graph, a pure policy evaluator, and a CLI. It does not yet provide a hardened merge gate or general framework support.

The [landing page](https://jiggy.github.io/bonsai/) is maintained in [`website/`](website/README.md) and published to GitHub Pages by the Website Actions workflow after changes merge into `main`.

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
| `bonsai init` | Create local configuration and any missing contract starters |
| `bonsai check` | Check required behavior, ancestry, and retained size |
| `bonsai explain <target>` | Show ancestry and relationships without running handlers |
| `bonsai config show` | Inspect effective configuration and its origin |
| `bonsai completion <shell>` | Generate bash, zsh, fish, or PowerShell completions |
| `bonsai help [command]` | Show help, or capabilities with `--json` |
| `bonsai version` | Show the installed version |

See the [generated CLI reference](docs/cli.md) for every flag, default, and example.
Root and command help support `-h` (concise), `--help` (complete), and `--json`.
`--help` skips project work; output modes still validate so conflicting formats
produce an error instead of silently selecting one.

Data goes to stdout; progress, errors, and diagnostics go to stderr. At a terminal,
results use concise human output. Pipes default to headerless tab-separated records.
Use `--json` for the complete stable report and `--pretty` to indent it in a pipe.
`--quiet` suppresses human results and progress; explicit JSON/plain data and errors
remain available. `--verbose` wins over `--quiet` and adds detailed results.
Human check findings and explanations show up to 20 entries. Set `--limit N` to
change this or `--limit 0` to show every entry. JSON and plain records stay complete.
File targets accept project-relative paths (including `./`) and absolute paths.
Recovery commands preserve the effective root, base, policy, and explicit engine
options.

### Start using Bonsai in a project

Run `bonsai init` in an existing project, or `bonsai init --root path/to/project`.
It creates `bonsai.json` with a detected maintained inventory and initial policy;
no knowledge of the configuration schema is needed. Existing configuration and
application files are never overwritten, and initialization never runs handlers
or package scripts. A missing project configuration suggests this command directly.

Initialization reuses root-level `bindings.ts`, then `bonsai.bindings.ts`, and
existing `.feature` files in the selected project. A directory with its own
`bonsai.json` is a separate project; its inventory and contracts stay outside the
parent's scope. If absent, initialization creates `bonsai.bindings.ts` with an empty
actions registry and a commented scenario in `features/bonsai.feature`. Connect
your real named handlers and uncomment/adapt scenarios for their observable results.
These starters earn no behavior allowance and cannot produce a passing gate.

Discovery honors root and nested project `.gitignore` files, including negations.
It also skips VCS metadata, dependencies, build/cache outputs, `.direnv`, lockfiles,
symlinks, and nested Bonsai projects by default. The result lists skipped paths.
These rules are saved as Gitignore-style `exclude` patterns in `bonsai.json`.
Maintained directories include future authored files while the saved rules filter
future ignored/generated files. A required binding or starter path excluded by
ignore rules produces an error before initialization writes anything.
Review this detected scope, especially after adding new top-level paths.
The initial budget uses the README defaults below; calibrate it against the first
real baseline. `bonsai config show` displays the effective settings, then
`bonsai check` checks the connected behavior. `init --json` reports created paths,
detected settings, exclusions, and next steps for automation.

Existing configurations are preserved. To regenerate an initial setup from an
older initializer, keep a backup in the excluded `.bonsai` directory:

```sh
mkdir -p .bonsai
mv bonsai.json .bonsai/bonsai.before-ignore-fix.json
bonsai init
```

Compare any previously calibrated policy with the backup before adopting the new
configuration. Existing bindings and contracts are preserved.

### Configuration and environment

`--root`, `--base`, and `--policy` override `BONSAI_ROOT`, `BONSAI_BASE`, and
`BONSAI_POLICY`, respectively. The default root is the current directory; base and
policy overrides are unset. An empty environment override is an input error.
`config show --json` includes each value's origin. Project configuration stays in
`bonsai.json` and accepts JSON comments. There are no user/system configuration
files, persistent CLI state, telemetry, external network calls, or automatic updates.

With `--base`, the base revision supplies the effective policy and maintained
inventory unless `--policy` is explicit. Environment policy overrides have the
same explicit effect and should be controlled in trusted CI. CLI timeout limits
never increase the project's feedback budget.

Checks use the saved `exclude` patterns, including when `--base` supplies them.
They do not reread candidate `.gitignore` files or discover new project boundaries.
Changing a candidate ignore file or adding a nested `bonsai.json` therefore cannot
hide source from an established base inventory. Configurations without `exclude`
continue to measure every file under their declared maintained paths.

`NO_COLOR`, `BONSAI_NO_COLOR`, `TERM=dumb`, and `--no-color` disable ANSI styling,
even with `FORCE_COLOR`. Otherwise `FORCE_COLOR=1` enables color, while
`FORCE_COLOR=0` disables it. Each stream's terminal status is independent.
Terminal help uses cyan for commands, muted section labels, and dim descriptions;
human reports share the same palette and semantic status colors. Redirected help
stays canonical and unstyled, including with `FORCE_COLOR`.
`COLUMNS` sets terminal human/help width (default 80). Command examples and recovery
commands stay intact for copying even when they exceed the requested width.
`TERM=dumb` and `LANG`/`LC_ALL` set
to `C` or `POSIX` select ASCII status glyphs. JSON and plain records never use ANSI.
`CI` and `--no-input` disable prompts; an explicit `--interactive` can override
`CI` only when stdin and stderr are terminals. `--no-input` always wins.

`explain -` reads one target per line from piped stdin. `--policy -` reads JSON or
JSONC from piped stdin; both inputs cannot share stdin. Neither form reads from a
terminal. Use `--timeout 30` for a command deadline that includes startup,
waiting for stdin, and delivering stdout. A timeout during output can leave a
partial report; its `TIMEOUT` diagnostic goes to stderr and the command exits 1.
Expired commands cannot report success. Signals stop active
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
Check snapshots may add `source.bindingImports` and `evidence.bindingImport` for
the validated internal loader boundary; existing fields remain available.
Check reports also include additive `timing` and `snapshot.timing` measurements.
Rust-mode snapshots add `analysis` metadata for the selected engine and its
native compiler identity and diagnostic status.

### Read a check result

`Incomplete` means setup, analysis, or required evidence is missing. Resolve the
blocking issues before acting on the provisional budget and ancestry findings.
If verification was skipped, the report says `not run`; those checks have not
failed assertions. `--verbose` includes grouped provisional findings, and JSON keeps
the complete underlying facts.

Human rejected and incomplete check reports go to stderr; successful reports go
to stdout. Blocking alerts use red `✗` indicators and readable alert text, incomplete
and provisional states use amber `△`, important values stay primary, and gray is
reserved for structure. These meanings survive wrapping and remain explicit with
`--no-color` or ASCII output. JSON and plain records keep their stdout schemas and
contain no ANSI styling.

Human findings are grouped by cause and file. `--verbose` adds source expressions,
assertion details, and provisional ancestry; `--limit N` bounds displayed entries
(default 20), and `--limit 0` requests every entry. Machine reports always retain
all facts. `--quiet` preserves errors and repairs while suppressing metrics,
progress, and retry hints.

Each blocker now includes its impact and a concrete fix. For example, a commented
initialization starter reports its `.feature` path, explains that commented scenarios
do not execute, and identifies an empty action registry. Untraceable runtime imports
are grouped with their exact file, line, and expression. Fix those causes, then run
the suggested `check` command again; merely inspecting the configuration cannot
resolve a missing scenario or an unsupported dependency.

Retained tokens measure the configured inventory, including maintained tests,
contracts, docs, and configuration. The ceiling comes from the selected policy;
the initializer's 20,000-token bootstrap is a draft default. A potential overage
is their arithmetic difference, not a verified deletion target during incomplete
analysis. Contract surface counts unique action/observation pairs; required checks
count every executable observation, including separate outline rows.

`Rejected` means the gate found failed requirements such as assertions, ancestry,
or budget. `Pass` means all required evidence and policy conditions passed. Raising
the budget cannot resolve unbound handlers or unsupported analysis.

### Measure check duration

Human check summaries include elapsed time. Use `--verbose` for phase durations
and the measured feedback window against its configured limit:

```sh
bun run bonsai check --verbose
bun run bonsai check --json
```

JSON `timing` records command elapsed milliseconds and named `stages`, including
nested base and candidate analysis. `snapshot.timing` records the candidate alone.
Stages report `completed`, `interrupted`, or `skipped`; skipped stages have
`elapsedMs: null`. Partial timings survive a feedback timeout even when no complete
evidence exists. Setup errors and `--timeout` errors carry available timing on
stderr in JSON mode.

Source analysis includes nested retained-size measurement, compiler setup, type
checking, and dependency graph timings. Rust adds measured worker overhead. See [performance research and measurements](docs/performance.md) for the
current bottlenecks, optimizations, and Rust checker evaluation.

Command elapsed time starts at the runtime clock origin and ends after report
preparation. It includes startup, configuration, optional base work, candidate
collection and verification, and policy evaluation. Final serialization, output
delivery, and cleanup are outside that reported total. `timing.feedback` separately
reports candidate collection and verification against `limitMs`, preserving the
policy's existing measurement boundary before the final integrity check. Timing
doesn't increase a deadline or change acceptance.

`--quiet` suppresses human timing metrics; explicit JSON keeps them. Plain output
retains its eight tab-separated columns. Timings measure elapsed wall time.

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
as help. They suggest scoped flags, nested commands, output values, and file or
directory paths, including attached option values. Explanation paths resolve
against `--root` in Bash, zsh, and fish. They don't run handlers.

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

The experimental [Rust TypeScript checker](docs/native-prototype.md) is installed
with the pinned `tsrs` dependency; no Cargo build is required. Try it through the
same CLI and presentation:

```sh
bun install --frozen-lockfile
bun run ./src/cli.ts check --engine rust --verbose
bun run ./src/cli.ts check --root examples/checkout --engine rust --verbose
```

`--engine typescript` remains the default. `--engine rust` uses native compiler
diagnostics and symbol resolution independently; it does not run the TypeScript
reference compiler. Both share Bonsai's lexical token metric, structural rules,
CLI, and evidence worker. Differential comparisons run in tests and through
`bun run native:compare`; `bun run native:bench` measures fresh complete commands.
Standard JSON configs keep TypeScript out of the native CLI parent; its worker
loads the lexical parser once. JSONC and malformed configs retain the original
parser and diagnostics. Every contract case still executes in order.
During verification, nested Rust CLI checks can share a lexical worker scoped to
that invocation. It starts only when needed; every request still creates a fresh
compiler process and program, and application handlers run in fresh verification
processes. The worker closes when the owning verification finishes.
The pinned package supports Linux x64/arm64 and macOS arm64. Unsupported forms and
known compiler gaps block acceptance. See the native documentation for platform,
configuration, and TypeScript-version limits.

## Bonsai's own executable contracts

Bonsai defines its product behavior in [`features/`](features/AGENTS.md), with
`bonsai.bindings.ts` connecting those contracts to the actual CLI. They cover
admission, rejection, incomplete verification, read-only inspection, initialization,
help, and shell completion. The bindings create isolated fixture projects, invoke
the real executable, and return its reports and filesystem outcomes for assertion.

```sh
bun run test:features
```

`bun run test` includes the same feature suite. The native root regression checks
the complete committed inventory through the actual CLI and verifies every
observation under the saved 15-second feedback policy. Bonsai's own feature
bindings inherit the selected engine for nested CLI checks. A copied reference
fixture runs the same full inventory with TypeScript and a test-only 60-second
feedback window, preserving the retained-code budget and archive-loader coverage.

`bun run bonsai check --engine rust` inspects the committed root inventory and
policy. Owned source, tests, contracts, documentation, and configuration remain
measured; installed third-party CLI skills and the separate checkout example stay
outside that scope. The root policy keeps its 20,000-token bootstrap, 30,000-token
hard limit, and 15-second feedback ceiling. The current inventory exceeds that
allowance, and subprocess entry points still need ancestry relationships. Complete
feature evidence therefore still produces a genuine rejection, not a budget pass.

The unused Oxc prototype was deleted when tsrs replaced it. Its Cargo files and
Rust sources were removed rather than excluded. Authored Rust in consuming
projects remains unsupported and measured until a language adapter exists.

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
  ├─ Required checks: 3 / 3 passed
  └─ Contract surface: 1 pair

Inventory measurements
  ├─ Retained: 212 tokens
  └─ Configured ceiling: 400 tokens

3 checks passed · 1.3s elapsed
```

Elapsed time varies with the runtime and machine.

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

The inventory is explicit and must be reviewed. Unlisted local TypeScript and JSON imports are detected. An unrelated file outside the inventory is outside the gate's scope. Initialization proposes exclusions for dependencies, lockfiles, local caches, generated outputs, and nested projects; checks use the saved configuration. Documentation counts when included in the maintained scope. Formatting outside literals does not create TypeScript headroom. Source-symbol costs in explanations exclude some statement scaffolding; the authoritative repository total always comes from whole files.

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

This is a static ancestry approximation. Classes and function bodies are atomic; Bonsai does not yet prove necessity of individual methods or statements. References establish eligibility, not actual use or minimality. HTTP routes, queues, dependency injection, computed dispatch, side-effect-only imports, asset reads, and dynamically accessed module exports need adapters. Literal dynamic imports support statically selected named exports, including named destructuring within functions. General computed module paths and computed namespace selections remain incomplete; this is not comprehensive detection of dynamic behavior. Use straightforward named handlers for this release.

Bonsai's internal binding-loader adapter recognizes the exact collector pattern
that imports a validated project target. Before importing, it checks the selected
registry's inventory membership and the effective configuration/content fingerprint.
Its evidence includes a matching loading receipt; missing or mismatched receipts
block acceptance. The recorded boundary grants no ancestry to unrelated handlers
or exports. This adapter does not authorize arbitrary application runtime imports.
Subprocess entry-point ancestry remains unfinished. The supported checkout example
is available through `bun run bonsai check --root examples/checkout`.

The experimental native backend uses the pinned tsrs TypeScript 7 checker while
the default reference uses TypeScript 5.9. Shared lexical parsing and graph rules
preserve Bonsai's supported accounting. The native adapter explicitly preserves
ambient type discovery and blocks known semantic gaps, including disabling the
default library through a source directive. This is not universal compiler
compatibility. See [native scope and commands](docs/native-prototype.md) and
[performance measurements](docs/performance.md).

The worker executes project code with the developer's privileges. Its process boundary provides timeout and module-cache separation, **not isolation from hostile code**. It does not attest runtime identity or defend against malicious code forging process messages. Run untrusted candidates in an external sandbox. The fingerprint is a content identity for this prototype, not a complete supply-chain or execution-environment attestation.

Coverage, mutation effectiveness, unit-runner evidence, structural quality floors, trusted checker distribution, merge-candidate enforcement, and branch protection are **not implemented yet**. The repository's CI checks the implementation, its executable product contracts, and its example; it is not the trusted admission system described in the design. See [the design](docs/design.md) and [the implementation roadmap](docs/roadmap.md).
