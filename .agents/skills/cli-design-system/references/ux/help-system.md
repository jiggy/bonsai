<overview>
Help text structure, usage string conventions, man page format, example-driven help, and flag/subcommand discovery through help. The help system is the primary learning interface for a CLI — most users will never read external documentation.
</overview>

<help_invocation>

**Every CLI must support:**
- `--help` and `-h` — show help for the current command/subcommand
- `help` as a subcommand (for git-style tools): `tool help commit`
- `-h` must never be overloaded for another purpose (e.g., "host")

**Behavior rules:**
- `-h` / `--help` takes priority over all other flags — `tool --delete-everything -h` shows help, doesn't delete anything
- Help text goes to stdout (not stderr) — enables `tool --help | grep flag`
- Exit code 0 when help is displayed successfully
- **No ANSI escape sequences in help text.** Help must be readable when piped (`tool --help | less`), redirected to a file, or rendered in non-TTY contexts. Use bold/color only when outputting directly to a TTY, and strip it when piped.
- If output is longer than the terminal, use a pager (`less -FIRX` is a good default — F=quit if one screen, I=case-insensitive search, R=ANSI passthrough, X=no clear on exit)

</help_invocation>

<help_text_structure>

**Short help (no arguments provided, or `-h`):**
```
Brief one-line description of what this command does.

USAGE
  tool command [flags] <required-arg> [optional-arg]

EXAMPLES
  tool command file.txt                    Basic usage
  tool command --format json file.txt      With output format
  tool command --dry-run *.txt             Preview mode

OPTIONS
  -f, --format string   Output format: json, yaml, table (default "table")
  -n, --dry-run         Preview changes without executing
  -v, --verbose         Increase output verbosity
  -h, --help            Show this help message

Use "tool command --help" for more detailed information.
```

**Full help (`--help`):**
- Everything from short help, plus:
- All flags (not just common ones)
- Longer description with context
- More examples, including edge cases
- Related commands ("See also: tool other-command")
- Links to documentation

**Root command help (no subcommand):**
```
tool-name — One-line description

USAGE
  tool <command> [flags]

GETTING STARTED
  init        Initialize a new project
  login       Authenticate with the service

COMMANDS
  list        List all resources
  create      Create a new resource
  show        Show resource details
  delete      Delete a resource

OTHER COMMANDS
  config      Manage configuration
  completion  Generate shell completions
  version     Show version information

OPTIONS
  --config string   Config file path
  --no-color        Disable color output
  -h, --help        Show this help message

Use "tool <command> --help" for more information about a command.
Docs: https://tool.dev/docs
```

</help_text_structure>

<usage_string_conventions>

| Symbol | Meaning | Example |
|--------|---------|---------|
| `<arg>` | Required argument | `<filename>` |
| `[arg]` | Optional argument | `[output-file]` |
| `...` | Repeatable | `<file>...` |
| `\|` | Mutually exclusive choices | `--format json\|yaml\|table` |
| `[flags]` | Optional flags placeholder | `[flags]` |
| `[-vfn]` | Groupable boolean flags | `[-vf]` |

**The usage line should be a valid command.** A user should be able to replace placeholders and run it.

**Examples:**
```
Usage: cp [flags] <source>... <destination>
Usage: grep [flags] <pattern> [file...]
Usage: docker container create [flags] <image> [command] [args...]
```

</usage_string_conventions>

<examples_in_help>

**Lead with examples.** Users scan for examples before reading flag descriptions.

**Example quality rules:**
- Start with the simplest, most common use case
- Progress to more complex uses
- Show real-world scenarios, not synthetic ones
- Include actual output when it clarifies behavior
- Use `$` prefix to distinguish commands from output

**Structure:**
```
EXAMPLES
  # Basic usage
  $ tool deploy app.yaml

  # Deploy to specific environment
  $ tool deploy app.yaml --env production

  # Dry run with verbose output
  $ tool deploy app.yaml --dry-run -v
  Would deploy 3 resources to staging:
    - web-service (updated)
    - worker (unchanged)
    - database (created)
```

</examples_in_help>

<flag_descriptions>

**Formatting rules:**
- Begin with lowercase letter
- Do not end with a period
- Fit on 80-character screen (wrap if necessary)
- Show default value: `(default "table")`
- Show type hint for value flags: `--timeout int`, `--output string`
- Align description columns for scannability

**Good descriptions:**
```
  -f, --format string    Output format: json, yaml, table (default "table")
  -n, --dry-run          Preview changes without executing
  -t, --timeout int      Request timeout in seconds (default 30)
      --no-color         Disable color output
```

**Bad descriptions:**
```
  -f    Format.
  -n    Dry run mode for the application.
  -t    The timeout.
```

</flag_descriptions>

<man_pages>

**Standard man page sections (in order):**
1. NAME — Command name and one-line description
2. SYNOPSIS — Usage string(s)
3. DESCRIPTION — Detailed explanation
4. OPTIONS — All flags and arguments
5. EXIT STATUS — Exit codes and their meanings
6. ENVIRONMENT — Environment variables consulted
7. FILES — Config files and their locations
8. EXAMPLES — Usage examples
9. SEE ALSO — Related commands, documentation links
10. BUGS — Known issues and bug reporting info
11. AUTHORS — Attribution

**When to provide man pages:**
- System-level tools: always
- Developer tools: recommended
- Application-specific CLIs: optional (--help may suffice)

Generate man pages from the same source as --help to keep them synchronized.

</man_pages>

<grouping_and_ordering>

**Group commands by workflow, not alphabetically:**
- "Getting Started" commands first
- Most frequently used commands next
- Administrative/config commands last
- `help` and `version` at the very end

**Group flags by function:**
- Output control flags together
- Authentication flags together
- Common flags first, rare flags later

**Section headings in help text:**
- Use UPPERCASE for section headings: `USAGE`, `OPTIONS`, `EXAMPLES`, `COMMANDS`
- This follows man page conventions and is visually scannable without color
- Consistent across all commands and subcommands

**Include a support URL:**
- Add documentation URL and/or issue tracker link at the bottom of root help
- Example: `Docs: https://tool.dev/docs` or `Report bugs: https://github.com/org/tool/issues`
- Subcommand help can link to the specific doc page for that command

</grouping_and_ordering>

<version_output>

**`--version` output format:**

Standard format: `programname X.Y.Z` to stdout.

```
$ myapp --version
myapp 1.2.3

$ git --version
git version 2.43.0
```

**Rules:**
- Output to stdout (not stderr) — enables `tool --version | cut -d' ' -f2`
- Exit code 0
- Never overload `-v` for version (it means `--verbose`). Use `-V` if a short form is needed.
- Keep it minimal: just the name and semver. Put extras (build date, commit hash, platform) behind `tool info` or `tool --version --verbose`
- Parseable: `programname X.Y.Z` or `programname version X.Y.Z`. Not a paragraph.

</version_output>

<reference_help_output>

**Complete correct --help for a typical subcommand:**

```
$ tool deploy --help
Deploy resources to the target environment.

USAGE
  tool deploy [flags] <manifest>

EXAMPLES
  $ tool deploy app.yaml                  Deploy to default environment
  $ tool deploy app.yaml --env prod       Deploy to production
  $ tool deploy app.yaml --dry-run -v     Preview with verbose output

FLAGS
  -e, --env string       Target environment (default "staging")
  -n, --dry-run          Preview changes without executing
  -v, --verbose          Increase output verbosity
  -f, --force            Skip confirmation prompt
  -h, --help             Show this help message

GLOBAL FLAGS
      --no-color         Disable color output
      --json             JSON output
  -q, --quiet            Suppress non-essential output

See also: tool status, tool rollback
Docs: https://tool.dev/docs/deploy
```

**What to audit against this reference:**
- Description leads (one line, no filler)
- EXAMPLES section exists and comes before FLAGS
- Examples use `$` prefix, show real-world usage, progress from simple to complex
- FLAGS show short + long form, type hint, default value in parens
- GLOBAL FLAGS separated from command-specific flags
- "See also" cross-references related commands
- Docs URL present
- All headings UPPERCASE
- No ANSI codes (plain text, pipeable)

</reference_help_output>

<anti_patterns>
- **No examples in help text:** The most useful section is missing from most CLIs
- **Alphabetical command listing:** Users don't know the command name they're looking for
- **Help to stderr:** `tool --help | grep` fails silently
- **Overloading -h:** Using `-h` for "host" or "header" instead of help
- **Wall of text:** Unstructured paragraphs instead of scannable sections
- **Stale help text:** Help that describes behavior the code no longer implements
- **No "see also":** Missing cross-references between related commands
- **No default values shown:** Users must guess or read source code
- **Truncated flag descriptions:** Descriptions cut off at terminal width with no wrap
</anti_patterns>
