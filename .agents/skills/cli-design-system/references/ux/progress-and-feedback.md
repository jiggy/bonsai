<overview>
Spinners, progress bars, status updates, verbosity levels, and the rules for when to show feedback vs stay silent. Progress feedback bridges the gap between "silence is success" and "the user thinks it's frozen."
</overview>

<when_to_show_progress>

**When to show progress — operation type, not duration:**

Show progress for operations that **process collections** or **do network I/O** — regardless of expected duration. A 2-second API call needs a spinner; a 2-second local computation may not. The key is whether the user can predict when it will finish.

**Design target:** Print something within 100ms of starting any potentially slow operation. If making a network request, print something BEFORE the request starts.

**Feedback by operation type:**

| Operation type | Feedback |
|----------------|----------|
| Local computation, fast I/O | None (completes before user notices) |
| Network request, API call | Spinner before request starts |
| Processing a collection | X/Y counter or progress bar |
| Long-running (build, deploy) | Progress bar with ETA |
| Blocking (serve, watch) | Startup message before blocking |

**Where feedback goes:** Always stderr. Never stdout. Progress on stdout breaks pipes.

</when_to_show_progress>

<progress_patterns>

<pattern name="Spinners">
**Use when:** Single sequential operation of uncertain duration (< 30s)
**Behavior:**
- Animate on a single line (carriage return, no newline)
- Update text when sub-steps complete to signal liveness
- Clear/replace with final status on completion

**Example progression:**
```
⠋ Connecting to server...
⠙ Authenticating...
⠹ Fetching resources...
✓ Done — 42 resources loaded (3.2s)
```

**Accessibility:** Animated spinners harm screen readers. Detect `TERM=dumb` or screen reader presence and fall back to static line-by-line updates:
```
Connecting to server...
Authenticating...
Fetching resources...
Done — 42 resources loaded (3.2s)
```
</pattern>

<pattern name="X of Y Counter">
**Use when:** Processing multiple discrete items with a known total
**Format:** `3 / 10 files processed`
**Advantages:** Enables ETA calculation, reveals stalls, simple to implement

**Example:**
```
Processing files... 7/42 (16%) — estimated 12s remaining
Processing files... 42/42 (100%) — done in 8.3s
```
</pattern>

<pattern name="Progress Bar">
**Use when:** Parallel operations, downloads, or long processes with measurable progress
**Rules:**
- Show percentage and/or absolute progress
- Show elapsed and estimated remaining time for long operations
- Update in place (single line, carriage return)
- Clear on completion or replace with summary

**Example (single):**
```
Downloading... [████████░░░░░░░░░░░░] 42% 12.3MB/29.1MB 8s
```

**Example (multiple, Docker-style):**
```
layer-a3f2: Downloading [████████░░░░] 67%
layer-b1c4: Extracting  [██████████░░] 83%
layer-d5e6: Complete
```
</pattern>

</progress_patterns>

<tense_switching>

Switch from gerund (in progress) to past tense (complete):

```
⠋ Downloading package...        # In progress
✓ Downloaded package (2.1MB)     # Complete

⠋ Running migrations...         # In progress
✓ Ran 3 migrations              # Complete

⠋ Building image...             # In progress
✗ Build failed                   # Failed
```

**Symbols:**
- `✓` or `✔` for success (green)
- `✗` or `✘` for failure (red)
- `⚠` for warnings (yellow)
- `•` or `-` for info/neutral

</tense_switching>

<verbosity_levels>

| Level | Flag | Content | Use case |
|-------|------|---------|----------|
| Silent | `--quiet` / `-q` | Errors only | Scripting, CI |
| Normal | (default) | Errors + warnings + key info | Interactive use |
| Verbose | `-v` / `--verbose` | + informational messages | Debugging workflow |
| Debug | `-vv` / `--debug` | + internal state, API calls | Developer debugging |
| Trace | `-vvv` | + fine-grained execution trace | Deep investigation |

**Implementation:**
- Stacked `-v` flags: count occurrences (`-v` = 1, `-vv` = 2, `-vvv` = 3)
- Also accept `--verbose`, `--debug` as aliases for common levels
- `--quiet` suppresses everything except errors (exit code still reflects status)
- `--quiet` and `--verbose` are mutually exclusive (last one wins or error)

**What each level adds:**
```
# Normal
✓ Deployed 3 resources

# Verbose (-v)
✓ Deployed 3 resources
  → web-service: updated (image: v2.1.0)
  → worker: unchanged
  → database: created (PostgreSQL 15)

# Debug (-vv)
[10:30:01] POST /api/deploy {"resources": [...]}
[10:30:02] Response 200 (1.2s)
[10:30:02] Deploying web-service...
[10:30:05] web-service: rolling update complete
...
```

</verbosity_levels>

<non_tty_behavior>

When stdout or stderr is not a TTY:
- No animated spinners — use line-by-line static output
- No progress bars — use periodic status lines
- No carriage returns (they become visible `\r` in log files)
- No ANSI escape codes
- Consider increasing default verbosity for CI (show what's happening since no one is watching in real-time)

**Detection:** Check `isatty(stderr)` before emitting progress to stderr.

</non_tty_behavior>

<anti_patterns>
- **No feedback for slow operations:** User thinks the tool is frozen after 5 seconds of silence
- **Progress on stdout:** Breaks piping; spinner frames appear in piped output
- **Animation in non-TTY:** CI logs full of `\r` characters and partial lines
- **Stale spinner text:** Spinner says "Connecting..." for 30 seconds while actually downloading
- **No elapsed time:** Long operation completes but user doesn't know if 30s or 30min
- **Percentage without context:** "42%" — of what? How many items? How much data?
- **Multiple simultaneous spinners:** Overlapping carriage-return updates create visual chaos
- **Verbose by default:** Printing every internal step when the user didn't ask
- **Log-style stderr:** Prefixing every line with timestamps and levels in normal mode
</anti_patterns>
