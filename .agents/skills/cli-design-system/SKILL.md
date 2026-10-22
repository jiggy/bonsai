---
name: cli-design-system
description: >-
  CLI design standards for commands, flags, args, exit codes, I/O, config,
  help text, errors, progress, interactivity, color, typography, components,
  and documentation. Use when designing new CLIs, implementing commands,
  writing help text, formatting terminal output, choosing flags, documenting
  a CLI, reviewing CLI standards, unifying output patterns, writing error
  messages, defining color systems, or choosing exit codes. Use as reference
  when planning CLI improvements, reviewing copy and tone, or redesigning
  command output layout.
---

<description>

Pure design knowledge for command-line interfaces, organized into four layers.

**The Four-Layer Model**

Every CLI decision falls into one of four layers, ordered by risk of change (highest first):

1. **Contract** — The programmatic interface. Commands, flags, arguments, exit codes, I/O streams, configuration. Breaking contract changes break scripts and automation.
2. **UX** — The human experience. Help system, error messages, progress feedback, interactivity, discoverability, copy style. These make a CLI learnable, forgiving, and efficient.
3. **UI** — The visual presentation. Color, typography, spacing, terminal components. These make output scannable and pleasant without affecting behavior.
4. **Docs** — The documentation. README, man pages, changelogs, migration guides. These bridge the tool and its users.

Contract > UX > UI > Docs in terms of breaking-change severity.

</description>

<principles>

Eight universal principles apply across all layers (full definitions in `references/principles.md`):

1. Predictability over cleverness
2. Safe defaults
3. Minimal confirmation on success
4. Composability
5. Reversibility
6. Progressive disclosure
7. Empathy and forgiveness
8. Respect the environment

</principles>

<standards_hierarchy>

When conventions conflict, follow this precedence:
1. POSIX Utility Conventions (baseline)
2. GNU Coding Standards (extends POSIX)
3. clig.dev / modern consensus (extends GNU)
4. Domain conventions (e.g., cloud CLIs, package managers)

</standards_hierarchy>

<reference_index>

**Foundations**
- `references/principles.md` — Eight universal design principles with application guidance and precedence rules

**Contract Layer**
- `references/contract/command-structure.md` — Command naming, subcommand hierarchies, grammar patterns, standard verbs
- `references/contract/flags.md` — Short/long flags, boolean/value/repeatable types, standard names, deprecation
- `references/contract/arguments.md` — Positional args, ordering, stdin handling, `--` delimiter
- `references/contract/exit-codes-and-signals.md` — Exit codes, signal handling, cleanup patterns
- `references/contract/io-streams.md` — stdout/stderr separation, output formats, piping, TTY detection
- `references/contract/configuration-hierarchy.md` — Config files, env vars, XDG paths, precedence order

**UX Layer**
- `references/ux/help-system.md` — Help text structure, usage strings, examples, flag descriptions, reference output
- `references/ux/error-messages.md` — Error structure, actionability, did-you-mean, common error templates, JSON errors
- `references/ux/copy-style.md` — Voice, tone, wording, vocabulary, tense, punctuation, copy patterns
- `references/ux/progress-and-feedback.md` — Spinners, progress bars, verbosity levels, non-TTY behavior
- `references/ux/interactivity.md` — TTY detection, prompts, confirmations, dry-run interaction, non-interactive mode
- `references/ux/discoverability.md` — Shell completions, contextual suggestions, onboarding, command discovery

**UI Layer**
- `references/ui/color-system.md` — Semantic palette, NO_COLOR/FORCE_COLOR, accessibility, auditing color usage
- `references/ui/typography-and-spacing.md` — Output anatomy, text hierarchy, alignment, width, cross-command consistency
- `references/ui/terminal-components.md` — Glyphs, tables, trees, diffs, file lists, search results, JSON mode

**Docs Layer**
- `references/docs/cli-documentation.md` — README structure, command docs, flag docs, exit codes, changelogs, accuracy

</reference_index>

<scope>
This skill provides design knowledge. It does not execute audits, plans, or implementations — those are separate skills/commands that consume this knowledge.
</scope>
