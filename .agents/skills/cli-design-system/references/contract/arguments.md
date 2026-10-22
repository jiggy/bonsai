<overview>
Positional argument conventions, ordering rules, the `--` delimiter, stdin handling, and when to prefer arguments vs flags. Arguments are the unnamed, position-dependent inputs to a command — simpler than flags but harder to extend without breaking changes.
</overview>

<when_to_use_arguments>

**Prefer arguments when:**
- There is exactly one primary input (the "thing" being operated on)
- The meaning is unambiguous from position: `cat file.txt`, `cd /path`
- Multiple inputs are homogeneous: `rm file1 file2 file3`
- The command reads from files OR stdin: `grep pattern [file...]`

**Prefer flags when:**
- Two or more arguments serve different roles (ambiguous ordering)
- The value is optional or has a default
- The parameter name adds clarity: `--region us-east-1` vs a bare `us-east-1`
- You may need to add more parameters later (flags are extensible, argument positions are not)

**The 12 Factor CLI rule:** "Prefer flags to args." Flags are self-documenting, order-independent, and easier to extend. Use arguments only when the meaning is obvious.

</when_to_use_arguments>

<conventions>

**Positional arguments:**
- Appear after all flags (POSIX convention)
- Position determines meaning: `cp SOURCE DEST` — order matters
- Use `<angle-brackets>` for required args in usage strings
- Use `[square-brackets]` for optional args in usage strings
- Use `...` for variadic (repeatable) args: `<file>...`

**Variadic arguments:**
- Only the LAST argument can be variadic
- All variadic values are the same type: `rm file1 file2 file3`
- Never have two variadic arguments — it's ambiguous where one ends and the other begins

**Optional arguments:**
- If an argument is optional, the command must have sensible default behavior without it
- Example: `ls` (lists current directory) vs `ls /path` (lists specified directory)
- Never make the first argument optional and the second required

</conventions>

<double_dash_delimiter>

**The `--` convention:**
- Everything after `--` is treated as an operand, never as a flag
- Required for passing arguments that start with `-`: `grep -- -v file.txt`
- Used to separate tool flags from delegated command flags: `npm run -- --port 3000`

**Every CLI that accepts arguments MUST support `--`.** It's a POSIX requirement and prevents a class of subtle bugs where filenames starting with `-` are misinterpreted as flags.

</double_dash_delimiter>

<stdin_handling>

**The `-` convention:**
- A single `-` as an argument means "read from stdin" or "write to stdout"
- Example: `cat -` reads stdin, `tar xf -` extracts from stdin
- If your command accepts file paths, support `-` for piping

**Implicit stdin:**
- If no file argument is given AND stdin is not a TTY, read from stdin
- If no file argument is given AND stdin IS a TTY, show help or prompt — don't hang
- Example: `cat` with no args on a TTY just hangs (bad UX) — detect this and help the user

**Multi-line stdin:**
- For commands that accept multi-line input, consider supporting heredoc-friendly patterns
- Read until EOF, not until first newline

</stdin_handling>

<argument_types>

<type name="File paths">
- Accept relative and absolute paths
- Expand `~` to home directory (shell usually does this, but handle it in case it doesn't)
- Handle paths with spaces (your parser, not the user, should handle quoting)
- Support glob patterns where appropriate (`*.txt`)
</type>

<type name="Resource identifiers">
- Accept names, IDs, or URLs depending on context
- Be forgiving: if the user provides a full URL but only the ID is needed, extract it
- Example: `gh pr view 123` or `gh pr view https://github.com/owner/repo/pull/123`
</type>

<type name="Subcommands as arguments">
- Some tools treat the first argument as a subcommand
- The subcommand then defines its own argument signature
- Example: `git [subcommand] [subcommand-args]`
</type>

</argument_types>

<ordering_rules>

1. Command name first: `tool`
2. Subcommand(s): `tool noun verb`
3. Flags anywhere (but conventionally before arguments): `tool noun verb --flag`
4. Arguments last: `tool noun verb --flag value argument`
5. `--` to terminate flags: `tool noun verb --flag value -- argument-that-looks-like-flag`

**Make flag/argument ordering flexible.** Users commonly do:
```
tool --flag argument        # Flags first (conventional)
tool argument --flag        # Flags last (common in practice)
```
Both should work identically.

</ordering_rules>

<anti_patterns>
- **Multiple positional args for different things:** `tool source destination format` — use flags for all but the primary input
- **Hanging on TTY stdin:** Not detecting that stdin is a terminal and waiting forever for input that will never come
- **Not supporting `--`:** Breaking when a filename starts with `-`
- **Required ordering:** Failing when `tool arg --flag` is used instead of `tool --flag arg`
- **Ambiguous positions:** Is `tool A B` copying A to B, comparing A and B, or processing both?
- **Ignoring `-`:** Not supporting stdin/stdout when file paths are accepted
- **Excessive positional args:** More than 2-3 positional arguments almost always means some should be flags
</anti_patterns>
