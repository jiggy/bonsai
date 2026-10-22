<overview>
Exit code conventions, signal handling behavior, and cleanup patterns. Exit codes are the programmatic return value of every CLI invocation — scripts, CI systems, and shell conditionals depend on them. Signal handling determines how a tool responds to interruption and termination requests.
</overview>

<standard_exit_codes>

**Core codes (use these):**

| Code | Meaning | When to use |
|------|---------|-------------|
| 0 | Success | Operation completed as expected |
| 1 | General error | Catchall for unspecified failures |
| 2 | Usage error | Invalid arguments, unknown flags, bad syntax |

**BSD sysexits.h codes (for richer semantics, optional):**

| Code | Name | Meaning |
|------|------|---------|
| 64 | EX_USAGE | Command used incorrectly |
| 65 | EX_DATAERR | Input data was incorrect |
| 66 | EX_NOINPUT | Input file not found or unreadable |
| 69 | EX_UNAVAILABLE | Required service unavailable |
| 70 | EX_SOFTWARE | Internal software error (bug) |
| 73 | EX_CANTCREAT | Can't create output file |
| 74 | EX_IOERR | I/O error during operation |
| 75 | EX_TEMPFAIL | Temporary failure, retry may succeed |
| 77 | EX_NOPERM | Insufficient permissions |
| 78 | EX_CONFIG | Configuration error |

**Shell-reserved codes (never use):**

| Code | Meaning |
|------|---------|
| 126 | Command found but not executable |
| 127 | Command not found |
| 128+N | Terminated by signal N |
| 130 | Terminated by SIGINT (128+2) |
| 143 | Terminated by SIGTERM (128+15) |
| 255 | Exit status out of range |

**Safe range for custom codes:** 3-63.

</standard_exit_codes>

<decision_guidance>

**Minimal approach (most tools):**
- 0 = success
- 1 = error
- 2 = usage/argument error

**Richer approach (tools consumed by automation):**
- 0 = success
- 1 = operational error (something failed)
- 2 = usage error (bad arguments)
- 3-10 = domain-specific codes (document them)
- Use sysexits.h codes (64-78) for standard failure categories

**Key rule:** Scripts use `$?` (last exit code) for branching. If your tool exits 0 on partial failure, scripts will proceed as if everything succeeded. **Never exit 0 when something went wrong.**

**Empty results are success:**
- A search returning zero results is exit 0 — the operation succeeded, there's just nothing to show
- A list command with no items is exit 0 — the collection is empty, not broken
- `grep` is an exception to this convention (exit 1 on no match) — but for most tools, "no results" ≠ "error"
- The distinction: "I looked and found nothing" (exit 0) vs "I couldn't look" (exit 1)

**Partial success:**
- If processing multiple items where some succeed and some fail, exit non-zero
- Consider: exit 0 if all succeeded, exit 1 if any failed
- Alternative: provide `--fail-fast` to stop on first error vs continue-and-report-at-end
- Document which behavior your tool uses

</decision_guidance>

<signal_handling>

**Required signals to handle:**

| Signal | Number | Trigger | Expected behavior |
|--------|--------|---------|-------------------|
| SIGINT | 2 | Ctrl-C | Begin graceful shutdown |
| SIGTERM | 15 | `kill`, orchestrators | Graceful shutdown with cleanup |
| SIGPIPE | 13 | Pipe reader closed | Exit silently (no error message) |

**Optional signals:**

| Signal | Number | Trigger | Common behavior |
|--------|--------|---------|-----------------|
| SIGHUP | 1 | Terminal closed | Graceful shutdown or config reload |
| SIGQUIT | 3 | Ctrl-\\ | Dump debug info + exit |
| SIGUSR1/2 | 10/12 | Explicit send | Toggle debug, dump stats, rotate logs |

</signal_handling>

<ctrl_c_pattern>

The standard two-phase Ctrl-C pattern:

**First Ctrl-C:** Begin graceful shutdown.
- Print what's happening: `Gracefully stopping... (press Ctrl+C again to force)`
- Flush buffers, save state, release locks
- Add a timeout to cleanup (don't hang forever)

**Second Ctrl-C:** Immediate exit.
- Skip all remaining cleanup
- Warn about consequences if applicable: `Forced exit. Temp files may remain in /tmp/tool-*`
- Exit with code 130 (128 + SIGINT)

**Example (Docker Compose):**
```
^C Gracefully stopping... (press Ctrl+C again to force)
Stopping web_1    ... done
Stopping db_1     ... done
```

</ctrl_c_pattern>

<sigpipe_handling>
When a pipe reader closes (e.g., `tool | head -5`), the writer receives SIGPIPE.

**Correct behavior:** Exit silently with no error message.

**Common bug:** Printing "Broken pipe" or a stack trace when SIGPIPE arrives. This is especially visible in Python (must explicitly handle or ignore BrokenPipeError) and Go (must check for write errors on stdout).

</sigpipe_handling>

<cleanup_patterns>

**Crash-only design (preferred):**
- Design so cleanup is never required — use atomic operations, temp files with predictable names, idempotent writes
- If the process dies at any point, the system is in a valid state
- This makes Ctrl-C and SIGKILL equally safe

**When cleanup is necessary:**
- Temp files: create in `$TMPDIR` with predictable prefix; clean on exit and on startup (stale detection)
- Locks: use advisory locks or PID files; verify PID is still alive before honoring
- Network connections: set timeouts; let the server handle abrupt disconnection
- Child processes: kill process group, not just the parent

**Timeout all cleanup:** Add a 5-10 second timeout to cleanup handlers. If cleanup hangs, force exit.

</cleanup_patterns>

<anti_patterns>
- **Exit 0 on failure:** Scripts will proceed as if everything worked
- **Exit 1 for everything:** Lost opportunity to distinguish usage errors from operational errors
- **Ignoring SIGPIPE:** Printing "Broken pipe" errors when piped to `head`
- **No SIGINT handler:** Leaving temp files, zombie processes, held locks on Ctrl-C
- **Cleanup that hangs:** Blocking indefinitely in a signal handler (add timeouts)
- **Custom codes in reserved range:** Using 126-255 collides with shell conventions
- **Inconsistent exit codes:** Different exit codes for the same error type across subcommands
- **Silent SIGTERM:** Not cleaning up when killed by orchestrators (Docker, systemd, Kubernetes)
</anti_patterns>
