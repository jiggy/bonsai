<overview>
Standards for documenting a CLI — what a README should contain, how to document commands, flags, exit codes, configuration, and breaking changes. Documentation is the bridge between the tool and its users. If behavior isn't documented, it doesn't exist for the user; if it's documented wrong, it's worse than missing. Every rule here is auditable by comparing the documentation against the actual CLI behavior.
</overview>

<documentation_hierarchy>

**CLI documentation exists at three levels. Each serves a different context and depth.**

| Level | Medium | Depth | Access | Purpose |
|-------|--------|-------|--------|---------|
| `--help` | Terminal | Brief | Always available, no internet | Usage string, flags, 2-3 examples per command |
| README / man pages | Repository / system | Medium | Offline, ships with the tool | Command reference, configuration, exit codes, quick start |
| Web docs | Online | Full | Requires internet | Tutorials, migration guides, searchable, cross-linked |

**`--help` (terminal):** The minimum viable documentation. Must cover usage, all flags with defaults, and 2-3 examples per command. A user with no internet and no README should be able to use the tool productively from `--help` alone.

**README / man pages (repository/system):** The single source of truth for offline use. Covers everything in `--help` plus configuration, exit codes, installation, and quick start. Man pages are the system-level equivalent of the README — same depth, different format.

**Web docs (online):** Full depth — tutorials, migration guides, architectural explanations, searchable index. Recommended for tools with 10+ commands where a README becomes unwieldy. Not a replacement for `--help` or README — a supplement.

**Rules:**
- Information must flow downward: web docs ⊇ README ⊇ `--help`. Higher levels contain everything lower levels contain, plus more.
- Never contradict between levels. If `--help` says the default is "table" and the README says "json", one of them is a bug.
- Each level must be self-sufficient for its purpose. A user reading only `--help` should never need the README to understand a flag. A user reading only the README should never need web docs to configure the tool.
- When information exists at multiple levels, the code (and therefore `--help`) is authoritative. If docs disagree, the fix is in the docs, not the code.

</documentation_hierarchy>

<readme_structure>

**Every CLI README must contain these sections:**

1. **Description** — One paragraph: what the tool does, who it's for, and what problem it solves. No marketing language.
2. **Installation** — Every supported method (package manager, binary, source). Include version requirements for runtime dependencies.
3. **Quick start** — The 3-5 commands a new user runs to go from installed to productive. This is the most important section — if a user leaves after reading one section, this is the one.
4. **Command reference** — Every command with its usage string, description, flags, and examples. Can link to a separate doc or man pages for detail, but the README must have at minimum the top-level command list with one-line descriptions.
5. **Configuration** — All environment variables, config file format, and precedence order.
6. **Exit codes** — Table of exit codes and their meanings.
7. **Shell completions** — How to install completions for bash, zsh, fish. If the CLI generates them (`tool completion bash`), document the exact command and where to put the output.
8. **Contributing** — How to build from source, run tests, and submit changes.
9. **License** (recommended for open-source CLIs) — State the license and link to the LICENSE file.

Description and quick start should appear early. The rest can be ordered by what your users need most. For most CLIs: installation before command reference, configuration before exit codes.

**Rules:**
- The description must be accurate in one reading — no "and much more!" or "powerful, flexible, extensible" filler
- Installation instructions must include the exact commands to run, not just "install via npm" — show `npm install -g tool`
- Quick start must be copy-pasteable — every command should work as written without modification (except placeholder values, which are clearly marked)
- If the README links to external docs, every link must resolve (broken doc links are worse than missing docs)

**Example — description section:**

Good:
```
mycli migrates PostgreSQL databases. It reads migration files from a directory,
applies them in order, and tracks which migrations have run. It supports
PostgreSQL 12+ and requires a database connection string.
```

Bad:
```
mycli is a powerful, flexible, enterprise-grade database migration tool that
helps teams manage their database lifecycle with ease and confidence.
```

</readme_structure>

<man_pages>

**Recommended for developer tools and system utilities. Optional for application-specific CLIs where `--help` may suffice.**

Man pages follow a standard section structure. Every man page should include these sections in order:

1. **NAME** — Command name and one-line description
2. **SYNOPSIS** — Usage string(s)
3. **DESCRIPTION** — Detailed explanation of what the command does
4. **OPTIONS** — All flags and arguments with descriptions
5. **EXIT STATUS** — Exit codes and their meanings
6. **ENVIRONMENT** — Environment variables the command reads
7. **FILES** — Config files, data files, and their locations
8. **EXAMPLES** — Usage examples (at least 2-3)
9. **SEE ALSO** — Related commands and documentation links
10. **BUGS** — Known issues and how to report new ones

See `references/ux/help-system.md` (man_pages) for detailed formatting conventions.

**Rules:**
- Generate man pages from the same source as `--help` to prevent drift. If `--help` and the man page are maintained separately, they will diverge — and users will find the wrong answer in whichever one they check second.
- Man pages must be installable via the package manager or `make install`. A man page that requires manual copying to `/usr/share/man/` won't be read.
- If your tool has subcommands, provide a man page per subcommand (`tool-deploy(1)`, `tool-config(1)`) in addition to the root page (`tool(1)`).

</man_pages>

<command_documentation>

**Every command must document:**

1. **Usage string** — Following the conventions in `references/ux/help-system.md`: `tool command [flags] <required-arg> [optional-arg]`
2. **Description** — One to three sentences: what the command does and when to use it
3. **Flags** — Every flag with short form, long form, type, default, and description (see flag documentation below)
4. **Examples** — At least 2 real-world examples, progressing from simple to complex
5. **Exit codes** — Any command-specific exit codes beyond the global ones

**Usage string must be a valid command.** Replace the placeholders with real values and it should run.

**Description must state what the command does, not what it is:**

Good: `Applies pending migrations to the target database in order.`
Bad: `The migrate command for database migrations.`

**Examples must be real-world, not synthetic:**

Good:
```
# Apply all pending migrations
$ mycli migrate --database postgres://localhost/myapp

# Apply migrations up to a specific version
$ mycli migrate --database postgres://localhost/myapp --target 20240115_add_users

# Dry run to see what would be applied
$ mycli migrate --database postgres://localhost/myapp --dry-run
```

Bad:
```
$ mycli migrate --database <url>
$ mycli migrate --database <url> --target <version>
```

The bad example forces the user to guess what a valid URL and version look like. The good example shows real formats so the user can pattern-match.

</command_documentation>

<flag_documentation>

**Every flag entry must include:**

| Field | Required | Description |
|-------|----------|-------------|
| Short form | If it exists | `-f` |
| Long form | Always | `--format` |
| Type | For value flags | `string`, `int`, `bool` |
| Default | Always | The value used when the flag is omitted |
| Description | Always | What the flag does, including valid values for enum types |

**Format — consistent across all commands:**
```
  -f, --format string    Output format: json, yaml, table (default "table")
  -n, --dry-run          Preview changes without executing
  -t, --timeout int      Request timeout in seconds (default 30)
      --no-color         Disable color output
```

**Rules:**
- Align description columns for scannability
- Show the default in parentheses at the end: `(default "table")`
- For boolean flags, absence means false — don't write `(default false)` unless the flag has a `--no-` variant where the default is non-obvious
- For enum flags, list all valid values in the description
- If a flag is deprecated, mark it: `(deprecated, use --format instead)`
- Flags must be documented identically wherever they appear — the same flag in `--help`, README, and man page must have the same description and default

**Cross-command consistency check:** Same flag name must mean the same thing in every command. If `--output` means "output file" in `export` but "output format" in `list`, one of them needs renaming. See `references/contract/flags.md` (cross_command_consistency).

</flag_documentation>

<exit_code_documentation>

**Exit codes must be documented in two places:**

1. **Root `--help` output** — At minimum a reference: "Exit codes: 0 (success), 1 (general error), 2 (usage error). See 'tool help exit-codes' for details."
2. **README** — Full table of all exit codes with meanings.

**Table format:**

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (unspecified failure) |
| 2 | Usage error (invalid flags, missing arguments) |
| 3 | Configuration error (invalid config file, missing required config) |
| 10 | Connection error (network or database unreachable) |
| 20 | Authentication error (invalid or expired credentials) |

Codes 0, 1, and 2 are universal conventions (0 = success, 1 = general error, 2 = usage error). Codes 3+ in this table are illustrative of how to define domain-specific codes — not a recommendation to use those specific numbers. Choose codes that make sense for your tool and document them.

**Rules:**
- Every non-zero exit code the CLI can produce must be in the table
- Codes must be stable — once documented, a code's meaning cannot change
- Group related codes (e.g., 10-19 for network errors) and document the grouping scheme
- If the CLI wraps another tool's exit code, document which codes are passed through and which are translated

</exit_code_documentation>

<configuration_documentation>

**Environment variables:**

Every environment variable the CLI reads must be documented with:
- Name (with the prefix convention: `TOOL_*`)
- Type (string, integer, boolean, path, URL)
- Default value
- Description
- Which flag it corresponds to (if any) and which takes precedence

**Format:**
```
TOOL_DATABASE_URL   URL     (required)    PostgreSQL connection string
TOOL_LOG_LEVEL      string  "info"        Log verbosity: error, warn, info, debug
TOOL_CONFIG_PATH    path    ~/.config/tool/config.yaml    Config file location
TOOL_NO_COLOR       bool    false         Disable color (equivalent to --no-color)
```

**Config file documentation must include:**
- Supported format(s) — YAML, TOML, JSON, INI
- File location(s) — default path, XDG-compliant paths, override flag/env var
- Complete annotated example with every valid key, its type, default, and description
- Which keys correspond to which flags

**Precedence order must be explicitly documented:**

State the override chain clearly:
```
Configuration precedence (highest to lowest):
1. Command-line flags
2. Environment variables
3. Project config file (./.tool.yaml)
4. User config file (~/.config/tool/config.yaml)
5. System config file (/etc/tool/config.yaml)
6. Built-in defaults
```

This is not a convention to follow — it is a fact about how your specific CLI behaves, and it must be documented accurately.

**Config debugging:**

If the CLI provides a config debugging command (`tool config show`, `tool --config-show`, or similar), document it as the primary tool for resolving "why is my setting not taking effect?" questions. Users who can see the resolved configuration — which file each value came from, which overrides applied — can self-diagnose most configuration issues without filing a bug.

</configuration_documentation>

<changelog_and_migration>

**Changelog rules:**

- Every release must have a changelog entry
- Entries must be categorized: Added, Changed, Deprecated, Removed, Fixed, Security — following the Keep a Changelog format (keepachangelog.com), a widely adopted standard for human-readable changelogs
- Each entry must describe the user-visible change, not the implementation detail
- Breaking changes must be called out with a `BREAKING:` prefix or a dedicated "Breaking Changes" section
- Consider adopting Conventional Commits (conventionalcommits.org) as a commit message convention — it enables automated changelog generation from git history. Both Keep a Changelog and Conventional Commits are established community standards, not inventions of this skill.

**Good changelog entry:**
```
## 2.0.0 — 2024-03-15

### Breaking Changes
- `--format` flag now defaults to "json" instead of "table". To restore
  previous behavior, use `--format table` or set TOOL_FORMAT=table.
- Removed `tool migrate --legacy` (deprecated in 1.8.0). Use `tool migrate`
  with the `--compat` flag for old-format migration files.

### Added
- `tool diff` command for comparing two database schemas

### Fixed
- Exit code 0 returned on connection timeout (now returns exit code 10)
```

**Bad changelog entry:**
```
## 2.0.0
- Bug fixes and improvements
- Updated dependencies
```

**Migration guides:**

Every breaking change must have a migration guide that includes:
1. What changed
2. Why it changed
3. Exact steps to update (before/after commands)
4. Workaround if immediate migration isn't possible

**Example:**
```
## Migrating from 1.x to 2.0

### --format default changed from "table" to "json"

**What changed:** The default output format is now JSON. This affects all
commands that produce structured output.

**Why:** JSON is the most common format for scripting and CI pipelines. Users
who need human-readable output can set the default explicitly.

**To update:**
  Before: tool list
  After:  tool list --format table

  Or set permanently: export TOOL_FORMAT=table
```

**Deprecation notices:**

- Must state what is deprecated and what replaces it
- Must state when the deprecated feature will be removed (specific version)
- Must appear in: changelog, `--help` output, and runtime warnings (stderr)

</changelog_and_migration>

<examples_in_documentation>

**Every documented command needs real-world examples.**

**Rules:**
- At least 2 examples per command: one basic, one showing a common flag combination
- Examples must use realistic values — real file extensions, real-looking URLs, plausible resource names
- Show expected output when it helps the user understand what the command does
- Use `$` prefix to distinguish commands from output
- Include comments (`#`) to explain what each example demonstrates
- If a command has destructive effects, show the `--dry-run` example first

**Realistic values, not placeholders:**

Good:
```
$ tool deploy api-service.yaml --env production
Deploying api-service to production...
  Created: load-balancer (lb-prod-api)
  Updated: web-server (3 replicas → 5 replicas)
  Unchanged: database
Deploy complete. 3 resources in 12s.
```

Bad:
```
$ tool deploy <file> --env <environment>
```

**Progressive complexity:**
1. First example: simplest possible invocation
2. Second example: most common real-world usage
3. Third example (optional): advanced use case or combined flags

</examples_in_documentation>

<docs_accuracy>

**Documentation must match behavior. This is not aspirational — it is auditable.**

**Rules:**
- Every flag documented in the README must exist in `--help` and vice versa
- Every default value documented must match the actual default
- Every example must produce the documented output (or reasonable approximation) when run
- Every environment variable documented must actually be read by the CLI
- Every exit code documented must actually be produced by the CLI

**Keeping docs in sync:**
- Generate command reference from the same source as `--help` where possible
- If docs are maintained separately, include a CI check that diffs the README command reference against `--help` output
- Version the documentation alongside the code — docs and code ship in the same commit
- Mark auto-generated sections clearly so contributors know not to edit them by hand

**When behavior changes, documentation changes in the same commit.** Documentation that describes a previous version is a bug with the severity of a broken feature.

**Documentation versioning:**

If multiple major versions coexist (v1.x and v2.x), documentation must indicate which version it applies to. Web docs should support version switching (dropdown or URL path like `/v2/docs/...`). README in the repo naturally tracks the branch version — this is one reason to keep the README as the primary offline reference rather than an external wiki.

</docs_accuracy>

<anti_patterns>
- **Undocumented flags:** Flag exists in `--help` but not in the README, or vice versa. Users discover it by accident and can't trust the docs.
- **Stale docs:** README describes behavior the CLI no longer implements. Often caused by code changes without doc updates.
- **No examples:** Command reference lists flags and descriptions but zero usage examples. Users must guess how the pieces fit together.
- **Synthetic examples:** `tool command <arg1> <arg2>` instead of showing real values. Tells the user the syntax but not the semantics.
- **Changelog says "bug fixes":** No detail on what was fixed. Users can't tell if the bug affecting them is resolved.
- **Missing migration guide:** Breaking change documented in the changelog but no steps to update. Users must reverse-engineer the migration.
- **Broken doc links:** README links to external docs that return 404. Worse than no link — implies the information exists somewhere.
- **Aspirational documentation:** Docs describe planned features as if they exist. Users try to use them and get cryptic errors.
- **Config without annotated example:** Lists config keys without showing a complete, working config file. Users piece it together from fragments.
- **Precedence order not documented:** Users can't predict whether a flag, env var, or config file will win when they conflict.
- **README with no quick start:** Comprehensive reference but no "here's how to get going in 60 seconds" section. New users bounce.
- **Duplicated docs that diverge:** Same information in README, wiki, and man page with different values. Nobody knows which is authoritative.
</anti_patterns>
</content>
</invoke>