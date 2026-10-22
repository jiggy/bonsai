<overview>
Rules for stdout, stderr, and stdin usage, output format conventions, piping behavior, and machine-readable output modes. Correct I/O stream usage is the foundation of CLI composability — getting this wrong breaks every downstream consumer.
</overview>

<stream_rules>

**stdout — The data channel:**
- Primary output: query results, generated content, requested data
- Must be parseable by downstream tools (grep, awk, jq, cut)
- Must be clean: no progress bars, no status messages, no warnings
- When piped, stdout should produce the same data as when displayed to a terminal (minus formatting)

**stderr — The human channel:**
- Errors and warnings
- Progress indicators (spinners, progress bars, status lines)
- Diagnostic messages, debug output
- Prompts and interactive elements
- Log messages (when using -v/--verbose)

**stdin — The input channel:**
- Accept piped input when a file argument is absent
- Detect TTY: if stdin is a terminal and no input is expected, show help (don't hang)
- Support `-` as explicit "read from stdin"

**The golden rule:** `command1 | command2` must work. If command1 mixes data and status on stdout, command2 receives garbage.

</stream_rules>

<output_formats>

<format name="Human-readable (default)">
**When:** stdout is a TTY
**Characteristics:**
- Color and formatting applied
- Tables with headers and alignment
- Truncated columns to fit terminal width
- Relative timestamps ("2 hours ago")
- Units and labels inline

**Example:**
```
NAME        STATUS    AGE
web-pod     Running   2h
db-pod      Running   5d
```
</format>

<format name="Plain text (--plain)">
**When:** `--plain` flag or stdout is not a TTY
**Characteristics:**
- No color, no box-drawing characters
- Tab-separated or fixed-width columns
- No headers (or optional with `--headers`)
- Absolute values (no "2 hours ago")
- One record per line, greppable

**Example:**
```
web-pod	Running	2024-01-15T10:30:00Z
db-pod	Running	2024-01-10T08:15:00Z
```
</format>

<format name="JSON (--json)">
**When:** `--json` flag
**Characteristics:**
- Valid JSON (always parseable by jq)
- Complete data (no truncation)
- Consistent field names across commands
- Arrays for collections, objects for single items
- Timestamps in ISO 8601
- No ANSI escape sequences

**Example:**
```json
[
  {"name": "web-pod", "status": "Running", "created": "2024-01-15T10:30:00Z"},
  {"name": "db-pod", "status": "Running", "created": "2024-01-10T08:15:00Z"}
]
```
</format>

<format name="Structured formats">
Additional formats to consider:
- `--csv` — for spreadsheet and database import
- `--yaml` — for config-oriented tools
- `--tsv` — explicit tab-separated (vs `--plain` which may vary)
- `--template` — Go template or similar for custom formatting
</format>

</output_formats>

<tty_detection>

**Check each stream independently.** stdout and stderr may have different TTY status:
- `tool | grep` — stdout is a pipe, stderr is a TTY
- `tool 2>/dev/null` — stdout is a TTY, stderr is a file
- `tool | grep 2>&1` — both are pipes

**Behavior by TTY status:**

| stdout | stderr | Behavior |
|--------|--------|----------|
| TTY | TTY | Full interactive: color, progress, prompts |
| pipe | TTY | Data on stdout, progress on stderr (common piping case) |
| TTY | pipe/file | Color on stdout, no progress on stderr |
| pipe | pipe | Machine mode: no color, no progress, no prompts |

</tty_detection>

<piping_best_practices>

**Output design for piping:**
- One logical record per line (enables `grep`, `wc -l`, `head`)
- Consistent delimiter (tab for plain, comma for CSV)
- No trailing whitespace or decoration
- Stable column order across versions
- No empty lines between records
- Headers are optional and should be suppressible

**Input design for piping:**
- Accept line-based input from stdin
- Process incrementally (don't buffer entire stdin into memory)
- Handle both `\n` and `\r\n` line endings
- Exit cleanly if stdin closes mid-stream

**The `head` test:** `tool --json | head -1` should not produce an error message about broken pipes or incomplete output. Handle SIGPIPE correctly.

</piping_best_practices>

<output_stability_contract>

**`--json` and `--plain` output is a stable API.** Never change field names, remove fields, or alter structure without a deprecation cycle.

- Human-readable output (default TTY format) can change freely between versions — it's for humans, not parsers
- `--json` output is a contract: adding fields is safe, removing or renaming fields is a breaking change
- `--plain` output is a contract: column order and delimiter must remain stable
- If you must break `--json` structure, follow a deprecation cycle: warn for N versions, document the migration, provide `--json-v2` or similar during transition
- Version the JSON schema if the tool is consumed by many downstream scripts

**This applies even to error output under `--json`.** If a command supports `--json`, errors must also be JSON:
```json
{"error": "Database not found", "code": "ENOENT", "path": "/missing/db"}
```
Not a styled human-readable error message on stdout.

</output_stability_contract>

<pager_usage>

**Use a pager for output longer than the terminal.** Especially for help text, list output, and log output.

**Recommended pager:** `less -FIRX`
- `F` — quit automatically if content fits one screen
- `I` — case-insensitive search
- `R` — pass through ANSI escape codes (so color works in the pager)
- `X` — don't clear screen on exit

**Rules:**
- Only use a pager when stdout is a TTY (never in pipes)
- Respect `$PAGER` environment variable — if set, use that instead of `less`
- Don't use a pager if `--no-pager` flag is passed
- Don't use a pager for short output (check terminal height via `$LINES` or equivalent)
- `git` is the reference implementation: uses `$GIT_PAGER`, then `$PAGER`, then `less -FIRX`

</pager_usage>

<newline_and_encoding>

- End stdout with a newline (standard UNIX convention; tools like `wc` expect it)
- Use UTF-8 encoding by default
- Handle the `LANG`/`LC_*` environment variables if locale-sensitive output is produced
- For filenames with special characters, consider `--null` / `-0` output (NUL-separated, like `find -print0`)

</newline_and_encoding>

<anti_patterns>
- **Progress on stdout:** `Downloading... 50%\nresult-data` — breaks every pipe consumer
- **Color in pipes:** Sending ANSI escape codes when stdout is not a TTY
- **Inconsistent JSON:** Different field names or structures between commands or versions
- **Hanging on stdin TTY:** Blocking forever when stdin is a terminal and no input was intended
- **Buffering all of stdin:** Loading a 10GB piped file entirely into memory
- **No newline at end:** Some tools will miss the last line of output
- **Chatty stderr in quiet mode:** Printing info messages to stderr even with `--quiet`
- **Mixed encoding:** Outputting Latin-1 when the rest of the system expects UTF-8
</anti_patterns>
