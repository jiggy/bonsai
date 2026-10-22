<overview>
Glyph system, status indicators, output patterns (file lists, search results, grouped violations, health checks, summaries), tables, trees, diffs, progress indicators, and JSON mode. These are the building blocks of CLI output — consistent use creates a coherent visual language across all commands.
</overview>

<glyph_system>

All status indicators use Unicode glyphs. Each glyph has a fixed color assignment and an ASCII fallback for terminals without Unicode support.

| Glyph | Name | Unicode | Color | Use | Fallback |
|-------|------|---------|-------|-----|----------|
| `✓` | check | U+2713 | `success` | Task completed, check passed | `+` |
| `✗` | ballot x | U+2717 | `error` | Error, failure | `x` |
| `△` | triangle outline | U+25B3 | `warning` | Warning, alert | `!` |
| `−` | minus sign | U+2212 | `dim` | Item removed, subtracted | `-` |
| `⊘` | circled div | U+2298 | `dim` | Item skipped, excluded | `o` |
| `–` | en-dash | U+2013 | `dim` | No changes, neutral | `-` |
| `i` | info | ASCII | `info` | Informational note, suggestion | `i` |
| `·` | middle dot | U+00B7 | `muted` | Separator in headers/summary | `.` |
| `→` | arrow | U+2192 | `muted` | Transition, "next step" | `->` |
| `─` | box horiz | U+2500 | `muted` | Horizontal line, divider | `-` |
| `├─` | tee | U+251C+2500 | `muted` | Tree branch (intermediate) | `\|-` |
| `└─` | corner | U+2514+2500 | `muted` | Tree branch (last) | `'-` |
| `│` | pipe | U+2502 | `muted` | Vertical tree line | `\|` |

**Design principles:**

- **Balanced visual weight:** All status glyphs (`✓`, `✗`, `△`, `i`) have similar visual weight. The eye distinguishes them by shape and color, not size or density.
- **Warning `△` (outline) instead of `▲` (solid):** The solid triangle dominates too much visual area. In output with many warnings (the most frequent severity), warning lines overshadowed errors, inverting the hierarchy.
- **Removed `−` (minus) instead of `✕` (multiply):** `✗` (U+2717) and `✕` (U+2715) are indistinguishable in most monospace fonts. The minus sign is visually distinct, semantically clear (something was subtracted), and in `dim` doesn't compete with error `✗` in `red`.
- **Info `i` (ASCII) instead of `●` (bullet):** Lighter, more readable, unambiguous. The bullet has the same weight as other status glyphs but semantically should be the most discreet.

**Strict rules:**
- Never use emoji (🎉 ❌ ✅). Never use text prefixes `[ERROR]`, `[WARN]`, `[INFO]` in color mode.
- Each state has a unique, unmistakable glyph. Do not reuse glyphs for different meanings.
- Each glyph has a fixed color. Do not change colors based on context.

</glyph_system>

<file_list>

Files aligned with metadata right-justified. Name width padded to a constant size.

```
✓ how-it-works.md                                    13 chunks
✓ installation.md                                     9 chunks
– config.md                                          18 chunks
⊘ legacy/old-guide.md                                 — excluded
✗ broken-doc.md                                       parse error
```

| Glyph | Color | Status |
|-------|-------|--------|
| `✓` | `success` | Processed, new or modified |
| `–` | `dim` | Unchanged, skipped |
| `⊘` | `dim` | Excluded by filter |
| `✗` | `error` | Processing error |
| `−` | `dim` | Removed |

**Wrong — metadata not aligned:**
```
✓ how-it-works.md 13 chunks
✓ installation.md 9 chunks
– config.md 18 chunks
```

**Wrong — using emoji instead of glyphs:**
```
✅ how-it-works.md                                    13 chunks
➖ config.md                                          18 chunks
```

</file_list>

<search_results>

Each result is a 2-3 line block. The **item name leads the line**; metadata floats right in dim. The snippet/detail is indented below.

```
how-it-works.md                              3.43 · AND · high
  Section > Subsection
  ...snippet with matched terms in bold...

config.md                                    1.21 · OR · medium
  Settings > Defaults
  ...another snippet with matched terms...
```

Principle: the name is what the user is looking for; score and metadata are secondary.

**Wrong — metadata inline instead of right-aligned:**
```
how-it-works.md 3.43 AND high
  Section > Subsection
  ...snippet with matched terms in bold...
```

**Wrong — emoji instead of structure, no alignment:**
```
📄 how-it-works.md (score: 3.43, mode: AND, relevance: high)
  ...snippet with matched terms in bold...
```

</search_results>

<grouped_violations>

Items grouped by file/category with tree drawing. The code+name column is padded to a **fixed width** so messages always start at the same column.

```
how-it-works.md (score: 70/100)
  ├─ △ R003 missing-tags       No tags in frontmatter
  ├─ △ R007 generic-heading    Consider a more specific heading
  └─ i R009 oversized          Section is 4,809 chars (max 4,000)

config.md (score: 51/100)
  ├─ △ R003 missing-tags       No tags in frontmatter
  └─ ✗ R010 tiny-section       Section has < 20 chars of content
```

**Alignment:** The `code + name` column is padded to a fixed width. Without this, the message starts at different positions per line and vertical scanning breaks.

**Wrong — messages not aligned (no padding on code column):**
```
how-it-works.md (score: 70/100)
  ├─ △ R003 missing-tags No tags in frontmatter
  ├─ △ R007 generic-heading Consider a more specific heading
  └─ i R009 oversized Section is 4,809 chars (max 4,000)
```

</grouped_violations>

<health_checks>

Sequence of checks with pass/fail. Errors always include a fix suggestion.

```
✓ mytool 1.4.0
✓ Config: ./config.json
✓ Database: 3 items, 40 entries
✓ Plugins installed: 3
  ├─ auth
  ├─ cache
  └─ logger

✗ Cache not found at ./cache.db. Run mytool sync
```

**Wrong — flat indented list without tree chars:**
```
✓ Plugins installed: 3
    auth
    cache
    logger
```

**Wrong — error without fix suggestion:**
```
✗ Cache not found
```

</health_checks>

<compact_summary>

For audit/lint output with score and rules:

```
Score: 63/100
──────────────────────────────────────────────────────────
△ Make title more specific (R005)        1 file   +18%
△ Add tags to config (R003)             3 files   +12%
✗ Expand tiny sections (R010)            1 file    +1%
i Split oversized items (R009)           1 file
──────────────────────────────────────────────────────────
1 errors · 4 warnings · 2 suggestions
```

**Wrong — zero counters shown, no divider, no alignment:**
```
Score: 63/100
△ Make title more specific (R005) 1 file +18%
△ Add tags to config (R003) 3 files +12%
✗ Expand tiny sections (R010) 1 file +1%
i Split oversized items (R009) 1 file
1 errors · 4 warnings · 2 suggestions · 0 info
```

**Wrong — emoji instead of glyphs:**
```
Score: 63/100
⚠️ Make title more specific (R005)        1 file   +18%
❌ Expand tiny sections (R010)             1 file    +1%
```

</compact_summary>

<list_truncation>

**Long lists:** When a list exceeds a reasonable display length, truncate and indicate the remainder.

**Rules:**
- Show at most **20 items** by default in interactive mode
- After the last visible item, show: `  … and 47 more` (in `dim`)
- Provide a flag to show all: `--all` or `--limit 0`
- In `--json` mode, always include all items (no truncation)
- For grouped items (e.g., files per directory), truncate per group

```
✓ Installed 23 plugins
  ├─ auth
  ├─ cache
  ├─ logger
  ├─ metrics
  ├─ router
  … and 18 more (use --all to show)
```

</list_truncation>

<tables>

**Structure:**
```
NAME          STATUS    REPLICAS   AGE
web-service   Running          3   2h
worker        Stopped          0   5d
database      Running          1   30d
```

**Rules:**
- Headers in `muted` — visually present but subordinate to data
- Minimum 2 spaces between columns
- Left-align text, right-align numbers
- Truncate long cells with ellipsis: `web-service-production-…`
- Sort by most useful column (usually name or status, not arbitrary)
- No box-drawing borders — use whitespace or `─` dividers only

**When stdout is piped:** Suppress headers, or provide `--no-headers` flag. Headers are for human scanning; they add noise in `grep`/`awk` pipelines.

**Output format flags:**
- Default: Human-readable table (TTY only)
- `--plain`: Tab-separated, no headers, no alignment (greppable)
- `--json`: Full structured data
- `--csv`: Comma-separated with headers
- `--columns name,status`: Select which columns to display
- `--no-headers`: Suppress header row
- `--sort-by age`: Control sort column

**Responsive behavior:**
- Detect terminal width
- Show essential columns first, hide supplementary ones in narrow terminals
- Truncate values rather than wrapping (wrapping breaks column alignment)
- In non-TTY mode: no truncation, no alignment padding (let consumer handle it)

**Empty state:**
```
No resources found.

Create one with: tool create <name>
```
Never print just headers with no rows and no explanation.

</tables>

<trees>

**Unicode box-drawing tree** — always use tree chars for parent-child relationships:
```
src/
├── index.ts
├── lib/
│   ├── parser.ts
│   └── utils.ts
└── tests/
    └── parser.test.ts
```

**Characters (all in `muted`):**
- `├─ ` — sibling branch (has more siblings below)
- `└─ ` — last sibling branch
- `│  ` — continuation line (parent has more children)
- `   ` — no continuation (parent's last child)

**ASCII fallback (for `TERM=dumb` or `--plain`):**
```
|-- index.ts
|-- lib/
|   |-- parser.ts
|   `-- utils.ts
`-- tests/
    `-- parser.test.ts
```

**Rules:**
- Indent by 2 characters per level (detail level)
- Never use flat indented lists without tree chars
- Support `--depth N` to limit nesting
- For large trees, show item count per directory: `lib/ (42 files)`

</trees>

<diffs>

**Unified diff format (standard):**
```
--- a/config.yaml
+++ b/config.yaml
@@ -3,7 +3,7 @@
 name: my-app
 region: us-east-1
-replicas: 1
+replicas: 3
 image: app:v2.0
```

**Color mapping:**
- Red (`31`): Removed lines (`-`)
- Green (`32`): Added lines (`+`)
- Cyan (`36`): Line numbers, chunk headers (`@@`)
- Normal: Context lines (unchanged)
- Bold: File paths in headers

**Inline transition format** (for simple value changes):
```
△ Value was false → true
```

Use `→` (U+2192) for transitions, never `=>` nor `->`.

</diffs>

<progress_indicators>

**When to show progress:** For operations processing collections or doing network I/O — not based on time threshold, but on operation type. A 2-second network call needs a spinner; a 2-second local computation may not.

**Spinner** (indeterminate, sequential):
```
⠋ Deploying to production...
```

**Counter** (measurable steps):
```
Ingesting ━━━━━━━━━━━━━━━━━━━━ 100% 42/42 documents
```

**Rules:**
- Progress goes to stderr, never stdout
- No animation when not a TTY — use line-by-line static output
- Switch tense on completion: "Deploying..." → "Deployed 3 resources"
- Use `✓` / `✗` to mark completion/failure after the progress line

</progress_indicators>

<json_mode>

All commands that produce data support `--json`:

- **Compact JSON by default** — no indentation, one object per line for streaming
- **Pretty-print only when stdout is a TTY** or via explicit `--json --pretty` flag
- No ANSI codes, no glyphs — pure structured data
- Exit codes remain the same (e.g., audit exits 1 if there are errors)
- Errors under `--json` must also be JSON (not styled human messages):

```json
{"error": "Database not found", "code": "ENOENT", "path": "/missing/db"}
```

**Rationale for compact default:** `--json` output is consumed by `jq`, scripts, and pipelines. Compact is more efficient and `jq .` pretty-prints when humans need it. Pretty-printing by default wastes bytes and breaks line-oriented processing (`tool list --json | while read line`).

</json_mode>

<dividers>

**Light divider** (`─` in `muted`, spans content width):
```
──────────────────────────────────────────────────────────
```

Use dividers sparingly — only in summary/audit patterns where they frame a data section. Prefer whitespace for general section separation.

**ASCII fallback:** `---`

</dividers>

<anti_patterns>
- **Tables without empty state:** Showing headers with zero rows and no explanation
- **Box-drawing borders:** Wrapping sections in boxes dilutes emphasis — use whitespace
- **Inconsistent tree characters:** Mixing `├` with `|--` or inconsistent indentation
- **Flat indented lists:** Always use tree chars for parent-child relationships
- **Diffs without color fallback:** Relying only on red/green to indicate added/removed
- **Non-aligned metadata columns:** Values starting at different columns per line
- **Unicode without ASCII fallback:** Breaking on `TERM=dumb` or non-UTF-8 locales
- **Fixed-width tables:** Not adapting to terminal width
- **Decorative ASCII art:** Banners, logos, and art that add no information value
- **Pretty JSON by default:** `--json` should be compact; pretty-print via flag or TTY detection
- **Headers in piped table output:** Suppress headers when stdout is not a TTY
- **Showing all items in long lists:** Truncate at ~20, offer `--all`
- **Heavy/solid glyphs:** `▲` (solid) instead of `△` (outline), `●` instead of `i` — balance visual weight
- **Indistinguishable glyphs:** `✗` (U+2717) and `✕` (U+2715) look identical in monospace
- **`=>` or `->` for transitions:** Use `→` (U+2192) consistently
</anti_patterns>
