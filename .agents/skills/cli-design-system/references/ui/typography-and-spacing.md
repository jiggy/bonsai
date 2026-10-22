<overview>
Output anatomy, text hierarchy, alignment, width behavior, whitespace conventions, and formatting rules. Every output follows a defined structure: header → body → detail → summary → next step. Only the header is mandatory; the rest appears as context requires.
</overview>

<output_anatomy>

Every CLI output follows this structure in order:

**4.1 Header** — Always the first line. Brand name in bold + separator `·` in muted + context in dim.

```
mytool · processing 3 files
^^^^^^   ^
brand    muted(·)
(bold)
```

Operational metadata (non-default paths, active flags) goes as a detail line below:
```
mytool · processing 3 files
  db: /tmp/custom.db                     ← dim, only when non-default
```

**When stdout is piped:** Suppress the header entirely, or send it to stderr. The header is for human orientation, not data. Piped consumers don't need it.

**4.2 Body** — No extra indentation. Each line starts with a colored glyph followed by its message.

```
✓ Config created (path: ./config.json)
△ Value was false → true
✗ Directory not found: nonexistent/
i Run mytool doctor for diagnostics
```

**Color of message text:** After the glyph, text is `dim` except when it contains a highlighted name (which goes in `text` white) or an alert state (which goes in its semantic color).

**4.3 Detail** — Indented 2 spaces. Sub-items under a status line **always use tree chars** (`├─`, `└─`) in `muted` to establish the parent-child relationship.

```
✓ Installed 3 plugins
  ├─ auth
  ├─ cache
  └─ logger
```

Never use flat indented lists without tree chars — the parent-child relationship must be visually explicit.

**4.4 Summary** — Single line, compact, with counters. Separated by `·`. In bold. **Counters at zero are omitted.**

```
5 files · 3 processed · 2 skipped        ← (0 errors omitted)
5 files · 5 unchanged                    ← (0 processed, 0 errors omitted)
```

Issue counters are colored semantically:
```
1 errors · 4 warnings · 2 suggestions
^^^^^^^^    ^^^^^^^^^
error       warning
```

**4.5 Next step** — Only when there's a clear action the user should take.

```
Next → mytool fix --all
       ^^^^^^^^^^^^^^^^
       brand color
```

**Section separation:** Exactly 1 blank line between distinct sections (header/body, body/summary). Never 2+ consecutive blank lines.

</output_anatomy>

<text_hierarchy>

**Three levels, no more:**

| Level | Token | Attribute | Use for |
|-------|-------|-----------|---------|
| Primary | `text` | White (37) | Names, important values, highlighted terms |
| Secondary | `dim` | Dim (2) | Paths, counters, post-glyph messages, metadata |
| Tertiary | `muted` | Gray (90) | Separators, tree chars, arrows, table headers |

**Additional emphasis:**
- **Bold** for the brand name in headers and summary line
- **Bold + semantic color** for glyphs only (status indicators)

**Rules:**
- Use at most 3 text levels in a single output block
- Bold for what the user should read first (brand name, summary)
- Dim for what they can scan quickly (most body text)
- Muted for structural elements (tree chars, separators)
- Consistent across all commands

</text_hierarchy>

<alignment>

**Column alignment rules:**
- Left-align text columns
- Right-align numeric columns and metadata (for easy comparison)
- Metadata/code columns padded to fixed width for vertical alignment
- Minimum 2 spaces between columns

**File list alignment** — filenames padded to constant width, metadata right-aligned:
```
✓ how-it-works.md                                    13 chunks
✓ installation.md                                     9 chunks
– config.md                                          18 chunks
```

**Grouped violations alignment** — code+name column padded to fixed width so messages always start at the same column:
```
how-it-works.md (score: 70/100)
  ├─ △ R003 missing-tags       No tags in frontmatter
  ├─ △ R007 generic-heading    Consider a more specific heading
  └─ i R009 oversized          Section is 4,809 chars (max 4,000)
```

**Indentation standard:**
- 0 for body lines
- 2 spaces for detail/tree
- Never tabs in output (width varies by terminal)

</alignment>

<output_width>

**Width detection and limits:**
- Read terminal width from `$COLUMNS` environment variable
- Fallback: query via `tput cols` or language-specific API
- Default when non-TTY or undetectable: **80 columns**
- Minimum supported width: 40 characters

**Truncation vs wrapping:**
- **Table cells:** Truncate with ellipsis (`web-service-prod…`) — never wrap (breaks column alignment)
- **File paths and names:** Truncate from the left or middle: `…/deep/nested/file.md`
- **Help text:** Wrap at terminal width with proper continuation indentation
- **Error messages:** Wrap at terminal width
- **JSON/structured output:** Never truncate, never wrap (consumer handles it)
- **Piped output (non-TTY):** No truncation, no alignment padding — let the consumer handle it

**Responsive behavior:**

| Width | Adaptation |
|-------|-----------|
| 120+ chars | Full output, extra metadata columns |
| 80-119 chars | Standard output, all essential columns |
| 60-79 chars | Condensed: fewer columns, shorter labels |
| 40-59 chars | Minimal: one-column layout, heavy truncation |
| < 40 chars | Degrade gracefully, no tables |

</output_width>

<whitespace_conventions>

**Vertical spacing:**
- 1 blank line between sections (header/body, body/summary)
- No blank line between items in a list or body lines
- Never 2+ consecutive blank lines
- End all output with a single newline (UNIX convention)
- Never end with a blank line (extra newline)

**Horizontal spacing:**
- 2+ spaces between table columns
- Consistent indentation within nested output (2 spaces)
- No trailing whitespace on any line
- Single space after glyphs/markers

</whitespace_conventions>

<formatting_rules>

| Rule | Specification |
|------|---------------|
| Indentation | 0 for body, 2 for detail/tree. Never tabs. |
| Header | Brand name bold + `·` muted + context dim. Always present. Suppressed or sent to stderr when piped. |
| Metadata | As detail line (indent 2, dim), not inline in the header. |
| Blank lines | 1 between sections. Never 2+ consecutive. |
| Transitions | Use `→` (U+2192), never `=>` nor `->`. |
| Sub-items | Always with tree chars (`├─`/`└─`), never flat indented list. |
| Errors | Always suggest fix or next command. Never just "failed". |
| Summary | Bold, compact: `N thing · N thing`. Omit counters at zero. |
| Sentence case | Everything in sentence case, never Title Case nor UPPERCASE (except help section headings). |
| Commands | Always in brand color as a whole, no coloring parts separately. |
| Emoji | Prohibited. Only Unicode glyphs from the glyph table. |
| Saturated text | No bright colors in body. Dim and muted dominate. |
| Columns | Metadata/code padded to fixed width for vertical alignment. |

</formatting_rules>

<cross_command_consistency>

**Same output type = same visual pattern, always.**

If two commands produce file lists, they must look identical in structure. If two commands produce error messages for "resource not found", they must follow the same template. Consistency is not per-command — it's per-pattern.

**Checklist:**
- All headers use the same format: `brand · context` (not some with headers and some without)
- All summary lines use the same separator (`·`) and omit zeros
- All next-step suggestions use the same format: `Next → command`
- All file lists use the same alignment, same glyphs, same metadata position
- All error messages follow the same structure (what → why → fix)
- All health checks use the same check/fail format

**How to verify:** Run every command in its success path and lay the outputs side by side. Visual inconsistencies should jump out. If `ingest` uses a header and `stats` doesn't, that's a consistency violation even if both are individually correct.

**Shared output infrastructure is the enforcement mechanism for consistency.** When a CLI has shared helpers (`header()`, `summary()`, `error()`), every command must use them. A command that builds its own header string will eventually diverge — it won't pick up fixes, new features, or TTY-awareness changes made to the shared helper. If a command needs behavior the shared helper doesn't support, extend the helper — don't fork it. One code path for each output pattern guarantees consistency without auditing.

</cross_command_consistency>

<anti_patterns>
- **Tabs in output:** Tab width varies by terminal (4, 8, or other); use spaces
- **No terminal width detection:** Tables that overflow or truncate incorrectly
- **Inconsistent indentation:** Mixing indentation levels in the same output
- **Trailing whitespace:** Invisible but causes diff noise
- **No newline at end of output:** Some tools (wc, grep) will miss the last line
- **Dense walls of text:** No whitespace between sections, impossible to scan
- **Box borders:** Don't use box-drawing for enclosures — use whitespace and dividers
- **`=>` or `->` for arrows:** Use `→` (U+2192) consistently
- **UPPERCASE for emphasis:** Use bold or semantic color instead
- **Title Case in messages:** Everything sentence case
- **Multiple consecutive blank lines:** One is enough
- **Flat indented lists:** Always use tree chars for parent-child relationships
- **Showing zero counters in summary:** `0 errors` clutters — omit it
- **Left-aligned numbers:** Columns of numbers that don't line up by digit position
- **Headers in piped output:** Suppress or redirect to stderr when stdout is piped
</anti_patterns>
