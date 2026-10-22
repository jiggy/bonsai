<overview>
TTY detection, interactive prompts, confirmation patterns, non-interactive mode, and graceful degradation. Interactivity makes CLIs approachable for humans but must never block automation.
</overview>

<tty_detection>

**Rule:** Only use interactive elements (prompts, selections, confirmations) when stdin is an interactive terminal (TTY).

**Detection methods:**
- Python: `sys.stdin.isatty()`
- Node.js: `process.stdin.isTTY`
- Go: `term.IsTerminal(int(os.Stdin.Fd()))`
- Rust: `atty::is(Stream::Stdin)` or `std::io::stdin().is_terminal()`
- Shell: `[ -t 0 ]`

**Behavior matrix:**

| stdin | Behavior |
|-------|----------|
| TTY | Interactive: prompts, selections, confirmations available |
| Pipe / file | Non-interactive: fail with helpful error if input needed, or use defaults |

**Override flags:**
- `--interactive` / `-i`: Force interactive mode even in non-TTY
- `--no-input` / `--no-interaction`: Force non-interactive even in TTY
- `--yes` / `-y`: Auto-confirm all prompts

</tty_detection>

<prompt_patterns>

<pattern name="Text Input">
```
? Project name: my-app
```
- Show a default value in brackets if one exists: `? Project name [my-app]:`
- Accept empty input to use default
- Validate inline and re-prompt on error
</pattern>

<pattern name="Password/Secret Input">
```
? API token: ••••••••
```
- Disable echo (characters not visible)
- Never print the value back
- Support paste from clipboard
</pattern>

<pattern name="Yes/No Confirmation">
```
? Delete 42 resources? This cannot be undone. [y/N]
```
- Capitalize the default option: `[y/N]` means default is No
- Accept `y`, `yes`, `Y`, `Yes` (case insensitive)
- Accept Enter for default
- For destructive operations, default should always be No
</pattern>

<pattern name="Selection List">
```
? Select region:
  ❯ us-east-1 (Virginia)
    us-west-2 (Oregon)
    eu-west-1 (Ireland)
    ap-southeast-1 (Singapore)
```
- Arrow key navigation
- Type-ahead filtering for long lists
- Show description alongside value
- Support `--region us-east-1` as non-interactive alternative
</pattern>

<pattern name="Multi-Select">
```
? Select features to enable:
  ◉ Logging
  ◯ Metrics
  ◉ Alerts
  ◯ Tracing
```
- Space to toggle, Enter to confirm
- Show current selection count
- Support `--features logging,alerts` as non-interactive alternative
</pattern>

</prompt_patterns>

<confirmation_levels>

| Risk level | Example operation | Confirmation pattern |
|------------|-------------------|---------------------|
| **None** | Read-only commands | No confirmation |
| **Low** | Create a resource | No confirmation (show what was created) |
| **Medium** | Delete a file, modify config | `[y/N]` prompt, skippable with `--yes` |
| **High** | Delete a database, production deploy | `[y/N]` prompt, skippable with `--force` |
| **Critical** | Delete organization, purge all data | Type resource name to confirm: `--confirm=my-org` |

**Interaction with --dry-run:**
- When `--dry-run` is active, skip confirmations entirely — the operation won't execute
- Show what would be confirmed: "Would prompt for confirmation before deleting 3 resources"
- This applies to all confirmation levels including Critical

**Critical confirmation example:**
```
! WARNING: This will permanently delete organization 'acme-corp' and all
  associated data (142 projects, 3,891 resources).

  This action CANNOT be undone.

? Type 'acme-corp' to confirm: acme-corp
Deleting organization 'acme-corp'...
```

</confirmation_levels>

<non_interactive_fallback>

**Every prompt must have a flag alternative.** The interactive path is a convenience, not a requirement.

| Prompt | Flag equivalent |
|--------|----------------|
| "Project name?" | `--name my-app` |
| "Select region" | `--region us-east-1` |
| "Delete? [y/N]" | `--yes` or `--force` |
| "API token:" | `--token-file ./token` or `TOOL_TOKEN` env var |
| "Select features" | `--features logging,alerts` |

**When non-interactive and required input is missing:**
```
Error: Missing required input 'name'.
Provide it with --name <value>, or run interactively (TTY required).
```

**Never silently use a default for destructive operations in non-interactive mode.** Either require `--yes`/`--force` explicitly or fail.

</non_interactive_fallback>

<escape_and_cancel>

- Ctrl-C cancels any prompt and exits (with non-zero exit code)
- Ctrl-D (EOF) exits gracefully
- Esc cancels the current prompt (where supported)
- Make it obvious how to exit: show `(Ctrl-C to cancel)` in long-running prompts
- Never trap the user in an inescapable prompt loop

</escape_and_cancel>

<anti_patterns>
- **Required prompts with no flag alternative:** Breaks CI/CD, scripts, and automation
- **Interactive by default in pipes:** Prompting for input when stdin is piped data
- **Default Yes for destructive operations:** `Delete everything? [Y/n]` — default should be No
- **Invisible password with no feedback:** Show bullet characters (•) to indicate keystrokes are registering
- **Selection lists in non-TTY:** Arrow-key navigation doesn't work in pipes
- **No escape:** Ctrl-C doesn't work or leaves the terminal in a broken state
- **Silent defaults in dangerous commands:** Using default values without confirmation when `--force` wasn't specified
- **Over-prompting:** Asking for confirmation on every file in a batch (group into one confirmation)
</anti_patterns>
