# Bonsai

[![Bonsai — Grow the product. Prune the code.](website/public/assets/readme-banner.png)](https://jiggy.github.io/bonsai/)

**Deliberate growth. Continuous pruning.**

Bonsai gives a codebase a finite space to grow. Executable product contracts earn a global allowance; retained code consumes it. Code without contract ancestry blocks acceptance, even when its own unit test imports it.

This is an initial working prototype for **TypeScript with in-process application handlers**. It includes contract compilation and execution, symbol-level analysis, a generated retention graph, a pure policy evaluator, and a CLI. It does not yet provide a hardened merge gate or general framework support.

The [landing page](https://jiggy.github.io/bonsai/) is maintained in [`website/`](website/README.md) and published to GitHub Pages by the Website Actions workflow after changes merge into `main`.

## Try it

Requires Bun 1.4.3 or later. The CLI uses the packaged Rust TypeScript checker;
users on supported prebuilt targets do not need Node, Cargo, or a Rust compiler. Supported prebuilt targets are
Linux x64/arm64 (GNU or musl) and macOS arm64. See [native installation](docs/native-prototype.md)
for platform limits and repairs. Intel macOS needs a
[local build of the matching compiler](docs/native-prototype.md#local-build-on-intel-macos),
selected with `BONSAI_NATIVE_BINARY`; Bonsai ignores `TSRS_BINARY`.

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

### Concurrent and serial verification

`bonsai check` runs scenarios concurrently by default. It selects one worker per
available CPU using the runtime's `availableParallelism()`, bounded by the number
of scenarios. Each scenario gets fresh application modules in its own subprocess;
steps within that scenario execute in order. Result ordering follows the contracts.

Use `--serial` when scenarios depend on earlier scenarios' state or share external
resources that cannot run concurrently:

```sh
bonsai check --serial --verbose
```

Serial mode runs scenarios in contract order in one fresh subprocess, sharing
application modules for that run. Concurrent processes still share files,
databases, and services, so independent scenarios must not interfere through them.
A one-CPU concurrent run still isolates application state between scenarios;
`--serial` explicitly selects shared state.

Execution mode is a command choice, not a `bonsai.json` setting. Remove the old
`verification` block if present. JSON check reports expose the selected profile
and worker count in `snapshot.verification`; evidence must match that profile.
Every observation remains required, and all workers share the saved feedback
deadline, including startup and cleanup. Each execution lane can reuse lexical
initialization for nested checks; every analysis still creates a fresh native
compiler process and program.

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
Failed observation records may add a bounded diagnostic `response` string showing
what the action returned. Passing records retain their existing shape.
Check reports also include additive `timing` and `snapshot.timing` measurements.
Static child launches add relationships with `kind: "entry-point"`, retaining
the launch location in `sourceRef`.
Snapshots include `analysis` metadata identifying the native compiler and its
diagnostic status.

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

When several assertions fail on one returned response, the human report shows
that response once for the affected call. This exposes a nested command's error
alongside the failed requirements. Its diagnostic preview is limited to 2 KiB
and marks truncation; verbose output retains individual assertion failures.
An expected application error response can still satisfy its contract.

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

Rust is now the sole source engine. Existing `--engine rust` commands remain valid;
replace `check --engine typescript` with `check` and `explain --engine typescript`
with `explain`. Unsupported native inputs remain incomplete rather than falling
back. The `--json` report fields are preserved. Default output is human-oriented at a terminal and plain records
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
Bun remains the supported distribution/runtime; standalone Bonsai executables and
a self-updater are outside this CLI rewrite.

The [Rust TypeScript checker](docs/native-prototype.md) is installed with the
pinned `tsrs` dependency. Run the native implementation directly:

```sh
bun install --frozen-lockfile
bun run ./src/cli.ts check --verbose
bun run ./src/cli.ts check --root examples/checkout --verbose
```

Rust is the only production engine. Existing `--engine rust` invocations remain
valid; remove `--engine typescript` from older commands. There is no fallback
compiler. TypeScript remains a dependency for lexical scanning, parsing, JSONC,
and ambient-type discovery; it does not construct or check a JavaScript compiler
program in production. The reference compiler lives in development-only
`test/reference.ts` and `test/compiler.ts`, outside the published package.

`bun run native:compare` compares native source facts with that independent oracle.
Source-analysis and CLI regressions use the same native collector and CLI as users;
pure-module tests call their corresponding production functions directly. The oracle
adds an independent check of diagnostics and graph facts; its own compiler/session
tests do not replace native product coverage.
`bun run native:bench` measures repeated fresh native commands and their evidence,
without an engine speedup ratio. Standard JSON configs keep TypeScript out of the
CLI parent; JSONC and malformed configs retain the established parser diagnostics.
Nested checks may share lexical initialization within one verification invocation,
while every request creates a fresh native compiler process and program. Default
verification uses a fresh application process for each scenario; `--serial` keeps
scenario order and shared application modules within one fresh process.

## Bonsai's own executable contracts

Bonsai defines its product behavior in [`features/`](features/AGENTS.md), with
`bonsai.bindings.ts` connecting those contracts to the actual CLI. They cover
admission, rejection, incomplete verification, read-only inspection, initialization,
help, and shell completion. The bindings create isolated fixture projects, invoke
the real executable, and return its reports and filesystem outcomes for assertion.

This repository follows [the BDD workflow](docs/bdd.md): agree on a stakeholder’s
rule and its distinguishing examples before implementation. Features describe
meaningful context and observable consequences that survive an internal rewrite.
Real CLI execution, Gherkin, public JSON, and red/green discipline alone do not
make a test a product specification. Rejection, safety, and recovery cases belong
when they matter to users. The guide includes worked Bonsai and adoption examples.

New behavior uses meaningful red/green/refactor; existing behavior gaining a
contract uses a green control and a controlled violation. Detailed compiler,
protocol, schema, and presentation assertions remain in technical tests, including
those migrated out of features. Development arrangements live in
`features/support/`, outside the published runtime. Helpers arrange, execute, and
observe; they do not calculate expected answers or replace outcomes with test flags.

Those reviewed product contracts supply the action–observation surface for one
global code allowance. The engine counts literal normalized pairs; human review
decides whether each pair expresses product scope. More tests, examples, helper
aliases, or technical metadata do not qualify as new capabilities. Technical tests
remain required but do not earn allowance. Moving assertions between layers can
reduce allowance without reducing code: report those changes separately. All
maintained code and support remain charged, and the root policy stays unchanged.

For a focused red/green loop, list the authored cases or select a scenario:

```sh
bun run test:specs -- --list
bun run test:specs -- --scenario 'part of a scenario name'
```

```sh
bun run test:features
```

`bun run test` includes the same feature suite. The native root regression checks
the complete committed inventory through the actual CLI and verifies every
observation under the saved 15-second feedback policy. A copied archive fixture
runs the same complete inventory through the native CLI under that same deadline,
preserving budget and archive-loader coverage. Development source comparisons
use the separate TypeScript oracle; it is never a production engine choice.
CI saves the native regression's actual report as the `bonsai-self-check` artifact,
including its decision, evidence, inventory, and phase timings. Inspect completion
and observation counts alongside timings when comparing workflow runs.

During stabilization, remediation of the root's size overage is deferred. The
regressions require complete passing behavior and contract ancestry for every
retained component; the size overage remains visible in the real gate verdict.
Development comparisons and benchmarks live in `test/native/`, stay measured,
and inherit ancestry through their actual contracted production subjects.

`bun run bonsai check` inspects the committed root inventory and
policy. Owned source, tests, contracts, documentation, and configuration remain
measured; installed third-party CLI skills and the separate checkout example stay
outside that scope. The root policy keeps its 20,000-token bootstrap, 30,000-token
hard limit, and 15-second feedback ceiling. Fixed entry-point relationships now
connect its CLI and both workers. The current inventory still exceeds the allowance,
while all retained components have contract ancestry. Complete feature evidence
therefore still produces a genuine rejection for the deferred size overage.

Until the first mature release, this root allowance overrun does not block
development delivery. Checks still report the actual verdict under the unchanged
policy; this temporary development priority does not change acceptance in
consuming projects.

The unused Oxc prototype was deleted when tsrs replaced it. Its Cargo files and
Rust sources were removed rather than excluded. Authored Rust in consuming
projects remains unsupported and measured until a language adapter exists.

## Install and publish an alpha

After the native release is published, users can run it without a checkout or
compilation:

```sh
bunx --bun @jigging/bonsai@alpha init
bunx --bun @jigging/bonsai@alpha check --verbose
```

For reproducible CI, select a published version explicitly, for example
`bunx --bun @jigging/bonsai@0.0.0-alpha.1 check --json` after that release exists.
The npm package downloads the matching prebuilt dependency through optional
packages; no install script or dependency-trust approval builds it locally.

The published `0.0.0-alpha.0` package predates the native implementation. This
checkout prepares `0.0.0-alpha.1`; a GitHub update alone does not publish it or move
the npm `alpha` tag. Validate the actual tarball in a fresh consumer before release.
It must run outside this checkout with production dependencies, scripts disabled,
and no native binary override.

Publish a new version explicitly with `bun publish --access public --tag alpha`.
`publishConfig` declares public access and the `alpha` tag; pass the tag to prevent
prereleases using `latest` across client versions. Preview contents with
`bun pm pack --dry-run --ignore-scripts`. Runtime sources, the skill, documentation,
and example are included; development compiler oracles and tests are not.

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

The same registry is statically resolved and executed. Bonsai owns the response assertions; a binding cannot declare an observation passed by merely entering a step. Every scenario outline row becomes a separate scenario, and every observation in that scenario remains a required check. Duplicated scenarios and files do not create extra allowance. Array indices normalize for accounting: `items[0].price` and `items[3].price` both count as `items[*].price`. Their assertions still check the exact positions.

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

### Optional control-flow nesting limit

A team can enforce a reviewed nesting limit independently of retained-token cost.
For example, add this optional setting inside `policy` in `bonsai.json`:

```json
"structural": { "metric": "control-depth-v1", "maxDepth": 4 }
```

There is no default structural limit. Four is an illustrative policy choice, not
a universal quality boundary. Existing configurations keep their behavior.
A complete measurement above the selected limit rejects; a missing or partial
required measurement is incomplete. With `--base`, the effective reviewed base
policy supplies this setting just like the code allowance.

The source-level metric starts each function, method, accessor, constructor,
and closure at zero. Nested conditionals, conditional expressions, loops,
`switch`, and catch branches add one. Direct else-if chains and equivalent
single-if else blocks remain at the same level; switch arms do not add another
level. Conditions and loop headers are within their enclosing decision.
Plain blocks, class indentation, try/finally wrappers, whitespace, and async
syntax add no depth by themselves. Parameter initializers belong to the function;
computed method names and decorators belong to their surrounding lexical region.
Code outside function-like bodies is measured as a module lexical region, without
claiming it executes during module loading. Logical operator chains are not a
separate control-depth increment.

JSON `snapshot.source.controlDepth` exposes the version, completeness, region
locations, maximum depth, and first deepest location. These are structural facts,
not runtime coverage or a proof that every statement is necessary. Splitting a
helper can reduce local depth without reducing retained cost; all files remain
fully charged. TypeScript syntax is measured before compiler desugaring.

The current metric requires a nonempty maintained TypeScript scope. Recognized
Python (including stubs), Rust, JavaScript, JSX, and TSX files leave diagnostics
partial; enabling the requirement then reports incomplete until their language
adapter supports the metric. Data files remain charged without blocking it.
Executable metadata, when supplied by an adapter, also prevents an unsupported
file from being claimed as measured. This is a bounded file-type and metadata
check, not universal detection of embedded executable code.

## Agent loop

```sh
bun run bonsai check --root /path/to/project --json
bun run bonsai explain src/orders.ts#placeOrder --root /path/to/project
```

Read the violations, simplify the actual candidate, preserve its required behavior, and rerun. `explain` returns the component's check ancestry and incoming/outgoing relationships with source references. It performs static analysis without executing handlers.

Explanation JSON adds `contractPaths` with one concrete dependency route per
obligation and subject, and `verificationSubjects` with test-to-subject reference
paths and inherited support paths. Registry roots are marked separately. These
are static associations, not evidence that supporting tests ran.
Human explanations show the same contract routes, registry attachment, and static
test-subject/support paths. `--limit` bounds each detail list; JSON stays complete
and plain columns remain stable. Inspection never runs handlers or supporting tests.

Exit codes are **0 pass**, **1 reject**, **2 incomplete or invalid input**. Both reject and incomplete block acceptance. JSON check output contains the decision, file costs, graph, obligations, evidence, and content fingerprint.

For a Git repository configured at its root:

```sh
bun run bonsai check --root /path/to/project --base origin/main --json
```

The base is read from an archive without running its code. Its `bonsai.json` supplies the candidate's rules and inventory by default, so changing the candidate's policy does not enlarge its allowance. Base reporting compares retained size and contract surface; it does not claim that the historical base passed verification. `--policy /trusted/bonsai.json` explicitly overrides this configuration. A trusted CI deployment must control that argument and the checker executable. `--base` requires `--root` to be the Git repository root; the nested checkout example uses standalone checks. Git comparisons accept a symlink to that root, including macOS temporary-directory aliases. Reports retain the selected root spelling, and explicit relative policy paths still resolve from the invocation directory.

## What the prototype establishes

- Top-level functions, classes, variables, and type declarations are separate components. Importing one function does not retain every declaration in its file.
- Contracted handlers root production dependencies through TypeScript symbol references, including imports, aliases, and type references.
- A unit test can inherit ancestry from retained production subjects. It cannot root another production subject or a dead dependency cycle.
- Tests are identified by `test/`, `tests/`, `.test.`, or `.spec.` paths. This is static subject association, **not evidence that the unit tests passed**.
- Verification runs in fresh subprocesses with a shared deadline, so stale module caches and nonterminating handlers cannot silently pass. Feedback time includes candidate collection and execution, excluding optional base analysis and final report formatting.
- Evidence is bound to the maintained content and effective configuration. Changes during verification, missing obligations, failed assertions, and mismatched evidence block acceptance.

Evidence reports require the `bonsai-evidence-v2` schema marker and validated
fact shapes. Candidate fingerprints also include presence and content of root
Bun, npm, Yarn, and pnpm lockfiles, even when those files are excluded from
retained cost. Versioned snapshots and matching checker/toolchain/Bun content
identities bind execution facts to their collector; older evidence must be
regenerated. This does not authenticate hostile execution or attest every
installed dependency.

Optional `runners` in `bonsai.json` require fresh Vitest JSON, Cucumber Messages,
or Stryker JSON reports in addition to product observations. Missing, failed,
skipped, stale, or insufficient results block the configured gate. Coverage and
mutation floors grant no allowance or ancestry. See [supporting verification](docs/verification.md)
for exact supported formats, runtime requirements, limits, and configuration.

## Limits and next steps

This is a static ancestry approximation. Classes and function bodies are atomic; Bonsai does not yet prove necessity of individual methods or statements. References establish eligibility, not actual use or minimality. HTTP routes, queues, dependency injection, computed dispatch, side-effect-only imports, general asset reads, and dynamically accessed module exports need adapters. Literal dynamic imports support statically selected named exports, including named destructuring within functions. General computed module paths and computed namespace selections remain incomplete; this is not comprehensive detection of dynamic behavior. Use straightforward named handlers for this release.

Bonsai's internal binding-loader adapter recognizes the exact collector pattern
that imports a validated project target. Before importing, it checks the selected
registry's inventory membership and the effective configuration/content fingerprint.
Its evidence includes a matching loading receipt; missing or mismatched receipts
block acceptance. The recorded boundary grants no ancestry to unrelated handlers
or exports. This adapter does not authorize arbitrary application runtime imports.
Fixed Bun/Node child entry points are supported as described below. The supported
checkout example is available through `bun run bonsai check --root examples/checkout`.

The production backend uses the pinned tsrs TypeScript 7 checker. A separate
development oracle uses TypeScript 5.9; shared lexical parsing and graph rules
preserve Bonsai's supported accounting. The native adapter explicitly preserves
ambient type discovery and blocks known semantic gaps, including disabling the
default library through a source directive. This is not universal compiler
compatibility. See [native scope and commands](docs/native-prototype.md) and
[performance measurements](docs/performance.md).

### Literal text resources

A production or binding component can read a maintained text file through a named
`node:fs` `readFileSync` import, including a named alias:

```ts
import { readFileSync } from 'node:fs'

export function greeting() {
  return readFileSync(new URL('./message.txt', import.meta.url), 'utf8')
}
```

Include the resource in maintained inventory. The adapter follows only a direct,
unshadowed global `new URL(literal, import.meta.url)` and literal `'utf8'` or
`'utf-8'` encoding. It creates one `message.txt#<resource>` file-data component,
with a static reference from each read owner and the actual call location.
`explain` can trace that component without executing the reader. Reading source
as text does not retain any functions or exports in that source.

Supported suffixes are `.txt`, `.json`, `.sql`, `.md`, `.markdown`, `.html`,
`.htm`, `.css`, `.svg`, `.yaml`, `.yml`, `.toml`, `.ini`, `.xml`,
`.graphql`, `.gql`, `.csv`, `.tsv`, `.ts`, `.mts`, and `.cts`. Bytes must
be valid UTF-8 without binary control characters. Unknown formats and binary
assets need a separate metric. Missing, unmaintained, symlinked, or escaping
targets block analysis; search, fragments, encoded separators, and computed
module-relative URL selections are unsupported.

This is a bounded static dependency adapter. URL aliases, imported URL
constructors, namespace/default filesystem imports, asynchronous reads, and
ordinary runtime input paths are outside its claim. Test fixture ownership is
also outside this slice: test-only reads add no resource component or production
ancestry. Every maintained file still counts once at full cost. A dormant reader
cannot justify a resource; after deleting its last recognized reader, the file
remains fully charged but has no automatic orphan-resource finding.

### Fixed child entry points

A contracted handler can launch a maintained TypeScript entry point through named
`node:child_process` imports. For example:

```ts
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('./worker.ts', import.meta.url))
export function runWorker() {
  const result = spawnSync(process.execPath, [entry], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr)
  return JSON.parse(result.stdout)
}
```

Include `worker.ts` in maintained inventory. `spawn`, `spawnSync`, `execFile`, and
`execFileSync` recognize this runtime/path form. `fork` also accepts a direct
`new URL('./worker.ts', import.meta.url)` with an optional literal argument array.
Pass an explicit argument array before `fork` options.
Named aliases and `const { fork } = await import('node:child_process')` work too.
Explicit options must be a literal object, with no shell or runtime override;
`fork` permits an empty `execArgv`. These are static connections, not runtime coverage.

The launch retains executable top-level statements and immediately effectful
initializers, then follows their references. It does not retain every export.
Class definition effects in the selected child entry count too: static blocks,
effectful static fields, computed member names, heritage evaluation, and decorators.
Dormant methods, constructors, and instance field initializers do not create
startup ancestry; a retained class still counts as one atomic component.
Unused functions and inert exports remain unrooted, and every file still consumes
its full retained cost. Tests can inherit subjects through test helpers, but never
root production code. `explain` shows these relationships without starting children.

Computed paths, cwd-relative strings, mutable URL aliases, wrappers around launch
APIs, and shell-selected commands receive no entry-point relationship. A recognized
local target outside inventory or in an unsupported language blocks verification.
General import side effects need further adapters.

The worker executes project code with the developer's privileges. Its process boundary provides timeout and module-cache separation, **not isolation from hostile code**. It does not attest runtime identity or defend against malicious code forging process messages. Run untrusted candidates in an external sandbox. The fingerprint is a content identity for this prototype, not a complete supply-chain or execution-environment attestation.

Configured supporting-runner evidence and explicit coverage/mutation floors are
implemented for the formats documented above. The optional control-depth guard is the first concrete structural quality rule; broader structural requirements, execution-aware
fixture ownership, trusted checker distribution, authoritative merge-candidate
enforcement, and branch protection remain unfinished. The repository's CI checks
the implementation, its executable product contracts, its example, and explicit
release smoke tests; it is not the trusted admission system described in the
design. See [the design](docs/design.md) and [the implementation roadmap](docs/roadmap.md).

