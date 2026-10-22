# Copy Style Guide

Rules for all human-facing text in CLI output: messages, errors, help, progress, and confirmations.

## Voice

The CLI voice is **competent, direct, and calm**.

| Trait | Means | Does NOT mean |
|-------|-------|---------------|
| Competent | Knows what happened, gives specific details | Verbose, over-explains, hedges |
| Direct | Leads with what matters, uses active voice | Terse to the point of being cryptic |
| Calm | Neutral tone even on errors, no drama | Cold, robotic, dismissive |

## Tone by context

| Context | Tone | Example |
|---------|------|---------|
| Success | Factual, brief | `Ingested 42 files` |
| Error | Helpful, specific | `Can't open config.yaml: permission denied` |
| Warning | Advisory | `3 files skipped (no frontmatter)` |
| Destructive confirmation | Serious, specific | `Delete 12 documents from the index?` |
| Progress | Neutral | `Indexing 42 files...` |
| Help text | Instructional | `Search the knowledge base` |

## Wording rules

- **Sentence case everywhere.** Never Title Case, never UPPERCASE in messages (UPPERCASE only in help section headings like USAGE, OPTIONS).
- **No period at end of single-line messages.** Multi-line messages: period on all lines or none.
- **Use contractions.** `can't` not `cannot`, `don't` not `do not`, `isn't` not `is not`.
- **Active voice always.** `Can't write to X` not `X could not be written to`.
- **Start with what matters.** `Database not found` not `There was an error finding the database`.
- **Name things specifically.** `Invalid port: '99999'` not `Invalid port value`.

## Tense

| State | Tense | Example |
|-------|-------|---------|
| In progress | Gerund (-ing) | `Ingesting 42 files...` |
| Completed | Past tense | `Ingested 42 files` |
| Dry-run preview | Future (`would`) | `Would deploy 3 resources` |
| Error (current state) | Present | `Database doesn't exist` |

## Preferred vocabulary

Use the simpler word:

| Prefer | Avoid |
|--------|-------|
| can't | cannot |
| run | execute |
| set | configure |
| check | verify, validate |
| need | require |
| use | utilize |
| try | attempt |
| show | display, render |
| start | initialize, bootstrap |
| stop | terminate, halt |
| remove | delete, destroy, purge |
| fix | resolve, remediate |

## Words to avoid entirely

Never use these in any context:

- **please** — the CLI is not asking a favor
- **sorry** — the CLI is not apologizing
- **successfully** — if it succeeded, just say what happened
- **oops** — unprofessional
- **fatal** — jargon; use "error" for errors
- **abort** — use "stop" or "cancel"
- **kill**, **nuke**, **destroy** — use "stop", "remove", "delete"
- **obviously**, **simply**, **just** — if it were obvious, the user wouldn't be reading the message
- **invalid** (alone) — always say what's invalid and why: `Invalid port: '99999' (must be 1-65535)`

## Punctuation

| Symbol | Use | Example |
|--------|-----|---------|
| `·` (middle dot, U+00B7) | Summary separators | `42 files · 3 errors · 120 chunks` |
| `→` (arrow, U+2192) | Transitions, next steps | `Next → kenso lint --detail` |
| `:` (colon) | Key-value pairs, error specifics | `Error: database not found` |
| No semicolons | Never in messages | — |
| No ellipsis in static messages | Only in progress/loading | `Indexing...` is ok; `No results found...` is not |
| No exclamation marks | Never, not even on success | — |

## Message length

| Type | Target | Max |
|------|--------|-----|
| Success confirmation | 1 line | 1 line |
| Error (full) | 2-3 lines | 5 lines |
| Summary | 1 line | 1 line |
| Flag description | Under 60 chars | 80 chars |
| Warning | 1 line | 2 lines |
| Progress | 1 line | 1 line |

## Error tone

**Calm doctor, not panicking nurse.**

Errors should diagnose and prescribe. State what's wrong specifically, then state how to fix it.

```
# Good — specific, calm, prescriptive
Error: database not found at ./kenso.db
Run `kenso ingest ./docs` to create it.

# Bad — vague, alarming
FATAL ERROR: Operation failed! Database error occurred.
Please check your configuration and try again.

# Bad — apologetic
Sorry, we couldn't find the database.
Please make sure the path is correct.

# Bad — blames user
You provided an invalid database path.
```

## Anti-patterns

| Pattern | Problem | Fix |
|---------|---------|-----|
| **Robotic** — `Operation completed. 0 errors encountered.` | Reads like a log file | `Ingested 42 files` |
| **Apologetic** — `Sorry, we couldn't find...` | CLI isn't a person | `Can't find config.yaml` |
| **Marketing** — `Successfully deployed your amazing app!` | Not a landing page | `Deployed 3 services` |
| **Log-style** — `[INFO] 2024-01-15T10:30:00 Processing...` | Not a log file | `Processing 42 files...` |
| **Passive voice** — `The file was not found` | Indirect, wordy | `File not found: config.yaml` |
| **Over-explaining** — `This error occurs because the system was unable to locate...` | Get to the point | `Can't find config.yaml` |
| **Filler words** — `In order to proceed, you will need to...` | Noise | `Run kenso init first` |
