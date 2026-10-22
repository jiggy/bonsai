<overview>
Flag conventions covering short/long forms, boolean and value flags, repeatable flags, standard names, naming rules, and mutual exclusivity. Flags are the primary mechanism for modifying command behavior and are the most stable part of the contract — changing a flag's meaning is always a breaking change.
</overview>

<posix_conventions>
From IEEE Std 1003.1 (POSIX Utility Conventions):

1. Options are single alphanumeric characters preceded by `-`
2. Options without arguments can be grouped: `-abc` = `-a -b -c`
3. Each option and its argument should be separate arguments: `-o file` not `-ofile`
4. Option-arguments should not be optional (Guideline 7)
5. All options should precede operands in the command line
6. `--` terminates options; everything after is treated as an operand
7. `-` alone conventionally means stdin or stdout
8. The order of options should not matter unless documented
9. `-W` is reserved for vendor extensions
</posix_conventions>

<gnu_extensions>
From GNU Coding Standards:

- Long options use `--` prefix with lowercase words separated by hyphens: `--ignore-backups`
- Long options accept arguments with space or `=`: `--output=file.txt` or `--output file.txt`
- Negation flags use `--no-` prefix: `--no-sort`, `--no-color`
- Optional arguments to long options require `=` (no space): `--color=never`
- All programs must support `--version` and `--help`
- Unambiguous abbreviation of long options is allowed by convention (but consider disabling it to preserve namespace for future flags)
</gnu_extensions>

<flag_types>

<type name="Boolean Flags">
**Behavior:** Presence means true, absence means false.
**Negation:** `--no-<flag>` for explicit false.
**Never:** Accept `--flag=false` or `--flag=true` — it's confusing and error-prone.

```
--verbose       # Enable verbose output
--no-verbose    # Explicitly disable verbose output (useful for overriding config)
--force         # Skip safety checks
--dry-run       # Preview without executing
```
</type>

<type name="Value Flags">
**Behavior:** Require an argument value.
**Formats:** `--output file.txt` or `--output=file.txt` (support both).
**Short form:** `-o file.txt` (space required by POSIX, but many parsers also accept `-ofile.txt`).

```
--output file.txt       # Output file
--format json           # Output format
--timeout 30            # Timeout in seconds
--region us-east-1      # Target region
```
</type>

<type name="Repeatable Flags">
**Behavior:** Can be specified multiple times, each adding to a collection.
**Common patterns:**

```
# Stacking for verbosity levels
-v          # Verbose
-vv         # Debug
-vvv        # Trace

# Multiple values
--exclude=*.log --exclude=*.tmp
--tag key=value --tag env=prod

# Multiple files
--config base.yaml --config override.yaml
```
</type>

<type name="Enum/Choice Flags">
**Behavior:** Accept one value from a predefined set.
**Help text:** Always list valid values.

```
--format json|yaml|table|plain
--color always|never|auto
--log-level error|warn|info|debug
```
</type>

</flag_types>

<standard_flags>

**Universal (every CLI should support):**

| Short | Long | Purpose |
|-------|------|---------|
| `-h` | `--help` | Show help text. Never overload for another purpose. |
| `-V` | `--version` | Show version string. Capital V to avoid collision with -v. |

**Common (use when applicable):**

| Short | Long | Purpose |
|-------|------|---------|
| `-v` | `--verbose` | Increase output verbosity |
| `-q` | `--quiet` / `--silent` | Suppress non-essential output |
| `-f` | `--force` | Skip safety checks and confirmations |
| `-n` | `--dry-run` | Preview changes without executing |
| `-o` | `--output` | Output file or directory |
| `-d` | `--debug` | Enable debug output |
| `-a` | `--all` | Include all items (not just defaults) |
| `-i` | `--interactive` | Enable interactive mode |
| `-y` | `--yes` | Assume yes for all prompts |
| `-r` | `--recursive` | Operate recursively |
| `-p` | `--port` | Port number |
| `-u` | `--user` | Username |

**Output control (no standard short forms):**

| Long | Purpose |
|------|---------|
| `--json` | JSON output |
| `--plain` | Machine-readable plain text (tab-separated) |
| `--no-color` | Disable color output |
| `--color=WHEN` | Color mode: always, never, auto |
| `--no-input` | Disable interactive prompts |
| `--columns` | Select which columns to display |

</standard_flags>

<naming_rules>

- **kebab-case:** `--additional-probing-path` not `--additionalprobingpath` or `--additional_probing_path`
- **Full words:** `--verbose` not `--verb`, `--recursive` not `--recur`
- **Consistent pluralization:** Either all singular or all plural for multi-value options
- **No units in names:** `--timeout` not `--timeout-in-seconds` (document units in help text)
- **Positive names:** `--color` with `--no-color` negation, not `--no-color` as the base
- **Short flags:** Reserve for frequently-used flags. Don't pollute the namespace.
- **Short flag letters:** Use mnemonics where possible (`-o` for output, `-v` for verbose)

</naming_rules>

<secrets_handling>
**Never read secrets from flags.** Flag values leak into:
- `ps aux` output (visible to all users on the system)
- Shell history (`~/.bash_history`, `~/.zsh_history`)
- Process accounting logs

**Instead:**
- Accept secrets via file: `--password-file /path/to/secret`
- Accept secrets via stdin: `echo $SECRET | tool --password-stdin`
- Accept secrets via environment variable (less ideal but common): `TOOL_API_KEY`
- Use OS keychain/credential helpers
</secrets_handling>

<ordering>

**Make flags order-independent.** Users commonly hit up-arrow and append a flag at the end:
```
tool command --flag1 value1 --flag2 value2
tool command --flag2 value2 --flag1 value1    # Should behave identically
```

**Exception:** Mutually exclusive flags — the last one wins (document this behavior).

</ordering>

<cross_command_consistency>

**Same concept = same flag name across all commands.** This is a contract-level requirement, not a style preference. Users build muscle memory around flag names.

**What to check:**
- Same parameter uses same long name everywhere: not `--database-path` in `init` and `--db` in `query`
- Short flags map to the same long flag everywhere: `-d` means `--debug` in all commands, not `--delete` in one and `--database` in another
- Value types are consistent: `--timeout` always takes seconds, not seconds in one command and milliseconds in another
- Resource identifiers use the same format: always a name, always a path, or always accept both

**Acceptable variation:**
- A flag that exists in one command but not another (different commands have different needs)
- A flag with a narrower meaning in a specific context, IF the long name reflects this: `--db` (name) vs `--database-path` (file path) is fine IF `--db` never accepts a path

**Not acceptable:**
- Two different long names for the same concept: `--output-dir` and `--dest`
- Same short flag, different meanings across commands
- Same flag name, different value types or semantics

</cross_command_consistency>

<deprecation>

**Deprecating a flag is a contract change. Handle with care.**

**Pattern:**
1. Add the new flag. Both old and new work identically.
2. When the old flag is used, emit a deprecation warning to stderr (once per session):
   `Warning: --database-path is deprecated, use --db instead. Will be removed in vX.0.`
3. After at least 2 minor versions, remove the old flag in the next major version.

**Rules:**
- Deprecation warnings go to stderr, never stdout
- The old flag must continue to work exactly as before during the deprecation period
- Document the deprecation in --help: show the old flag as `(deprecated, use --db)`
- Never silently ignore a deprecated flag — always warn so users know to update
- Hidden aliases (old flag works but isn't shown in --help) are acceptable after the warning period but before removal

</deprecation>

<anti_patterns>
- **Overloading `-h`:** Using `-h` for anything other than help (some tools use it for "host")
- **Missing long forms:** Having `-v` without `--verbose` makes scripts unreadable
- **Ambiguous short flags:** `-s` could mean `--silent`, `--secure`, `--size`, `--sort` — pick one or skip the short form
- **Flags that modify other flags:** `--output-format` that only works with `--output` — redesign as `--output file.json` with format inferred, or use `--format` independently
- **Required flags:** If a flag is always required, it should probably be a positional argument
- **Boolean flags with values:** `--verbose=true` / `--verbose=false` — use `--verbose` / `--no-verbose`
- **Inconsistent negation:** `--no-color` but `--disable-cache` but `--skip-tests` — pick one prefix
- **Cross-command inconsistency:** `--database-path` in one command, `--db` in another for the same resource
- **Short flag conflicts:** `-d` means `--debug` in command A but `--dry-run` in command B
</anti_patterns>
