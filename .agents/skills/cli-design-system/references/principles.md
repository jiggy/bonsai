<overview>
Universal principles that apply across all three layers (contract, UX, UI) of CLI design. Every other reference file in this skill depends on these. When principles conflict with each other, context determines which takes priority — but violating any principle should be a conscious, documented decision.
</overview>

<principles>

<principle name="Predictability Over Cleverness">
**Rule:** Consistent behavior builds trust. Follow established conventions even when a "better" alternative exists.

**Why:** Users build muscle memory around CLI conventions. A flag that behaves differently from every other tool creates friction proportional to how often it's used.

**Application:**
- Follow POSIX/GNU flag conventions even if your language's argument parser defaults differ
- Use standard verbs (list, create, delete, show) not creative synonyms (fetch, spawn, nuke, peek)
- If every tool in the ecosystem uses `--output` for output format, don't use `--format`
- Never change the behavior of an existing flag in a new version

**Test:** "Would a user who has never read the docs guess correctly what this does?"
</principle>

<principle name="Safe Defaults">
**Rule:** The default behavior should be the safest, most common choice. Dangerous operations require explicit opt-in.

**Why:** Most users run commands without reading all flags first. The default path should never destroy data, send emails, or modify production systems.

**Application:**
- `rm` without `--force` should prompt for confirmation on protected files
- Destructive operations default to dry-run or require `--confirm`
- Network operations default to HTTPS, not HTTP
- If `ls` were designed today, it would probably default to `ls -lhF`
- Default output should be human-readable; machine-readable requires `--json`

**Test:** "If a user runs this with no flags, what's the worst that can happen?"
</principle>

<principle name="Minimal Confirmation on Success">
**Rule:** Successful operations confirm briefly what happened. Verbose celebration is noise; complete silence feels broken. Use `--quiet` for scripts that need zero output.

**Why:** After a multi-second state change (deploy, delete, migration), silence is indistinguishable from failure. Users need confirmation, especially for operations whose effects aren't visible in the filesystem. But chatty success output (banners, ASCII art, log dumps) drowns the signal.

**Application:**
- State-changing operations: confirm what changed. `git push` shows the commit range. `terraform apply` shows "1 added, 0 changed."
- Read operations: print the requested data, nothing else
- File operations (cp, mv, mkdir): brief confirmation is acceptable; pure silence is the traditional UNIX convention and also acceptable
- Confirmation goes to stderr when stdout carries data (composability preserved)
- Provide `--quiet` / `-q` to suppress all non-error output for scripting and CI
- Errors always produce output (to stderr)

**The spectrum:**
```
Too silent:  $ tool deploy                     ← did it work? frozen? crashed?
Right:       $ tool deploy                     ← "Deployed v2.3.1 to production (3 resources)"
Too chatty:  $ tool deploy                     ← 50 lines of [INFO] logs
```

**Test:** "After this command finishes, does the user know what happened without running another command?"
</principle>

<principle name="Composability">
**Rule:** stdout is for data, stderr is for humans. Every CLI should be a building block.

**Why:** The UNIX pipe is the original API. Programs that mix data and status messages on stdout break every downstream consumer.

**Application:**
- Primary output (data, results) goes to stdout
- Progress bars, spinners, status messages, warnings go to stderr
- Support `--json` for structured output and `--plain` for tab-delimited output
- Accept `-` to mean stdin/stdout where file paths are expected
- Output one logical record per line when possible (grep-friendly)
- Support `--` to terminate option parsing

**Test:** "Can I pipe this into `grep`, `jq`, or `awk` and get useful results?"
</principle>

<principle name="Reversibility">
**Rule:** Destructive operations require confirmation. Provide ways to preview before executing.

**Why:** Humans make typos. Autocomplete selects wrong targets. A deleted production database is not recoverable from "oops."

**Application:**
- Provide `--dry-run` / `-n` for any command that modifies state
- Prompt for confirmation on destructive operations (deletable via `--yes`)
- For severe destruction, require typing the resource name: `--confirm=my-database`
- Show what will happen before doing it
- Log what was done so it can be undone

**Test:** "If the user made a typo in the target, how bad is the outcome?"
</principle>

<principle name="Progressive Disclosure">
**Rule:** Simple things stay simple. Complexity is available but not imposed.

**Why:** A CLI that requires 5 flags for basic operation has failed. Power users need advanced features, but they shouldn't be in the way of common workflows.

**Application:**
- The most common use case should require zero or one argument
- Advanced flags exist but aren't shown in short help (`-h` vs `--help`)
- Default verbosity is appropriate for the common case
- Config files handle complex persistent configuration; flags handle per-invocation overrides
- Subcommand help only shows relevant flags, not global ones

**Test:** "Can a new user accomplish the most common task in under 10 seconds?"
</principle>

<principle name="Empathy and Forgiveness">
**Rule:** Assume the user wants to succeed. Help them recover from mistakes.

**Why:** CLI interaction is conversational. Users type, make mistakes, adjust, retry. A tool that punishes errors with cryptic messages or silent failures is hostile.

**Application:**
- Suggest corrections: "Did you mean 'deploy'?"
- Show the closest valid option when input doesn't match
- Explain what went wrong AND how to fix it
- Don't print raw stack traces — translate exceptions to human language
- If the user is clearly confused, suggest `--help` or link to docs

**Test:** "If I make a typo, does the tool help me fix it or punish me?"
</principle>

<principle name="Respect the Environment">
**Rule:** Honor platform conventions, terminal capabilities, and user preferences.

**Why:** The terminal is shared infrastructure. A tool that ignores `NO_COLOR`, dumps 256-color output to a pipe, or creates `~/.mytool` instead of following XDG is a bad citizen.

**Application:**
- Check `NO_COLOR`, `FORCE_COLOR`, `TERM`, TTY status before using color
- Follow XDG Base Directory Specification for config/data/cache
- Respect `$EDITOR`, `$PAGER`, `$COLUMNS`
- Detect terminal width and adapt output accordingly
- Handle `SIGINT` gracefully — don't leave temp files or zombie processes

**Test:** "Does this tool play well with every other tool on the system?"
</principle>

</principles>

<precedence>
When principles conflict:

- **Safety vs. silence:** Safety wins. A destructive command should warn even if silence is the norm.
- **Composability vs. empathy:** In non-TTY mode, composability wins (no prompts, no color). In TTY mode, empathy wins (suggestions, color, interactive fallbacks).
- **Predictability vs. safe defaults:** If the convention is unsafe (e.g., `rm` with no confirmation), prefer safe defaults for new tools but document the deviation.
- **Progressive disclosure vs. predictability:** Don't hide flags that users expect to exist. Progressive disclosure applies to help text presentation, not to feature availability.
</precedence>

<anti_patterns>
- **Cleverness theater:** Inventing new conventions when standard ones exist ("--yolo" instead of "--force")
- **Silent failure:** Exiting 0 when something went wrong because "it's not really an error"
- **Chatty success:** Printing banners, ASCII art, log dumps, or motivational quotes on every successful run
- **Silent state changes:** Modifying remote state or data with zero confirmation output — user can't tell success from failure
- **Hostile errors:** "Error: invalid input" with no indication of what input or what's valid
- **Environment pollution:** Creating dotfiles in $HOME, setting global env vars, modifying shell config without asking
- **Forced interactivity:** Requiring prompts with no flag-based alternative, breaking CI/CD pipelines
- **Breaking composition:** Mixing data and status messages on stdout, outputting non-parseable formats
</anti_patterns>
