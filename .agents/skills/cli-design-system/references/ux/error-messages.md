<overview>
Error message formatting, actionable suggestions, "did you mean?" patterns, error grouping, and debug information. Error messages are the most important UX element in a CLI — they are the tool's voice when things go wrong, and the quality of errors determines whether users can self-recover or need to search for help.
</overview>

<error_structure>

**Every error message should answer four questions:**

1. **What failed?** — Concise, specific description
2. **Why did it fail?** — Root cause (if determinable)
3. **How to fix it?** — Actionable next step
4. **Where to get more help?** — Command, flag, or URL

**Format:**
```
Error: <what failed>
<why it failed>

<how to fix it>
```

**Examples:**

Good:
```
Error: Can't connect to database at localhost:5432
Connection refused — is PostgreSQL running?

Try: pg_isready -h localhost -p 5432
Docs: https://tool.dev/docs/database-setup
```

Bad:
```
Error: connection refused
```

Terrible:
```
panic: runtime error: invalid memory address or nil pointer dereference
goroutine 1 [running]:
main.connectDB(0xc000014090, 0x12)
        /src/main.go:42 +0x1a4
```

</error_structure>

<formatting_rules>

**Output rules:**
- Errors go to stderr, always
- Prefix with `Error:` or `error:` for grep-ability
- Warnings prefix with `Warning:` or `warning:`
- Put the most important information at the end (eye gravitates to bottom)
- Use color (red for errors, yellow for warnings) but ensure the message is clear without color

**Tone:**
- Be direct, not apologetic ("Can't write to file" not "Sorry, we were unable to write to file")
- Be specific ("Permission denied: /etc/config" not "A filesystem error occurred")
- Blame the situation, not the user ("Unknown flag '--fomat'" not "You typed an invalid flag")

**Technical details:**
- Include file paths, line numbers, resource names in error messages
- Show the exact value that was invalid: `Invalid port: '99999' (must be 1-65535)`
- For API errors, include status code and request ID
- Stack traces go to `--debug` mode or a log file, never to default output

</formatting_rules>

<did_you_mean>

**Typo correction using edit distance:**

When user input doesn't match a known command, flag, or value:
1. Compute Levenshtein distance to all valid options
2. Suggest matches within distance 1-2
3. If exactly one match, offer to run it

**Examples from real CLIs:**

```
# Git
git: 'stauts' is not a git command. Did you mean 'status'?

# gh
unknown command "prr" for "gh"
Did you mean "pr"?

# Heroku
Warning: pss is not a heroku command.
Did you mean: ps? [y/n]

# npm
Unknown command: "instal"
Did you mean install?
```

**Implementation notes:**
- Threshold: suggest if edit distance <= 2 AND the suggestion is unambiguous
- For flags: suggest closest match for unknown `--` flags
- For enum values: list all valid values when an invalid one is given
- Suggest at most 3 options to avoid overwhelming

</did_you_mean>

<contextual_suggestions>

**Suggest the next command to run:**

```
Error: No authentication token found.
Run 'tool login' to authenticate, or set TOOL_API_TOKEN.
```

```
Error: Resource 'web-app' not found.
Run 'tool list' to see available resources.
```

```
Error: Config file not found.
Run 'tool init' to create a default configuration.
```

**Pattern:** Error → diagnosis → specific actionable suggestion with the exact command to run.

</contextual_suggestions>

<error_grouping>

**When processing multiple items, don't repeat similar errors:**

Bad:
```
Error: file1.txt: permission denied
Error: file2.txt: permission denied
Error: file3.txt: permission denied
Error: file4.txt: permission denied
... (200 more lines)
```

Good:
```
Error: Permission denied for 204 files
First 3: file1.txt, file2.txt, file3.txt
Fix: Run 'chmod +r' on the affected files, or run with sudo.
```

**Grouping rules:**
- Group errors by type/cause, not by item
- Show count + first few examples
- Provide a single fix that addresses all items in the group
- Offer `--verbose` for full listing

</error_grouping>

<validation_errors>

**For input validation, show all errors at once:**

Bad (one at a time):
```
Error: Missing required field 'name'
# User fixes, runs again...
Error: Invalid email format
# User fixes, runs again...
Error: Port must be between 1-65535
```

Good (all at once):
```
Validation errors:
  - name: required field is missing
  - email: 'not-an-email' is not a valid email address
  - port: '99999' must be between 1-65535
```

</validation_errors>

<unexpected_errors>

**For bugs/crashes:**
1. Apologize briefly: "An unexpected error occurred."
2. Show what to include in a bug report: version, OS, command that was run
3. Tell them where to report it: URL to issue tracker
4. Write detailed debug info to a file, tell them the path:
   ```
   Debug info written to /tmp/tool-debug-2024-01-15.log
   Please include this file when reporting the issue at:
   https://github.com/org/tool/issues/new
   ```
5. Consider pre-populating the issue URL with template data

</unexpected_errors>

<json_mode_errors>

**When --json is active, errors must also be JSON.**

A command that supports `--json` must emit JSON error objects, not styled human messages, when an error occurs. This applies to both stdout and stderr.

**Format:**
```json
{"error": "Database not found", "code": "ENOENT", "detail": "/path/to/missing.db"}
```

This is a contract requirement — a JSON consumer that receives styled text instead of a JSON object will break. The error JSON should include at minimum:
- `error`: human-readable message (what failed)
- `code`: machine-readable error code (for programmatic handling)
- `detail`: additional context (path, value, etc.)

Exit codes remain the same as in non-JSON mode.

See `references/ui/terminal-components.md` (json_mode) for output format details.

</json_mode_errors>

<common_error_patterns>

Templates for the most common error categories. Every CLI encounters these — use the templates as the baseline and adapt to your domain.

**Resource not found:**
```
Error: Database not found at /path/to/db
Run 'tool init' to create one, or set TOOL_DATABASE_URL.
```

**Invalid value:**
```
Error: Invalid port: 'abc' (must be a number between 1 and 65535)
Check TOOL_PORT in your environment or use --port <number>.
```

**Permission denied:**
```
Error: Can't write to /etc/tool/config — permission denied
Try running with sudo, or use --config to specify a writable path.
```

**Missing dependency:**
```
Error: Tool requires Python 3.10+, found 3.8.2
See https://tool.dev/docs/install for upgrade instructions.
```

**Invalid config file:**
```
Error: Syntax error in ~/.config/tool/config.yaml at line 12
Expected a string value for 'region', got a list.
```

**Network error:**
```
Error: Can't reach api.tool.dev — connection timed out
Check your internet connection, or set HTTP_PROXY if behind a proxy.
```

The structure is always: line 1 = what failed (specific, with the actual value or path), line 2 = how to fix (exact command or setting to change). Optionally line 3 = where to get more help (URL).

</common_error_patterns>

<anti_patterns>
- **Raw exceptions as output:** Stack traces with internal file paths and memory addresses
- **One-at-a-time validation:** Making users fix and retry for each individual error
- **Jargon:** "ECONNREFUSED" instead of "Connection refused — is the service running?"
- **No fix suggestion:** Stating the problem without suggesting a solution
- **Blame the user:** "Invalid input" instead of showing what was expected
- **Identical errors repeated:** Same error message printed once per item in a batch
- **Red everything:** Using error color for warnings and info dilutes the signal
- **Missing context:** "File not found" without saying which file
- **Wall of errors:** Printing 500 errors when the first one caused all the others (cascade)
</anti_patterns>
