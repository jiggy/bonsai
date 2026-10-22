---
name: cli-audit
description: >
  Audit a CLI against the cli-design-system standards. Evaluates four layers:
  contract (flags, exit codes, I/O), UX (help, errors, copy quality),
  UI (color, layout, components), and documentation. Produces a scored report
  with violation map and command health dashboard. Use when you want to
  evaluate an existing CLI against standards.
disable-model-invocation: true
---

# Workflow: Audit an Existing CLI

<required_reading>
**Read these reference files NOW before auditing:**
1. skills/cli-design-system/references/principles.md
2. All references in skills/cli-design-system/references/ for the layer(s) being audited
3. skills/cli-design-system/references/ux/copy-style.md (always — copy quality applies to all layers)
</required_reading>

<process>

## Step 1: Identify Audit Scope

Ask the user:
- **What CLI is being audited?** (name, brief description)
- **Audit scope:** Full audit (all 3 layers) or specific layer(s)?
- **How to access it:** Is it installed? Can we run `--help`? Is there source code to read?

## Step 2: Enumerate All Commands

Build a complete command inventory before auditing anything. This is the foundation for both phases.

**Discovery methods (use all available):**

```bash
# From help output
tool --help
tool help

# Recursive subcommand discovery
tool <group> --help          # For each group found in root help

# From source code (if available)
# Search for command registration patterns (e.g., cobra.Command, click.command, clap::Command)
```

**Produce a Command Inventory Table:**
```
#   Command                  Type        Has Help   Flags (list each)              Produces Output   Blocks?
1   tool init                action      ✓          --name, --template             no (side effect)  no
2   tool list                query       ✓          --json, --all, --sort, -q, -v  yes (table)       no
3   tool serve               blocking    ✓          --port, --host, --debug        yes (log stream)  yes
4   tool delete <name>       destructive ✓          --force, --yes                 yes (confirmation) no
...
```

**Inventory accuracy rules:**
- **List every flag by name**, not just a count. Counts are derived from the list, never stated independently. If the list shows 2 flags, the count is 2 — no discrepancies.
- Run `tool <command> --help` for each command and extract flags from the actual output.
- If source code is available, cross-reference help output with registered flags to catch hidden or undocumented flags.
- Flag count = number of distinct flags listed in the Flags column. Do not estimate.

**Command type classification:**
- **query** — reads and displays data (list, show, get, status, logs)
- **action** — creates or modifies state (create, update, set, init, deploy)
- **destructive** — deletes or irreversibly modifies (delete, purge, reset)
- **blocking** — runs indefinitely or until interrupted (serve, watch, tail)

This inventory drives both audit phases. Count: **N total commands.**

## Step 2b: Capture Output Samples

For each command, capture actual terminal output for both success and failure paths. These samples are used in Phase A for style consistency checking.

**For each command, run and record:**
1. Happy path (normal execution)
2. Primary failure path (missing input, missing dependency)
3. Help output (`--help`)

**Compare samples side by side to identify:**
- Header format inconsistencies (does every command use `brand · context`?)
- Glyph usage inconsistencies (are the right glyphs used with fixed colors?)
- Summary format inconsistencies (do all summaries use `·` separator, omit zeros?)
- Spacing/indentation inconsistencies (1 blank line between sections, 2-space detail indent?)
- Tone/wording inconsistencies in similar messages across commands

**Glyph codepoint check:** When capturing output, also verify glyph codepoints match the glyph table (see "Glyph Codepoint Verification" in Phase A). Visually identical glyphs with wrong codepoints are a common source of subtle inconsistency.

This step feeds the "Output Copy and Style Consistency" section of the checklist.

## Step 3: Behavioral Anomaly Discovery

**Behavioral anomalies are separate from violations.** A violation is a design gap (something is missing or doesn't follow standards). A behavioral anomaly is where the CLI contradicts its own declared contract — help text says X, but the CLI does Y.

Run each command through basic failure scenarios and record anything that contradicts the CLI's declared behavior.

**For each command, test:**
1. Valid input (happy path — does it work at all?)
2. Missing required input (no args when args are needed)
3. Invalid input (nonexistent path, malformed data, wrong type)
4. Invalid env var values (e.g., `TOOL_PORT=abc` for numeric vars)
5. Missing dependencies (missing DB, missing config, offline network)
6. Interrupt handling (Ctrl-C during execution)

**Regression check (when previous audit exists):**

If this is a re-audit after fixes were applied, cross-reference current findings against the previous audit's fixed items. Flag anything that was marked as fixed but now fails again:

```
REGRESSION: Ingest summary zero counters
  Previous: Fixed in v1.4.1 (ANOM-3 from audit #2)
  Current: "1 files · 0 chunks" still shows zero counters
  Severity: P2 (escalated from P3 — regressions are +1 severity)

REGRESSION: Global flag ordering
  Previous: Fixed in v1.5.0 (ANOM-1 from audit #3)
  Current: Flags BEFORE subcommand now silently ignored (new anomaly from the fix)
  Severity: P1 (fix-induced anomaly, not same issue recurring)
```

Regressions should be:
- Highlighted in the Behavioral Anomaly Report with a `REGRESSION` tag
- Escalated +1 severity level (a re-broken fix indicates the issue wasn't fully resolved)
- Distinguished from fix-induced anomalies (new issue caused by the fix vs same issue recurring)

If no previous audit exists, skip this check.

**Behavioral anomaly report format:**

```
ANOM-1: search --json emits styled error instead of JSON on missing DB
  Command:   tool search --json "query"
  Scenario:  Database file doesn't exist
  Expected:  JSON error object to stderr, non-zero exit (per --json contract)
  Actual:    Styled/colored error message to stdout, exit 1
  Severity:  P1 — breaks JSON consumers, violates --json contract
  Related:   Also affects: tool stats --json (same behavior observed)

ANOM-2: ingest returns exit 0 on nonexistent path
  Command:   tool ingest /nonexistent/path
  Scenario:  Path doesn't exist
  Expected:  Error message, exit 1
  Actual:    "No files found" to stdout, exit 0
  Severity:  P0 — CI pipelines treat this as success
```

**Behavioral anomalies go in their own section of the report, before the violation map.** They are more urgent than design violations because they represent broken promises, not missing features.

## Step 4: Audit System-Level Standards

Evaluate standards that apply to the CLI as a whole (not per-command). These are assessed once:

**4a. Command Structure (system-level)**
- [ ] Consistent grammar pattern across all commands
- [ ] Standard verbs used (create/list/show/update/delete)
- [ ] Subcommand depth ≤ 3 levels
- [ ] No ambiguous or similarly-named commands
- [ ] Group commands show help, not implicit actions
- [ ] Command names lowercase, 2-9 chars, no system collisions

**4b. Configuration and Telemetry (system-level)**
- [ ] Config files in XDG-compliant location (not `~/.<tool>`)
- [ ] Clear precedence: flags > env vars > config > defaults
- [ ] Environment variables prefixed with tool name
- [ ] Standard env vars respected (NO_COLOR, EDITOR, etc.)
- [ ] Config file format supports comments
- [ ] No telemetry/phone home without explicit consent (opt-in preferred, opt-out acceptable with clear first-run notice)
- [ ] Invalid config reported with line numbers
- [ ] Env vars with typed values (numbers, paths, enums) reject invalid input with actionable error (not stack trace)

**How to test env var validation:** For every env var that parses a number, path, or enum, test with garbage input:
```bash
TOOL_PORT=abc tool serve        # Should: "Invalid TOOL_PORT: 'abc' (must be a number 1-65535)"
TOOL_DB=/nonexistent tool query # Should: "Database not found: /nonexistent"
TOOL_FORMAT=xml tool list       # Should: "Invalid TOOL_FORMAT: 'xml' (valid: json, table, plain)"
```
If any produce a stack trace → Behavioral anomaly. If they silently use a default → Violation (silent failure).

**4c. Global Flags (system-level)**
- [ ] `--version` / `-V` works on root command
- [ ] `--version` output format is parseable: `programname X.Y.Z` to stdout (not a paragraph, not build metadata by default)
- [ ] `--no-color` flag available
- [ ] `--json` available as global or per-command flag
- [ ] `--quiet` / `--verbose` available
- [ ] Global flags work on all subcommands

**4d. Short Flag Coverage (system-level)**

Build a short flag audit from the inventory. For flags used in 2+ commands or used frequently, verify short forms exist.

```
Long flag       Commands    Short form   Status
--json          5/9         -j           ✗ MISSING — recommend -j
--debug         3/9         -d           ✓
--limit         4/9         (none)       ✗ MISSING — recommend -l
--detail        2/9         -d           ✗ CONFLICT with --debug
--verbose       global      -v           ✓
```

Check for conflicts: two different long flags wanting the same short letter. Flag conflicts where the same short flag maps to different long flags across commands (caught in cross-command consistency) are P1; missing short forms for frequent flags are P2.

**4e. Cross-Command Flag Consistency (system-level)**

Compare flags across all commands. Flags that refer to the same concept must use the same name.

- [ ] Same concept uses same flag name everywhere
- [ ] Short flag letters not reused for different meanings across commands
- [ ] Flag value types consistent across commands
- [ ] Flags that accept the same resource use the same format

**How to check:** Build a flag cross-reference from the inventory:
```
Flag name         Commands where it appears   Meaning
--db              ingest, query, stats        Database name
--database-path   init                        Database file path   ← INCONSISTENCY if --db also accepts paths
-v                serve, ingest               --verbose
-d                query                       --debug
                  delete                      --dry-run            ← CONFLICT: same short flag, different meaning
```

Inconsistencies here are Contract > Flags violations, typically Major (P1) severity.

**4f. Top-Level Exception Handling (system-level)**

Check whether the CLI handles exceptions gracefully. This is a **systemic P0 issue** because without proper handling, every unhandled exception produces a raw stack trace.

**How to verify:**
```bash
tool nonexistent-command 2>&1        # Should not traceback
tool command --invalid-flag 2>&1     # Should not traceback
tool command /nonexistent 2>&1       # Should not traceback
# Ctrl-C during execution            # Should not traceback
TOOL_VAR=garbage tool command 2>&1   # Should produce actionable error, not stack trace
tool blocking-cmd &; sleep 2; kill $! # Should have printed startup message within 2s
```

If any produce a raw stack trace → confirmed P0 systemic (every command is likely vulnerable).

**4g. Signal Handling (system-level)**
- [ ] SIGINT (Ctrl-C): graceful shutdown, no traceback
- [ ] SIGTERM: graceful shutdown with cleanup
- [ ] SIGPIPE: silent exit
- [ ] Second Ctrl-C forces immediate exit

**4h. Color System (system-level)**

All four disable mechanisms must work. Missing ANY is a FAIL:

- [ ] `NO_COLOR` env var disables color
- [ ] `TERM=dumb` disables color
- [ ] `--no-color` flag disables color
- [ ] Non-TTY stdout disables color (test: `tool list | cat`)
- [ ] `FORCE_COLOR` env var forces color
- [ ] Semantic color usage consistent across commands
- [ ] Color never sole indicator (symbols/labels accompany)
- [ ] Works on light and dark backgrounds

**How to test (all four):**
```bash
NO_COLOR=1 tool list                   # No ANSI codes
TERM=dumb tool list                    # No ANSI codes
tool list --no-color                   # No ANSI codes (flag must exist)
tool list | cat -v                     # No ^[[... sequences
FORCE_COLOR=1 tool list | cat -v       # ANSI codes present even in pipe
```

**4i. Discoverability (system-level)**
- [ ] Shell completions available (bash, zsh, fish)
- [ ] Root help groups commands by workflow, not alphabetically

**"Did you mean?" test:** Run a plausible typo and document exactly what the user sees:
```bash
tool serch                             # Typo of "search"
```
- Best: `Did you mean 'search'?` with option to run it
- Acceptable: Lists valid commands (user finds it themselves)
- Bad: Just "unknown command 'serch'" with no help
- Document the actual output verbatim.

**4j. Blocking Command Startup Feedback (system-level)**

For every command classified as **blocking** in the inventory:
- [ ] Prints something to stderr before blocking (e.g., "Listening on http://localhost:8080")
- [ ] Shows progress during long-running phases (e.g., "Loading index...")
- [ ] Ctrl-C exits gracefully with status message

**Silence on startup is a P1 violation.** The user cannot tell if the command is working, hanging, or crashed.

**When a blocking command can't be tested live** (e.g., requires a running service, database, or network setup), attempt a partial behavioral test:

1. Run the command and wait 5-10 seconds — did it print anything before blocking?
2. Send Ctrl-C — did it exit cleanly or produce a traceback?
3. If the command can't start at all (missing dependency), mark findings as `[inferred]` with the behavioral evidence:
   - "Waited 10 seconds after launch, no output before blocking → [inferred] no startup message"
   - "Ctrl-C produced raw traceback → [confirmed] no signal handling"

Mark as `[untested]` only when the command cannot be launched at all and no behavioral observation is possible.

## Phase A: Violation Map (systemic view)

For each checklist item that can be evaluated per-command, test **every command** in the inventory and group results by violation, not by command.

**Per-command checklist items to evaluate across all commands:**

| Check | Layer | Reference |
|-------|-------|-----------|
| `-h` / `--help` works | Contract > Flags | skills/cli-design-system/references/contract/flags.md |
| All flags have long forms | Contract > Flags | skills/cli-design-system/references/contract/flags.md |
| Flag names use kebab-case | Contract > Flags | skills/cli-design-system/references/contract/flags.md |
| No secrets accepted via flags | Contract > Flags | skills/cli-design-system/references/contract/flags.md |
| Boolean flags use `--no-*` negation | Contract > Flags | skills/cli-design-system/references/contract/flags.md |
| Flags are order-independent (see testing guidance below) | Contract > Flags | skills/cli-design-system/references/contract/flags.md |
| ≤ 3 positional arguments | Contract > Args | skills/cli-design-system/references/contract/arguments.md |
| `--` delimiter supported | Contract > Args | skills/cli-design-system/references/contract/arguments.md |
| `-` accepted for stdin (where applicable) | Contract > Args | skills/cli-design-system/references/contract/arguments.md |
| No hanging on TTY stdin | Contract > Args | skills/cli-design-system/references/contract/arguments.md |
| Exit 0 only on success | Contract > Exit | skills/cli-design-system/references/contract/exit-codes-and-signals.md |
| Correct exit code on failure scenarios | Contract > Exit | skills/cli-design-system/references/contract/exit-codes-and-signals.md |
| Exit 2 on usage errors | Contract > Exit | skills/cli-design-system/references/contract/exit-codes-and-signals.md |
| No exit 0 on partial failure | Contract > Exit | skills/cli-design-system/references/contract/exit-codes-and-signals.md |
| Data on stdout, status on stderr | Contract > I/O | skills/cli-design-system/references/contract/io-streams.md |
| No color in non-TTY stdout | Contract > I/O | skills/cli-design-system/references/contract/io-streams.md |
| `--json` available (data-producing cmds) | Contract > I/O | skills/cli-design-system/references/contract/io-streams.md |
| `--plain` available (data-producing cmds) | Contract > I/O | skills/cli-design-system/references/contract/io-streams.md |
| Piping works correctly | Contract > I/O | skills/cli-design-system/references/contract/io-streams.md |
| Output ends with newline | Contract > I/O | skills/cli-design-system/references/contract/io-streams.md |
| Help includes usage string | UX > Help | skills/cli-design-system/references/ux/help-system.md |
| Examples in help (≥ 2) | UX > Help | skills/cli-design-system/references/ux/help-system.md |
| Flag descriptions: lowercase, no period, defaults | UX > Help | skills/cli-design-system/references/ux/help-system.md |
| Help goes to stdout, exits 0 | UX > Help | skills/cli-design-system/references/ux/help-system.md |
| No ANSI escape codes in piped help | UX > Help | skills/cli-design-system/references/ux/help-system.md |
| Errors are actionable (what + why + fix) | UX > Errors | skills/cli-design-system/references/ux/error-messages.md |
| No raw stack traces | UX > Errors | skills/cli-design-system/references/ux/error-messages.md |
| Invalid values show valid options | UX > Errors | skills/cli-design-system/references/ux/error-messages.md |
| Progress for operations > 1s | UX > Feedback | skills/cli-design-system/references/ux/progress-and-feedback.md |
| Progress on stderr, not stdout | UX > Feedback | skills/cli-design-system/references/ux/progress-and-feedback.md |
| Startup feedback for blocking commands | UX > Feedback | skills/cli-design-system/references/ux/progress-and-feedback.md |
| Prompts only when stdin is TTY | UX > Interactivity | skills/cli-design-system/references/ux/interactivity.md |
| Every prompt has flag alternative | UX > Interactivity | skills/cli-design-system/references/ux/interactivity.md |
| Destructive ops require confirmation | UX > Interactivity | skills/cli-design-system/references/ux/interactivity.md |
| Header suppressed when piped | UI > Typography | skills/cli-design-system/references/ui/typography-and-spacing.md |
| Tables: aligned columns | UI > Components | skills/cli-design-system/references/ui/terminal-components.md |
| Key-value: aligned values | UI > Components | skills/cli-design-system/references/ui/terminal-components.md |
| Empty states handled | UI > Components | skills/cli-design-system/references/ui/terminal-components.md |
| Consistent glyph system (unique per state, fixed color) | UI > Components | skills/cli-design-system/references/ui/terminal-components.md |
| Tree chars for parent-child sub-items | UI > Components | skills/cli-design-system/references/ui/terminal-components.md |
| Summary omits zero counters | UI > Components | skills/cli-design-system/references/ui/terminal-components.md |
| JSON compact by default (pretty only on TTY) | UI > Components | skills/cli-design-system/references/ui/terminal-components.md |
| Errors in --json mode are JSON objects | UI > Components | skills/cli-design-system/references/ui/terminal-components.md |
| Voice and tone (direct, calm, specific — not apologetic/dramatic/vague) | UX > Copy | skills/cli-design-system/references/ux/copy-style.md |
| Preferred vocabulary, no forbidden words | UX > Copy | skills/cli-design-system/references/ux/copy-style.md |
| Correct tense (gerund in-progress, past completed, future dry-run) | UX > Copy | skills/cli-design-system/references/ux/copy-style.md |
| Sentence case, punctuation rules (· separator, → arrows, no period on single-line) | UX > Copy | skills/cli-design-system/references/ux/copy-style.md |
| Message length within limits (success 1 line, error 2-3, summary 1) | UX > Copy | skills/cli-design-system/references/ux/copy-style.md |
| No copy anti-patterns (robotic, marketing, log-style, passive, filler) | UX > Copy | skills/cli-design-system/references/ux/copy-style.md |
| Flag descriptions: lowercase, no period, defaults shown | UX > Copy | skills/cli-design-system/references/ux/copy-style.md |
| Output follows anatomy (header → body → detail → summary → next step) | UI > Typography | skills/cli-design-system/references/ui/typography-and-spacing.md |
| Consistent text hierarchy | UI > Typography | skills/cli-design-system/references/ui/typography-and-spacing.md |
| Fits 80-column terminal | UI > Typography | skills/cli-design-system/references/ui/typography-and-spacing.md |

### Flag Position Testing

**How to test flag ordering:**

For each global flag (`--no-color`, `--debug`, `--quiet`, `--verbose`):
```bash
tool --flag command args     # Flag before subcommand
tool command --flag args     # Flag after subcommand
tool command args --flag     # Flag at end
```

All three positions must produce identical behavior. If the CLI uses argparse with subparsers, global flags defined only on the root parser will fail in positions 2 and 3 — this is a common bug. Test explicitly.

For command-specific flags:
```bash
tool command --flag args     # Before args
tool command args --flag     # After args
```

Both must work identically.

### Glyph Codepoint Verification

Don't trust visual inspection — glyphs that look similar may be different codepoints. Verify by inspecting raw output:

```bash
tool command 2>&1 | python3 -c "
import sys
for char in sys.stdin.read():
    if ord(char) > 127: print(f'U+{ord(char):04X} {char}')
"
```

Cross-reference each glyph against the glyph table in `skills/cli-design-system/references/ui/terminal-components.md`:

| Expected | Codepoint | Common wrong alternatives |
|----------|-----------|--------------------------|
| `✓` | U+2713 | `✔` (U+2714) |
| `✗` | U+2717 | `✕` (U+2715), `✘` (U+2718) |
| `△` | U+25B3 | `▴` (U+25B4), `▲` (U+25B2) |
| `−` | U+2212 | `✕` (U+2715), `-` (U+002D) |
| `·` | U+00B7 | `•` (U+2022), `∙` (U+2219) |
| `→` | U+2192 | `➜` (U+279C), `→` correct but verify |

Wrong codepoints that render identically are a P3 violation — they work but deviate from the design system's intentional choices.

### Exit Code Failure Scenarios (mandatory)

**For each command**, test concrete failure scenarios and record actual vs expected exit codes. This is a P0 check — exit code correctness on failure is as critical as exit 0 on success.

**This table is mandatory, not optional.** Even if exit code anomalies were already found in Step 3 (Behavioral Anomaly Discovery), the scenario table must still be produced for every command. The anomaly report catches scenarios that were actively tested. The scenario table ensures systematic coverage — it tests every command against every applicable failure type, not just the ones that seemed likely to fail.

Commands with anomalies already documented in Step 3 should appear in this table with their anomaly ID referenced (e.g., "ANOM-2" in the Status column). Commands without known anomalies still need testing.

Do not skip this table because "the anomalies already cover it." The table's value is completeness, not redundancy.

```
EXIT CODE SCENARIO TABLE

Command          Scenario                    Expected Exit   Actual Exit   Status
tool ingest      nonexistent path            1               0             ✗ BUG
tool ingest      corrupted file              1               1             ✓
tool ingest      partial failure (3/5 ok)    1               0             ✗ BUG
tool lint        missing source dir          1               0             ✗ BUG
tool init        dir already exists          1               1             ✓
tool search      missing database            1               1             ✓
tool search      invalid query syntax        2               1             ~ PARTIAL (wrong code)
tool serve       port already in use         1               1             ✓
tool sync        no remote configured        1               0             ✗ BUG
```

**Scenarios to test per command type:**
- **query**: missing data source, empty result set (must be exit 0 — no results is not an error), invalid filter/query
- **action**: missing input, invalid input, already-exists conflict, partial failure
- **destructive**: target doesn't exist, permission denied
- **blocking**: port/resource conflict, missing dependency, Ctrl-C

**Special case — empty results:** Search/list/query commands that return zero results should exit 0. "I looked and found nothing" is success. "I couldn't look" is failure. Test this explicitly.

### Error Scenario Matrix (mandatory)

**For each command**, test common failure scenarios and document the actual error output. This goes beyond checking if errors go to stderr — it tests whether errors are actionable and well-formatted.

**This matrix is mandatory, not optional.** It serves a different purpose than the anomaly report. The anomaly report documents contract contradictions. The error scenario matrix evaluates error *quality* across all commands — even for errors that technically work but aren't actionable, don't go to stderr, or don't suggest a fix.

For each command, test at minimum:
- Missing primary input (no args, missing file, missing resource)
- Invalid primary input (wrong type, corrupted, nonexistent path)
- Permission/access errors (if applicable)
- Invalid environment variable values (for commands that read env vars)

Produce the matrix even if it overlaps with anomaly findings. Reference anomaly IDs where applicable but still fill in all columns (Actionable? To stderr? Exit Code? Raw Trace?).

A command can have zero anomalies but still fail this matrix — for example, an error that goes to stderr and exits 1 but says only "Error: failed" with no fix suggestion scores as "not actionable" in the matrix, even though it's not an anomaly.

```
ERROR SCENARIO MATRIX

Command          Scenario               Actionable?           To stderr?   Exit Code   Raw Trace?  Copy Quality
tool ingest      nonexistent path       ✗ "No files found"    ✓            0 (wrong)   no          Bad — no fix suggestion
tool ingest      corrupted file         ~ states what, no fix ✓            1           no          Partial — what but no why/fix
tool search      missing DB             ✗ styled, not JSON    ✗ (stdout)   1           no          Bad — generic message
tool search      invalid query          ✓ shows valid syntax  ✓            2           no          Good — what + why + valid options
tool lint        permission denied      ✗ raw OSError         ✓            1           YES         Bad — jargon, no fix
tool config      invalid env var        ✗ Python traceback    ✗ (stdout)   1           YES
```

**What makes an error actionable:**
- States what went wrong specifically (not just "error")
- States why (if determinable)
- Suggests how to fix it (a command to run, a flag to add, a file to check)
- Goes to stderr
- Returns appropriate exit code

**Copy quality ratings:**
- **Good:** States what failed + why + suggests exact fix command. Direct tone, specific values.
- **Partial:** States what failed but no fix suggestion, or vague/generic fix.
- **Bad:** Generic ("Error: failed"), apologetic tone, blames user, jargon-only, or no context.

Errors that show raw stack traces are Bugs, not violations. Errors that go to stdout instead of stderr are violations. Errors that aren't actionable are violations.

### Cross-Command Consistency Analysis

**Purpose:** Identify commands whose output diverges from the patterns established by other commands. These outliers are the primary source of consistency violations — detected by comparing observable output across all commands.

**How to check (run all commands and compare outputs):**

1. Run every command in the inventory and capture output for success, error, and help scenarios
2. For each output category, compare side by side across all commands:

```
OUTPUT CONSISTENCY TABLE

Category       Majority pattern (N/M commands)    Outliers
Header         "brand · context" on stderr (7/9)   lint: no header, stats: header on stdout
Summary        "N items · N errors" bold (6/9)     lint: "Found N items, N errors", serve: no summary
Error format   "✗ what\n  fix suggestion" (8/9)    lint: "ERROR: message" (different prefix and format)
Glyph usage    ✓/✗/△ with fixed colors (7/9)       lint: uses ✔/✘ (wrong codepoints), stats: no glyphs
Pipe behavior  Header suppressed (7/9)              lint: header still shows in pipe, stats: header in pipe
```

3. For each outlier, document the deviation from the majority pattern

**Key comparisons to make:**
- Do all commands producing file lists use the same alignment and glyphs?
- Do all error messages follow the same structure (glyph + what + fix)?
- Do all summaries use the same separator, zero-omission rule, and pluralization?
- Do all commands suppress decorative output when piped?
- Do all commands respond identically to `--no-color`, `NO_COLOR`, `TERM=dumb`?

**In the Violation Map:** When multiple violations cluster on the same command, group them:
```
tool lint output diverges from established patterns [confirmed] — 1/9 commands
  Affected: tool lint
  Evidence: Compared output of all 9 commands — lint deviates in header, summary, and glyph usage
  Consequences: header not suppressed in pipes, zero counters in summary, wrong glyph codepoints
  Fix type: fix-per-command (align lint output with the pattern used by 7/9 other commands)
  Note: This is the root cause of 3 other violations in this report
```

**Evidence-based severity assignment:**

Every violation must be backed by observed evidence, not assumptions. Use three evidence tiers:

| Tier | Label | Meaning | Severity impact |
|------|-------|---------|-----------------|
| **Confirmed** | `[confirmed]` | Reproduced: ran the command, observed the failure | Assign full severity per rubric |
| **Inferred** | `[inferred]` | Observable behavior strongly suggests the issue, but not directly tested for this specific check | Assign severity one level below rubric default |
| **Untested** | `[untested]` | Standard may apply but couldn't be verified | Flag as untested, do not assign severity — list separately as "Verification needed" |

**What counts as `[inferred]`:** Observable behavior that implies the issue without testing it directly. For example: "waited 10 seconds after launch, no output before blocking → [inferred] no startup message" is valid. Reading source code to check for missing print statements is NOT valid — that crosses from design evaluation into implementation review.

**Example:** `--` delimiter support. If the CLI's `--help` doesn't mention `--` and you haven't tested it, mark as `[untested]`. Only mark it as a confirmed violation if you test `tool cmd -- --flag-like-arg` and it fails.

**Produce a Violation Map:**

Group by violation. For each, list severity, evidence tier, affected commands, and count.

```
VIOLATION MAP

Critical (P0):
  Exit 0 on failure [confirmed]                4/10 commands
    Affected: tool ingest, tool lint, tool init, tool sync
    Evidence: Tested each with invalid input, observed exit 0 (see exit code table)
    Reference: skills/cli-design-system/references/contract/exit-codes-and-signals.md

  No top-level exception handler [confirmed]   systemic (all commands)
    Affected: tool * — no try/except in main(), raw tracebacks on any unhandled error
    Evidence: tool config with TOOL_PORT=abc produces Python traceback
    Reference: skills/cli-design-system/references/ux/error-messages.md

Major (P1):
  Missing --json flag [confirmed]               3/10 commands (data-producing)
    Affected: tool list, tool show, tool config list
    Evidence: --help shows no --json flag
    Reference: skills/cli-design-system/references/contract/io-streams.md

  Blocking command silent on startup [confirmed] 1/10 commands
    Affected: tool serve
    Evidence: Ran tool serve, no output for 10+ seconds until first request
    Reference: skills/cli-design-system/references/ux/progress-and-feedback.md

  TERM=dumb does not disable color [confirmed]   systemic
    Affected: tool * — ANSI codes emitted even with TERM=dumb
    Evidence: TERM=dumb tool list | cat -v shows ^[[... sequences
    Reference: skills/cli-design-system/references/ui/color-system.md

  Missing --no-color flag [confirmed]            systemic
    Affected: tool * — no --no-color flag exists
    Evidence: --help shows no such flag
    Reference: skills/cli-design-system/references/ui/color-system.md

Verification Needed:
  -- delimiter support [untested]               all commands
    Note: CLI uses argparse which handles -- by default, but not tested.
    Action: Test with `tool cmd -- --flag-like-arg` before assigning severity.
    Rubric default: Critical (P0) if confirmed broken

Summary: N Critical, N Major, N Moderate, N Minor violations
         + N anomalies (see Behavioral Anomaly Report)
         + N unverified items requiring testing
         across N commands
```

**Key properties of the violation map:**
- Systemic patterns are immediately visible ("all commands" = fix the error handler once)
- Fix effort is clear (fix once vs fix per-command)
- Severity ordering puts critical items first
- Affected count shows scope (3/10 vs 10/10)
- Reference links point to the standard for each violation
- Anomalies referenced but detailed in their own section

## Phase B: Command Health Dashboard

Score each individual command against applicable checklist items. This gives a per-command health overview.

**Scoring per command:**
- Evaluate only the checks that apply to that command's type (query/action/destructive/blocking)
- Score each check as Pass (1), Partial (0.5), or Fail (0)
- Anomalies count as failures in the relevant check category
- Calculate percentage: passes / applicable checks

**Produce a Command Health Dashboard:**

Apply grade boundaries from `scoring-rubric.md`:
- 85-100% Excellent | 70-84% Good | 50-69% Adequate | 30-49% Below | 0-29% Poor
- Critical failures cap the grade (see rubric for rules)
- Commands within 5% of each other must receive the same grade

```
COMMAND HEALTH DASHBOARD

Command                Score   Grade      Critical Fails   Anomalies   Top Issue
tool delete <name>     5/13    38%  Below*    3            0           No confirmation, exit 0, no examples
tool ingest            6/14    43%  Below*    2            2           Exit 0 on failure, no error handling
tool serve             7/12    58%  Adequate* 1            0      Silent startup, no feedback
tool create <name>     7/13    54%  Adequate* 2            0      Exit 0 on fail, no examples
tool list              9/14    64%  Adequate  0            0      Missing --json
tool config get        12/13   92%  Excellent 0            0      —

* Grade capped due to critical failures (see scoring rubric)

DISTRIBUTION
  Excellent (85%+):    1 command
  Good (70-84%):       2 commands
  Adequate (50-69%):   4 commands
  Below (30-49%):      2 commands
  Poor (<30%):         0 commands

Worst commands: tool delete (38%), tool ingest (43%)
Best commands:  tool config get (92%), tool show (81%)
```

**Dashboard properties:**
- Sorted by score (worst-first for prioritization)
- Grade distribution shows overall health at a glance
- "Critical Fails" column highlights commands with P0 issues — commands with critical failures are grade-capped regardless of numeric score
- "Anomalies" column separates broken contract promises from missing features
- "Top Issue" gives the single most impactful fix per command
- Asterisk (*) marks commands whose grade was capped by critical failure count

## Step 5: Compile Combined Report

Merge behavioral anomaly report, system-level findings, violation map, and command dashboard into a single report.

Use `audit-checklist.md` for the full structure.
Use `scoring-rubric.md` for weighted scoring.

**Audit self-consistency check (before delivery):**

Every item marked FAIL or PARTIAL in System-Level Findings (Section 2) must appear as a violation in the Violation Map (Section 3) with a severity level. Scan Section 2 and verify:

- Each FAIL item has a corresponding entry in Section 3
- Each PARTIAL item is either in Section 3 or noted as acceptable

If a System-Level finding is FAIL but intentionally excluded from the Violation Map (e.g., considered not applicable for this tool's scope), note it explicitly:

```
SIGTERM handling — FAIL in System-Level but excluded from Violation Map
because: Python runtime handles cleanup adequately for this tool's scope
```

A FAIL in Section 2 that silently disappears from Section 3 is an audit defect.

**Combined Report Structure:**

```
CLI Audit Report: <tool-name>
Date: <date>
Version: <version>
Commands audited: N

═══════════════════════════════════════
OVERALL SCORE: X/100
═══════════════════════════════════════

LAYER SCORES
  Contract:  X/40  — <one-line summary>
  UX:        X/40  — <one-line summary>
  UI:        X/20  — <one-line summary>

───────────────────────────────────────
SECTION 1: BEHAVIORAL ANOMALY REPORT
───────────────────────────────────────
  [Anomalies discovered in Step 3 — CLI contradicts its own declared contract]

───────────────────────────────────────
SECTION 2: SYSTEM-LEVEL FINDINGS
───────────────────────────────────────
  [System-level checklist results from Step 4]

───────────────────────────────────────
SECTION 3: VIOLATION MAP (systemic view)
───────────────────────────────────────
  [Full violation map from Phase A, including exit code and error matrices]

───────────────────────────────────────
SECTION 4: COMMAND HEALTH DASHBOARD
───────────────────────────────────────
  [Full dashboard from Phase B]

───────────────────────────────────────
SECTION 5: RECOMMENDATIONS
───────────────────────────────────────
  Behavioral anomalies (fix immediately):
    1. <anomaly> — <impact>
    2. ...

  Critical violations (fix next):
    1. <violation> — affects N commands — fix: <one-liner>
    2. ...

  Highest-leverage commands (worst scores):
    1. tool delete (38%) — 3 critical issues, 1 anomaly
    2. ...

  Audit complete. The findings can be used to plan improvements.
```

## Step 6: Deliver Report

Present the report. Highlight:
1. **Behavioral anomalies** — the CLI contradicts its own contract. Fix before anything else.
2. **Overall score** with interpretation (from scoring rubric)
3. **Systemic patterns** from the violation map (high-leverage fixes)
4. **Worst commands** from the dashboard (need the most attention)

Audit complete. The findings can be used to plan improvements:
- **Behavioral anomalies** are the highest-priority fixes
- The **violation map** drives task grouping (fix all missing `--json` at once)
- The **command dashboard** drives prioritization (worst-scoring commands first)

</process>

<success_criteria>
Audit is complete when:
- [ ] Complete command inventory built with types classified (including blocking commands)
- [ ] Behavioral anomaly discovery completed — each command tested against failure scenarios through observable behavior
- [ ] Anomalies documented separately with scenario, expected vs actual, severity (no source code references)
- [ ] System-level standards evaluated including: top-level exception handling, env var validation, all four color disable mechanisms, short flag coverage, "did you mean?" concrete test, blocking command startup
- [ ] Cross-command consistency analysis produced (comparing observable output across all commands)
- [ ] Exit code failure scenario table produced for every command
- [ ] Error scenario matrix produced for every command
- [ ] Copy quality evaluated per command: voice/tone, vocabulary, tense, punctuation, message length, anti-patterns
- [ ] Output anatomy validated per command: header → body → detail → summary → next step structure
- [ ] Violation map produced with evidence tiers (confirmed/inferred from behavior/untested)
- [ ] Command health dashboard produced with anomaly counts
- [ ] Combined report delivered with anomalies section before violations
- [ ] Systemic patterns identified (violations affecting many/all commands)
- [ ] Worst-scoring commands identified for prioritization
- [ ] Audit findings summarized for use in improvement planning
</success_criteria>
