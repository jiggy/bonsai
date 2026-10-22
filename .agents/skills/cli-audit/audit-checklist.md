# CLI Audit Checklist: <TOOL_NAME>

**Auditor:** <NAME>
**Date:** <DATE>
**Version audited:** <VERSION>
**Scope:** Full / Contract only / UX only / UI only
**Commands audited:** <N>

---

## Command Inventory

| # | Command | Type | Has Help | Flags (list each) | Produces Output | Blocks? |
|---|---------|------|----------|-------------------|-----------------|---------|
| 1 | `tool <cmd>` | query/action/destructive/blocking | ✓/✗ | --flag1, --flag2 | yes/no | yes/no |
| 2 | ... | | | | | |

**Types:** query (reads data), action (modifies state), destructive (deletes/irreversible), blocking (runs until interrupted)

---

## Behavioral Anomaly Report

_Anomalies are where the CLI contradicts its own declared contract — help text says X, but the CLI does Y. Separate from violations (design gaps). Fix anomalies before addressing violations._

| ID | Command | Scenario | Expected | Actual | Severity |
|----|---------|----------|----------|--------|----------|
| ANOM-1 | `tool <cmd>` | <trigger> | <expected behavior per declared contract> | <actual observed behavior> | P0/P1 |
| ANOM-2 | ... | | | | |

**Anomaly count:** <N> anomalies across <N> commands

---

## System-Level Standards

### Command Structure
- [ ] Consistent grammar pattern across all commands
- [ ] Standard verbs used (create/list/show/update/delete)
- [ ] Subcommand depth ≤ 3
- [ ] No ambiguous or similarly-named commands
- [ ] Group commands show help, not implicit actions
- [ ] Command names lowercase, 2-9 chars, no system collisions
- [ ] All commands contain a verb

### Configuration and Telemetry
- [ ] Config in XDG-compliant location (not `~/.<tool>`)
- [ ] Clear precedence: flags > env vars > project > user > defaults
- [ ] Env vars prefixed with tool name
- [ ] `NO_COLOR`, `EDITOR`, `PAGER`, `COLUMNS` respected
- [ ] Config file format supports comments
- [ ] Invalid config reported with line numbers
- [ ] Env vars with typed values reject invalid input with actionable error (not stack trace)
- [ ] No telemetry without explicit consent (opt-in preferred; opt-out with clear notice acceptable)
- [ ] Config debugging available (`--config-show` or equivalent shows resolved values and sources)

**Env var validation tests:**

| Env var | Type | Test value | Expected | Actual | Status |
|---------|------|-----------|----------|--------|--------|
| `TOOL_<VAR>` | number/path/enum | `<garbage>` | actionable error | | ✓/✗ |

### Global Flags
- [ ] `--version` / `-V` on root command
- [ ] `--version` output is parseable: `programname X.Y.Z` to stdout
- [ ] `--no-color` flag available
- [ ] `--json` available (global or per-command)
- [ ] `--quiet` / `--verbose` available
- [ ] Global flags work on all subcommands

### Short Flag Coverage

| Long flag | Commands | Short form | Status |
|-----------|----------|-----------|--------|
| --<flag> | N/M commands | -<x> / (none) | ✓ / ✗ MISSING / ✗ CONFLICT |

- [ ] Flags used in 2+ commands have short forms
- [ ] No short flag conflicts (same letter, different meanings across commands)

### Cross-Command Flag Consistency
- [ ] Same concept uses same flag name in all commands
- [ ] Short flags not reused for different meanings across commands
- [ ] Flag value types consistent across commands
- [ ] Resource identifier formats consistent across commands

**Flag cross-reference** _(fill from inventory)_:

| Flag name | Commands | Meaning | Consistent? |
|-----------|----------|---------|-------------|
| | | | ✓/✗ |

### Top-Level Exception Handling
- [ ] `KeyboardInterrupt` / Ctrl-C caught → exit 130, no traceback
- [ ] Known recoverable exceptions → human-friendly message to stderr
- [ ] Unexpected exceptions → brief error + "--debug for details" hint
- [ ] `--debug` flag reveals full traceback
- [ ] No raw stack traces in any scenario without --debug

**Exception handling tests:**

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| Unknown subcommand | error message | | ✓/✗ |
| Invalid flag | error message | | ✓/✗ |
| Invalid input file | error message | | ✓/✗ |
| Ctrl-C during execution | silent exit 130 | | ✓/✗ |
| Invalid env var value | actionable error | | ✓/✗ |

### Signal Handling
- [ ] SIGINT (Ctrl-C): graceful shutdown, no traceback
- [ ] SIGTERM: graceful shutdown with cleanup
- [ ] SIGPIPE: silent exit
- [ ] Second Ctrl-C forces immediate exit

### Color System

All four disable mechanisms must work. Missing ANY is a FAIL:

- [ ] `NO_COLOR` env var disables color
- [ ] `TERM=dumb` disables color
- [ ] `--no-color` flag disables color
- [ ] Non-TTY stdout disables color (`tool list | cat`)
- [ ] `FORCE_COLOR` env var forces color
- [ ] Semantic color usage consistent across commands
- [ ] Color never sole indicator (symbols/labels accompany)
- [ ] Works on light and dark backgrounds

**Color disable tests:**

| Mechanism | Test command | ANSI codes present? | Status |
|-----------|-------------|--------------------| --------|
| NO_COLOR | `NO_COLOR=1 tool list \| cat -v` | | ✓/✗ |
| TERM=dumb | `TERM=dumb tool list \| cat -v` | | ✓/✗ |
| --no-color | `tool list --no-color \| cat -v` | | ✓/✗ / N/A (flag missing) |
| Non-TTY | `tool list \| cat -v` | | ✓/✗ |

### Help Quality
- [ ] No ANSI escape codes in piped help (`tool --help | cat -v` — no `^[[` sequences)
- [ ] Root help includes docs URL or issue tracker link
- [ ] Long help output uses a pager (respects `$PAGER`)

### Discoverability
- [ ] Shell completions for bash, zsh, fish
- [ ] Root help groups commands by workflow

**"Did you mean?" test:**

| Typo input | Actual output (verbatim) | Quality |
|-----------|-------------------------|---------|
| `tool <typo>` | | Best/Acceptable/Bad |

### Blocking Command Startup
- [ ] Blocking commands print status before blocking (e.g., "Listening on ...")
- [ ] Long startup phases show progress
- [ ] Ctrl-C during blocking exits gracefully with status

| Blocking command | Startup message? | Ctrl-C clean? | Status |
|-----------------|-----------------|---------------|--------|
| `tool <cmd>` | ✓/✗ (what it prints) | ✓/✗ | |

### Output Anatomy and Visual System
- [ ] Header suppressed or sent to stderr when stdout is piped (`tool cmd | head -1` → data, not brand header)
- [ ] Consistent glyph system: each status uses a unique glyph with fixed color (no emoji, no `[ERROR]` prefixes)
- [ ] Sub-items use tree chars (`├─`/`└─`), not flat indented lists
- [ ] Summary lines omit zero counters (`3 processed · 1 error`, not `3 processed · 0 skipped · 1 error`)
- [ ] `--json` emits compact JSON by default (pretty-print only on TTY or via `--pretty`)
- [ ] Errors in `--json` mode are JSON objects, not styled human messages

**Visual system tests:**

| Test | Command | Expected | Actual | Status |
|------|---------|----------|--------|--------|
| Header in pipe | `tool cmd \| head -1` | data line, not brand header | | ✓/✗ |
| Glyph consistency | Run success + error + warning scenarios | `✓`/`✗`/`△` with fixed colors | | ✓/✗ |
| Tree chars | Any command with sub-items | `├─`/`└─`, not bullet/indent | | ✓/✗ / N/A |
| Zero counters | Trigger result with 0 errors | Summary omits `0 errors` | | ✓/✗ / N/A |
| JSON compact | `tool cmd --json \| wc -l` | Compact (not indented) | | ✓/✗ / N/A |
| JSON error | `tool cmd --json` (invalid input) | JSON error object, not styled text | | ✓/✗ / N/A |

### Copy Quality

_Evaluate all human-facing strings against `skills/cli-design-system/references/ux/copy-style.md`. Check errors, help text, progress messages, summaries, confirmations, and next-step suggestions. This section covers wording quality — structural completeness of errors (what/why/fix) is under Error Scenario Matrix._

**Voice and tone:**
- [ ] Direct, not apologetic ("Can't write to X" not "Sorry, unable to write")
- [ ] Calm, not dramatic (no ALL CAPS emphasis, no exclamation marks, no "FATAL")
- [ ] Blame the situation, not the user ("Unknown flag" not "You typed an invalid flag")
- [ ] Specific, not vague — names the thing ("Invalid port: '99999'" not "Invalid value")

**Vocabulary:**
- [ ] Preferred vocabulary used (run not execute, set not configure, check not verify, try not attempt, show not display, start not initialize, stop not terminate, remove not delete/destroy/purge, fix not resolve)
- [ ] Forbidden words absent: please, sorry, successfully, oops, fatal, abort, kill, nuke, destroy, obviously, simply, just
- [ ] Contractions used (can't not cannot, don't not do not, isn't not is not)
- [ ] Active voice (not passive — "Can't find X" not "X could not be found")

**Tense:**
- [ ] In-progress messages use gerund ("Ingesting files...")
- [ ] Completed messages use past tense ("Ingested 42 files")
- [ ] Dry-run messages use future ("Would deploy 3 resources")
- [ ] Consistent across all commands (no mixing "Processing..." with "Processed" in similar contexts)

**Formatting:**
- [ ] Sentence case everywhere (never Title Case, never UPPERCASE in messages — only in help section headings)
- [ ] No period at end of single-line messages
- [ ] Middle dot `·` (U+00B7) for summary separators
- [ ] Arrow `→` (U+2192) for transitions and next steps, never `=>` or `->`
- [ ] No semicolons, no exclamation marks
- [ ] No ellipsis in static messages (only for in-progress spinners)

**Message length:**
- [ ] Success confirmations: 1 line
- [ ] Error messages: 2-3 lines (max 5)
- [ ] Summary lines: 1 line
- [ ] Flag descriptions: under 60 chars (max 80)

**Anti-patterns:**
- [ ] No robotic messages ("Operation completed. 0 errors encountered.")
- [ ] No marketing tone ("Successfully deployed your amazing app!")
- [ ] No log-style messages ("[INFO] 2024-01-15T10:30:00 Processing...")
- [ ] No passive voice ("The file was not found" → "File not found: config.yaml")
- [ ] No filler words ("In order to proceed, you will need to..." → "Run X first")

**Flag descriptions (from help text):**
- [ ] Begin with lowercase letter
- [ ] Do not end with a period
- [ ] Show default value in parens
- [ ] Show type hint for value flags

**Copy quality table** _(fill from output samples captured in Step 2b)_:

| Command | Voice ok? | Vocabulary ok? | Tense ok? | Formatting ok? | Anti-patterns? | Notes |
|---------|----------|---------------|-----------|---------------|---------------|-------|
| `tool <cmd>` | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | ✓/✗ | |

### Output Anatomy and Visual System

_Run each command in success and failure paths. Capture actual terminal output (Step 2b). Verify each command's output follows the anatomy defined in `skills/cli-design-system/references/ui/typography-and-spacing.md` and the visual patterns in `skills/cli-design-system/references/ui/terminal-components.md`._

**Output anatomy (per command):**
- [ ] Output follows the defined structure: header → body → detail → summary → next step (sections present as context requires; header is mandatory)
- [ ] Headers follow `brand · context` pattern (bold brand + muted · + dim context)
- [ ] Operational metadata on detail line (indent 2, dim), not inline in header
- [ ] Body lines start with colored glyph followed by dim message text
- [ ] Detail sub-items use tree chars (`├─`/`└─`), indented 2 spaces — no flat indented lists
- [ ] Summary line is bold, compact with `·` separator, zero counters omitted
- [ ] Next step uses `Next → command` format with command in brand color
- [ ] Exactly 1 blank line between sections, never 2+

**Glyph usage:**
- [ ] Status glyphs match glyph table (`✓` success, `✗` error, `△` warning, `i` info)
- [ ] Each glyph has its fixed color (no context-dependent color changes)
- [ ] No solid/heavy glyphs (`▲` instead of `△`, `●` instead of `i`)
- [ ] Removed items use `−` (minus), not `✕` (multiply)
- [ ] No emoji anywhere in output
- [ ] No `[ERROR]`, `[WARN]`, `[INFO]` prefixes in color mode

**Summary lines:**
- [ ] Issue counters colored semantically (errors in red, warnings in yellow)
- [ ] Commands in suggestions rendered in brand color as a whole

**Cross-command consistency:**
- [ ] Same output type (file lists, health checks, search results) uses same visual pattern across all commands
- [ ] Spacing between sections consistent (1 blank line, never 2+)
- [ ] Column alignment consistent across similar outputs
- [ ] All commands producing the same output type use the same visual pattern
- [ ] Outlier commands whose output diverges from the majority pattern are identified
- [ ] Deviations documented with observable evidence (compared outputs side by side)

**Anatomy table** _(fill from output samples captured in Step 2b)_:

| Command | Header? | Body glyphs? | Detail tree? | Summary? | Next step? | Spacing? | Notes |
|---------|---------|-------------|-------------|----------|-----------|---------|-------|
| `tool <cmd>` | ✓/✗/N/A | ✓/✗ | ✓/✗/N/A | ✓/✗/N/A | ✓/✗/N/A | ✓/✗ | |

---

## Exit Code Failure Scenarios

_For each command, test concrete failure scenarios. Exit 0 on failure is a P0 anomaly. Empty results on query commands should be exit 0 (no results ≠ error)._

| Command | Scenario | Expected Exit | Actual Exit | Status |
|---------|----------|---------------|-------------|--------|
| `tool <cmd>` | <failure scenario> | 1 or 2 | | ✓/✗ |
| `tool <query-cmd>` | empty results (valid query, no matches) | 0 | | ✓/✗ |

---

## Error Scenario Matrix

_For each command, test failure scenarios and evaluate error quality._

| Command | Scenario | Actionable? | To stderr? | Exit Code | Raw Trace? |
|---------|----------|------------|-----------|-----------|-----------|
| `tool <cmd>` | missing input | ✓/✗/~ | ✓/✗ | | ✓/✗ |
| `tool <cmd>` | invalid input | ✓/✗/~ | ✓/✗ | | ✓/✗ |
| `tool <cmd>` | permission denied | ✓/✗/~ | ✓/✗ | | ✓/✗ |
| `tool <cmd>` | invalid env var | ✓/✗/~ | ✓/✗ | | ✓/✗ |

_Actionable = states what went wrong + suggests how to fix. ~ = partially actionable._

---

## Violation Map (systemic view)

_Group findings by violation. For each, list severity, evidence tier, affected commands, and count._

_Evidence tiers: `[confirmed]` = reproduced, `[inferred]` = source/help indicates issue but untested (severity -1 level), `[untested]` = can't verify (listed separately)._

### Critical (P0)

**<Violation description>** [confirmed/inferred] — <N>/<TOTAL> commands
- Affected: `tool <cmd1>`, `tool <cmd2>`, ...
- Evidence: <what was observed>
- Reference: `skills/cli-design-system/references/<path>`
- Fix type: fix-once / fix-per-command

### Major (P1)

**<Violation description>** [confirmed/inferred] — <N>/<TOTAL> commands
- Affected: `tool <cmd1>`, `tool <cmd2>`, ...
- Evidence: <what was observed>
- Reference: `skills/cli-design-system/references/<path>`
- Fix type: fix-once / fix-per-command

### Moderate (P2)

**<Violation description>** [confirmed/inferred] — <N>/<TOTAL> commands
- Affected: ...
- Evidence: ...
- Reference: `skills/cli-design-system/references/<path>`

### Minor (P3)

**<Violation description>** [confirmed/inferred] — <N>/<TOTAL> commands
- Affected: ...
- Evidence: ...
- Reference: ...

### Verification Needed

_Items that could not be confirmed or denied. Do not count toward the score — list for follow-up testing._

**<Item description>** [untested] — <N>/<TOTAL> commands
- Note: <why it couldn't be verified>
- Action: <how to test it>
- Rubric default severity: <severity if confirmed broken>

**Violation Summary:** <N> Critical, <N> Major, <N> Moderate, <N> Minor confirmed violations + <N> anomalies + <N> unverified items across <TOTAL> commands

---

## Command Health Dashboard

| Command | Score | Grade | Critical Fails | Anomalies | Top Issue |
|---------|-------|-------|----------------|-----------|-----------|
| `tool <cmd>` | X/Y (Z%) | Grade* | N | N | <issue> |
| ... | | | | | |

_* = grade capped by critical failures_

### Score Distribution

| Grade | Count | Commands |
|-------|-------|----------|
| Excellent (85%+) | N | ... |
| Good (70-84%) | N | ... |
| Adequate (50-69%) | N | ... |
| Below Standard (30-49%) | N | ... |
| Poor (<30%) | N | ... |

_Grade capping: 1-2 critical failures → capped at Adequate. 3+ critical failures → capped at Below Standard. Commands within 5% of each other must receive the same grade._

**Worst commands:** <cmd> (X%), <cmd> (X%), <cmd> (X%)
**Best commands:** <cmd> (X%), <cmd> (X%), <cmd> (X%)

---

## Layer Scores

| Layer | Score | Summary |
|-------|-------|---------|
| Contract | /38 | <one-line> |
| UX | /38 | <one-line> |
| UI | /24 | <one-line> |
| **Total** | **/100** | |

### Contract Layer Breakdown

| Area | Score | Notes |
|------|-------|-------|
| Command Structure | /8 | |
| Flags | /10 | |
| Arguments | /4 | |
| Exit Codes | /8 | |
| I/O Streams | /5 | |
| Configuration | /3 | |

### UX Layer Breakdown

| Area | Score | Notes |
|------|-------|-------|
| Help System | /8 | |
| Error Messages | /8 | |
| Copy | /8 | |
| Progress/Feedback | /7 | |
| Interactivity | /5 | |
| Discoverability | /2 | |

### UI Layer Breakdown

| Area | Score | Notes |
|------|-------|-------|
| Color System | /10 | |
| Typography & Spacing | /6 | |
| Components | /8 | |

---

## Recommendations

### Behavioral Anomalies (fix immediately)

1. **ANOM-<N>:** <description> — <impact>
2. ...

### Highest-Leverage Fixes (from Violation Map)

_Systemic violations that affect many commands — fix once, improve everywhere._

1. **<Violation>** — affects <N> commands — <fix summary>
2. **<Violation>** — affects <N> commands — <fix summary>
3. **<Violation>** — affects <N> commands — <fix summary>

### Worst-Scoring Commands (from Dashboard)

_Commands that need the most individual attention._

1. `tool <cmd>` (X%) — <N> critical issues, <N> anomalies: <list>
2. `tool <cmd>` (X%) — <N> critical issues, <N> bugs: <list>
3. `tool <cmd>` (X%) — <N> critical issues, <N> bugs: <list>

### Next Step

Use the audit findings to plan improvements — the violation map drives task grouping and the command dashboard drives prioritization.
