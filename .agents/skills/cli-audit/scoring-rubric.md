# CLI Audit Scoring Rubric

<overview>
Weighted scoring system for CLI audits. Each area has a maximum score based on its impact. Individual checklist items within an area are weighted by severity. The total score is out of 100.
</overview>

---

## Scoring Method

**Per checklist item:**
- **Pass:** Full points for that item
- **Partial:** Half points (meets spirit but not letter, or inconsistently applied)
- **Fail:** Zero points
- **N/A:** Item removed from denominator (doesn't apply to this CLI)

**Area score:** Sum of item scores / maximum possible for applicable items, scaled to area weight.

**Anomalies vs Violations:** Behavioral anomalies (CLI contradicts its own declared contract) count as failures in the relevant checklist area. An anomaly in exit code handling fails the exit code checks. An anomaly in error output fails the error message checks. Anomalies don't have a separate scoring category — they make the relevant area score worse.

---

## Contract Layer (38 points total)

_Areas: Command Structure 8 + Flags 10 + Arguments 4 + Exit Codes 8 + I/O Streams 5 + Configuration 3 = 38_

### Command Structure (8 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| Consistent grammar pattern | 3 | Critical | Inconsistency confuses users at every interaction |
| Standard verbs | 2 | Major | Non-standard verbs hurt discoverability |
| Subcommand depth ≤ 3 | 1 | Moderate | Deep nesting reduces discoverability |
| No ambiguous commands | 1 | Major | Ambiguity causes errors |
| Lowercase, proper naming | 1 | Moderate | Convention compliance |

### Flags (10 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| All flags have long forms | 2 | Major | Scripts depend on readable flag names |
| -h/--help on every command | 2 | Critical | Primary learning mechanism |
| --version on root | 1 | Major | Essential for bug reports and automation |
| No secrets in flags | 2 | Critical | Security: leaks to ps, history |
| kebab-case, standard names | 1 | Moderate | Convention compliance |
| Short forms for frequent flags | 1 | Moderate | Ergonomics for interactive use |
| Cross-command flag consistency | 1 | Major | Same concept = same name everywhere |

### Arguments (4 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| `--` delimiter supported | 2 | Critical | POSIX requirement, prevents flag injection |
| ≤ 3 positional args | 1 | Moderate | Usability limit |
| stdin support with `-` | 1 | Major | Composability requirement |

### Exit Codes (8 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| Exit 0 only on success | 3 | Critical | Scripts branch on exit codes; false success causes cascading failures |
| Correct exit code on failure scenarios | 2 | Critical | Each command must return non-zero on every tested failure scenario (missing input, invalid data, partial failure). This is tested per-command with the exit code scenario table. |
| Distinct code for usage errors | 1 | Major | Automation distinguishes user error from runtime error |
| No codes in reserved range | 1 | Major | Shell compatibility |
| Exit codes documented | 1 | Moderate | Contract clarity |

### I/O Streams (5 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| Data on stdout, status on stderr | 2 | Critical | Foundation of composability |
| No color in non-TTY | 1 | Critical | ANSI codes break downstream tools |
| --json available | 1 | Major | Standard for structured output |
| SIGPIPE handled | 1 | Major | `tool | head` must not error |

### Configuration (3 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| Clear precedence (flags > env > config) | 1 | Critical | Deterministic behavior |
| XDG-compliant paths | 1 | Major | System citizenship |
| Env var handling (prefix, standard vars, invalid value errors) | 1 | Major | NO_COLOR, EDITOR respected; garbage input produces actionable error |

---

## UX Layer (38 points total)

_Areas: Help System 8 + Error Messages 8 + Copy 8 + Progress & Feedback 7 + Interactivity 5 + Discoverability 2 = 38_

_Note: Copy was extracted from Error Messages (12→8) and absorbs copy-quality aspects previously embedded in Help (flag description style), Progress (tense switching quality), and other areas. The rebalance reflects that copy quality was always implicitly scored — now it's explicit._

### Help System (8 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| --help on every command | 3 | Critical | Primary documentation |
| Examples in help | 3 | Critical | Most-used section of help; absence is a major gap |
| Usage string conventions | 1 | Major | Users parse these to understand arguments |
| Grouped by workflow | 1 | Moderate | Discoverability |

_Flag description formatting (lowercase, no period, defaults shown) is now evaluated under Copy._

### Error Messages (8 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| Actionable errors (what + why + how to fix) | 2 | Critical | Errors are the most common UX touchpoint. Tested per-command via error scenario matrix. Structural completeness (all three parts present), not wording quality — wording is under Copy. |
| Top-level exception handling | 2 | Critical | Without it, every unhandled error produces a raw stack trace. Systemic P0. Must catch KeyboardInterrupt (exit 130), known exceptions (human message), unknown exceptions (brief error + --debug hint). |
| "Did you mean?" suggestions | 1 | Major | Prevents frustration on typos. Test with a concrete typo. |
| No stack traces in default output | 1 | Major | Raw traces are hostile to non-developers |
| Errors to stderr | 1 | Major | Composability |
| Similar errors grouped | 1 | Moderate | Noise reduction |

_Error message tone, vocabulary, and wording quality are now evaluated under Copy._

### Copy (8 points)

_Evaluates the quality of all human-facing text against `skills/cli-design-system/references/ux/copy-style.md`. Copy quality was previously embedded in Error Messages (tone), Help (flag descriptions), and Typography (sentence case). This section makes the evaluation explicit and comprehensive._

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| Voice and tone (direct, not apologetic; calm, not dramatic) | 2 | Critical | Apologetic or dramatic tone in errors is the most visible copy failure — users see errors more than any other output |
| Preferred vocabulary and forbidden words | 2 | Major | "please", "sorry", "successfully", "fatal" etc. are reliably testable. Vocabulary table in copy-style.md ("run" not "execute", etc.) |
| Correct tense (gerund in-progress, past completed, future dry-run) | 1 | Major | Tense inconsistency across commands creates confusion about operation state |
| Sentence case, punctuation rules (no period on single-line, · separator, → arrows) | 1 | Moderate | Consistent formatting across all messages |
| Message length limits (success 1 line, error 2-3, summary 1) | 1 | Moderate | Concise messages are more scannable; verbose messages bury the signal |
| No anti-patterns (robotic, marketing, log-style, passive voice, filler words) | 1 | Major | Each anti-pattern template in copy-style.md is a testable check |

_Copy checks apply to ALL human-facing strings: errors, help text, progress messages, summaries, confirmations, and next-step suggestions. Flag descriptions (lowercase, no period, defaults shown) are also evaluated here._

### Progress & Feedback (7 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| Progress for collection/network operations | 2 | Major | Operations processing collections or doing network I/O need feedback regardless of duration |
| Progress on stderr | 2 | Critical | stdout contamination breaks pipes |
| No animation in non-TTY | 1 | Major | CI/pipe compatibility |
| Verbosity levels (quiet/verbose) | 1 | Moderate | Flexibility |
| Blocking commands print startup message | 1 | Major | Silence on startup of a blocking command is indistinguishable from a hang. Test every blocking command. |

_Tense switching quality (gerund → past tense on completion) is now evaluated under Copy._

### Interactivity (5 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| Every prompt has flag alternative | 2 | Critical | Non-interactive environments must work |
| Prompts only in TTY | 2 | Critical | Pipe/CI compatibility |
| Ctrl-C exits cleanly | 1 | Major | Basic usability |

### Discoverability (2 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| Shell completions available | 1 | Major | Primary discovery mechanism for power users |
| Typo correction and next-step suggestions | 1 | Major | Error recovery and guided experience. Test with concrete typo, document actual output. |

---

## UI Layer (24 points total)

_Areas: Color System 10 + Typography & Spacing 6 + Components 8 = 24_

### Color System (10 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| NO_COLOR env var disables color | 2 | Critical | Standards compliance, accessibility |
| TERM=dumb disables color | 2 | Critical | Standard terminal capability signal. Missing = FAIL. |
| --no-color flag available | 2 | Critical | Explicit user override. Missing = FAIL. |
| No color in non-TTY stdout | 2 | Critical | Pipe compatibility. Test with `tool list \| cat -v`. |
| Semantic color usage | 1 | Major | Consistent meaning |
| Color never sole indicator | 1 | Major | Accessibility |

**All four disable mechanisms (NO_COLOR, TERM=dumb, --no-color, non-TTY) must pass. Missing any one is a FAIL for that item.** The old rubric gave partial credit; the new one does not. Color that cannot be disabled is an accessibility failure.

### Typography & Spacing (6 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| Header suppressed when piped | 1 | Major | Brand header in piped stdout breaks parsing and downstream consumers |
| Consistent text hierarchy (text/dim/muted) | 1 | Major | Scannability |
| Fits 80-column terminal | 1 | Moderate | Standard width compatibility |
| Output follows anatomy structure (header → body → detail → summary → next step) | 1 | Moderate | Structural consistency across commands |
| Header follows `brand · context` pattern | 1 | Moderate | Visual identity and scannability |
| No trailing whitespace, proper newlines | 1 | Minor | Clean output |

_Sentence case is now evaluated under UX > Copy. Output anatomy validation ensures each command follows the defined section structure, not just individual components._

### Components (8 points)

| Item | Weight | Severity | Rationale |
|------|--------|----------|-----------|
| Errors in --json mode are JSON | 1 | Major | Styled error on stdout when --json is active breaks every JSON consumer |
| Glyphs match glyph table (correct symbols, fixed colors) | 1 | Major | Visual consistency — wrong glyph or wrong color confuses status scanning |
| Tree chars for sub-items | 1 | Major | Parent-child relationships visually explicit with `├─`/`└─` |
| Aligned columns and values | 1 | Major | Scannability — metadata padded to fixed width |
| Summary format (· separator, omit zeros, bold) | 1 | Moderate | Copy pattern consistency |
| Cross-command visual consistency | 1 | Moderate | Same output types use same patterns across all commands |
| JSON compact by default | 1 | Moderate | `--json` emits compact; pretty-print only on TTY or `--pretty` flag |
| Unicode with ASCII fallbacks | 1 | Moderate | Compatibility with TERM=dumb and non-UTF-8 |

---

## Severity Definitions

| Severity | Definition | Example |
|----------|-----------|---------|
| **Critical (P0)** | Breaks automation, causes data loss, security risk, accessibility failure, or actively broken behavior (bugs) | Exit 0 on failure; secrets in flags; no color disable; no top-level exception handler; stack traces as default error output; apologetic or dramatic tone in error messages |
| **Major (P1)** | Significant UX degradation or standard violation affecting daily use | No help examples; no --json; blocking command silent on startup; TERM=dumb ignored; missing short flags; forbidden words in output; tense inconsistency across commands |
| **Moderate (P2)** | Convention deviation or missing feature that reduces quality | No XDG compliance; alphabetical help; no completions; missing --plain; inconsistent punctuation; messages exceeding length limits |
| **Minor (P3)** | Polish issue that doesn't affect functionality | Trailing whitespace; minor vocabulary preferences |

---

## Score Interpretation

| Score | Rating | Meaning |
|-------|--------|---------|
| 85-100 | Excellent | Best-in-class CLI, few improvements possible |
| 70-84 | Good | Solid CLI, minor gaps to address |
| 50-69 | Adequate | Functional but notable standard gaps |
| 30-49 | Below Standard | Significant issues across multiple areas |
| 0-29 | Poor | Fundamental design problems, major rework needed |

**Borderline scoring rule:** When two commands score within 5 percentage points of each other (e.g., 58% vs 60%), they MUST receive the same grade. Use the lower grade for both, or examine the qualitative difference:
- If one has critical failures and the other doesn't → different grades are justified
- If the difference is only minor/moderate items → same grade, note the gap is negligible

**Grade assignment is not purely mechanical.** A command at 68% with zero critical failures may warrant "Good" if the missing points are all Minor items. A command at 72% with 2 critical failures should be "Adequate" at best despite the numeric score. Critical failure count is a grade modifier:
- 0 critical failures: grade stands as scored
- 1-2 critical failures: grade capped at Adequate regardless of numeric score
- 3+ critical failures: grade capped at Below Standard regardless of numeric score

**Anomaly impact on scoring:** Commands with confirmed behavioral anomalies receive automatic failures in the relevant check categories. An anomaly is stronger evidence of failure than a missing feature — it means the contract is actively broken, not just incomplete.
