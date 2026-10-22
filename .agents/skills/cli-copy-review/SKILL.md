---
name: cli-copy-review
description: >
  Review and fix human-facing strings in a CLI against the copy style guide.
  Checks tone, vocabulary, tense, punctuation, and cross-command consistency.
  Only modifies strings — no logic changes. Safe to run without a full audit.
  Use when you want to improve message quality, fix wording, or unify tone.
disable-model-invocation: true
---

# Workflow: Review and Fix Output Copy

<required_reading>
**Read these reference files NOW before reviewing:**
1. skills/cli-design-system/references/ux/copy-style.md
2. skills/cli-design-system/references/ux/error-messages.md
3. skills/cli-design-system/references/ui/typography-and-spacing.md
4. skills/cli-design-system/references/ui/terminal-components.md (glyph system, summary patterns)
</required_reading>

<process>

## Step 0: Detect Mode

This workflow operates in two modes. Detect which applies:

**Audit-input mode:** The user provides audit findings or references a recent audit. In this mode, the audit's Copy Quality findings, output samples, and violation map are the starting point — skip Steps 2-3 and go directly to Step 4 (Change Report), using the audit's per-command copy quality table as input.

**Standalone mode:** No audit exists, or the user wants a quick copy check outside the full audit cycle (e.g., "I just wrote 3 new commands, check the copy before release"). In this mode, run the full discovery process (Steps 2-3).

**How to detect:**
- User says "use the audit", "from the audit", references an audit report → **audit-input mode**
- Conversation contains a recent audit with Copy Quality section → **audit-input mode**
- User says "check copy", "review messages", or asks about specific commands with no audit context → **standalone mode**
- When uncertain, ask: "I can use findings from a recent audit to skip re-discovery, or do a standalone review. Do you have audit findings to start from?"

## Step 1: Define Scope

Ask the user what to review. Default is full review.

| User says | Scope | What it covers |
|-----------|-------|---------------|
| "review all copy", "fix all messages" | Full | All human-facing strings across all commands |
| "fix errors", "improve error messages" | Errors | Error messages, warning messages, validation output |
| "fix help text", "improve help" | Help | --help descriptions, usage strings, flag descriptions, examples |
| "fix progress messages" | Progress | Spinner text, status updates, completion messages |
| "check tone", "review tone" | Tone audit | All strings, but only voice/tone rules (no structural changes) |
| "fix <command> messages" | Single command | All strings for one specific command |

**Wait for response before proceeding.**

**If audit-input mode:** After defining scope, skip to Step 4. Use the audit's Copy Quality table, output samples from Step 2b, and error scenario matrix Copy Quality column as the inventory and diagnosis. The audit has already checked every string against copy-style.md — the change report can be built directly from those findings.

## Step 2: Inventory Human-Facing Strings (standalone mode only)

_Skip this step in audit-input mode — the audit's command inventory, output samples, and copy quality table serve as the inventory._

Search the codebase for every string a user can see. Categorize each by type:

| Type | What to look for |
|------|-----------------|
| Status/success | Print calls after successful operations |
| Error | Error messages, exception messages, validation failures |
| Warning | Advisory messages, deprecation notices |
| Help | --help descriptions, usage strings, flag help text, examples in epilog |
| Progress | Spinner text, in-progress messages, completion confirmations |
| Confirmation | Prompts before destructive or significant operations |
| Summary | Compact result lines with counters |
| Next-step | "Run X to...", "Next →" suggestions |
| Header | Brand · context lines at top of output |

**Produce an inventory table:**

```
File:Line            Type       Current text
src/cli.py:42        success    "Successfully ingested {n} files."
src/cli.py:58        error      "Error: Unable to process file."
src/cli.py:92        summary    "Found 3 results, 0 errors, 0 warnings"
src/cli.py:15        help       "Searches the knowledge base"
...
```

**Count:** N total human-facing strings found.

**Excluded from inventory:**
- `--json` output strings — these are API contract, not copy
- Log messages behind `--debug` — these are developer-facing, not user-facing
- Internal variable names or comments

## Step 3: Check Each String Against Rules (standalone mode only)

_Skip this step in audit-input mode — the audit's Copy Quality section has already evaluated each string against these rules._

For each string in the inventory, evaluate against these rules:

**Voice and tone (from copy-style.md):**
- [ ] Sentence case (not Title Case, not UPPERCASE in messages)
- [ ] No period at end of single-line messages
- [ ] Uses contractions (can't, doesn't, won't — not cannot, does not)
- [ ] Active voice (not passive)
- [ ] Starts with what matters (no filler like "There was a problem...")
- [ ] Names things specifically (not "the resource", "the value", "the input")
- [ ] No forbidden words (please, sorry, successfully, fatal, abort, obviously, simply, just)
- [ ] Preferred vocabulary (run not execute, set not configure, check not verify, try not attempt)
- [ ] Direct tone — not apologetic, not robotic, not marketing

**Tense (from copy-style.md):**
- [ ] In-progress: gerund ("Ingesting files...")
- [ ] Completed: past tense ("Ingested 42 files")
- [ ] Dry-run: future ("Would deploy 3 resources")
- [ ] No future tense outside of dry-run

**Error structure (from error-messages.md):**
- [ ] States what failed (specific, with actual value or path)
- [ ] States why (if determinable)
- [ ] Suggests how to fix (exact command or setting to change)
- [ ] No raw exception messages or internal jargon (ECONNREFUSED → "connection refused")
- [ ] Blame the situation, not the user
- [ ] Uses common error pattern template where applicable (resource not found, invalid value, permission denied, etc.)

**Format and punctuation (from copy-style.md + typography-and-spacing.md):**
- [ ] Middle dot (·) for summary separators
- [ ] Arrow (→) for transitions and next steps, never =or ->
- [ ] No semicolons, no exclamation marks
- [ ] No ellipsis in static messages (only for in-progress spinners)
- [ ] Within length limits (success = 1 line, error full = 2-3 lines, summary = always 1 line)

**Components (from terminal-components.md):**
- [ ] Correct glyphs (✓ ✗ △ i — not emoji ✅ ❌, not ⚠ ℹ)
- [ ] Each glyph has its fixed color (no context-dependent changes)
- [ ] No [ERROR], [WARN], [INFO] text prefixes in color mode
- [ ] Summary omits zero counters
- [ ] Header follows `brand · context` pattern

**Help text (from help-system.md via copy-style.md):**
- [ ] Description is one line, no filler ("This command..." → just describe the action)
- [ ] Flag descriptions: lowercase start, no period, default value shown
- [ ] Examples use `$` prefix, show real-world usage

## Step 4: Produce Change Report

Group findings by violation type, not by command. This allows fixing all tone issues in one pass, all structure issues in another.

```
COPY REVIEW REPORT
Scope: <full / errors / help / tone / command>
Strings reviewed: N
Violations found: N

─────────────────────────────────────────────
TONE VIOLATIONS (voice/attitude problems)
─────────────────────────────────────────────

  src/cli.py:58  error
    Current:  "Sorry, unable to process the specified file"
    Issues:   Apologetic ("sorry"), passive voice ("unable to"), vague ("the specified file")
    Proposed: "Can't process {filename}: {reason}"

  src/cli.py:220  success
    Current:  "The operation completed successfully!"
    Issues:   "successfully" redundant, "the operation" vague, exclamation mark
    Proposed: "Ingested 42 files"

─────────────────────────────────────────────
STRUCTURE VIOLATIONS (format/pattern problems)
─────────────────────────────────────────────

  src/cli.py:92  summary
    Current:  "Found 3 results, 0 errors, 0 warnings"
    Issues:   Zero counters shown, comma separator instead of ·, "Found" filler
    Proposed: "3 results"

  src/cli.py:180  error
    Current:  "Database error"
    Issues:   No what/why/fix structure, no path or detail
    Proposed: "Can't open database at {path}\nRun kenso init to create one"

─────────────────────────────────────────────
WORDING VIOLATIONS (word choice)
─────────────────────────────────────────────

  src/cli.py:34  success
    Current:  "Successfully initialized the project"
    Issues:   "Successfully" forbidden, "the project" vague
    Proposed: "Created project in {path}"

  src/cli.py:150  error
    Current:  "Cannot execute the specified command"
    Issues:   "Cannot" (use can't), "execute" (use run), "the specified" (name it)
    Proposed: "Can't run {command}"

─────────────────────────────────────────────
FORMAT VIOLATIONS (punctuation/case/glyphs)
─────────────────────────────────────────────

  src/cli.py:78  warning
    Current:  "Warning: Missing Tags In Frontmatter."
    Issues:   Title Case, trailing period, "Warning:" prefix (use △ glyph)
    Proposed: "△ missing tags in frontmatter"

  src/cli.py:200  next-step
    Current:  "Try running =kenso doctor"
    Issues:   "Try running" filler, =instead of →
    Proposed: "Next → kenso doctor"

─────────────────────────────────────────────
SUMMARY
─────────────────────────────────────────────
N tone · N structure · N wording · N format violations
across M strings in K files
```

**Out-of-scope items:** If the review finds violations that require logic changes (e.g., a command bypasses shared UI helpers, or output routing needs to change from stdout to stderr), don't include them in the copy fix list. Note them separately:

```
OUT OF SCOPE (requires code changes):
  lint.py:789-791 — header built inline, bypasses ui.header() TTY check
  lint.py:812 — summary built with format_summary(), not ui.summary()
  Action: Flag for audit or improvement plan, not copy review
```

The copy review changes strings only. Infrastructure problems are out of scope for copy review.

## Step 5: Apply Changes

Apply all proposed rewrites from the change report.

**Rules — do not violate any of these:**
- Change string content only — no logic changes, no control flow changes
- Preserve all format string placeholders (`{name}`, `%s`, `f"..."` expressions)
- Preserve ANSI escape codes and color/style function calls
- Preserve glyph function calls (ok(), fail(), warn(), info())
- Do NOT touch `--json` output strings — those are API contract
- Do NOT touch `--debug` / log.debug() messages — those are developer-facing
- After changes, verify format strings still have the correct number of arguments

**Test after applying:** Run each modified command in its success and failure paths. Confirm output matches the proposed text.

## Step 6: Cross-Command Consistency Check

After all individual fixes, review the complete set of modified strings for cross-command consistency. Same type of message must use the same pattern everywhere.

**Check these patterns across all commands:**
- All headers use the same `brand · context` format
- All summaries use `·` separator and omit zero counters
- All next-step suggestions use `Next → command` format
- All "not found" errors use the same template
- All "permission denied" errors use the same template
- All completion confirmations use the same tense and structure
- All file lists use the same alignment and glyph conventions

**When inconsistencies are found:**
```
Pattern: "resource not found" errors
  ingest: "Can't find {path}"
  search: "File not found: {path}"      ← different pattern
  lint:   "No such file: {path}"        ← third pattern

  Action: Standardize on one pattern across all commands
```

Pick the best variant and apply it everywhere. If no variant is clearly best, write a new one that follows the error templates in error-messages.md.

</process>

<success_criteria>
Copy review is complete when:
- [ ] Mode detected (audit-input or standalone)
- [ ] Scope confirmed with user
- [ ] All human-facing strings inventoried with file:line and type (standalone mode) OR audit findings used as inventory (audit-input mode)
- [ ] Each string checked against copy-style.md, error-messages.md, typography-and-spacing.md, and terminal-components.md (standalone mode) OR audit's Copy Quality findings used directly (audit-input mode)
- [ ] Change report produced grouped by violation type (tone → structure → wording → format)
- [ ] All proposed changes are string-only (no logic changes)
- [ ] Format string placeholders verified intact after changes
- [ ] `--json` output strings confirmed untouched
- [ ] Cross-command consistency verified — same patterns everywhere
- [ ] Modified commands tested in success and failure paths
</success_criteria>
