<overview>
Color palette, text hierarchy, glyph-color assignments, TTY/NO_COLOR handling, and accessibility fallbacks. Color appears only when it requires the user's attention — the eye scans colored glyphs and alert states; everything else stays neutral.
</overview>

<fundamental_rule>
**Never use color as the only means of conveying information.** Always pair color with glyphs, text labels, or structural cues. A user with `NO_COLOR`, a monochrome terminal, or a screen reader must receive the same information.
</fundamental_rule>

<color_palette>

Use ANSI basic (16 colors) as the portable baseline. If the environment supports truecolor, the hex values are the visual target.

**Semantic colors:**

| Token | Hex | ANSI | Code | Use |
|-------|-----|------|------|-----|
| `brand` | `#58d5ba` | Cyan | 36 | Tool name in headers, commands inline, command suggestions |
| `success` | `#3fb950` | Green | 32 | Glyph `✓`, positive states |
| `warning` | `#d29922` | Yellow | 33 | Glyph `△`, alert states |
| `error` | `#f85149` | Red | 31 | Glyph `✗`, critical states |
| `info` | `#58a6ff` | Blue | 34 | Glyph `i`, informational notes |

**Text hierarchy:**

| Token | Hex | ANSI | Code | Use |
|-------|-----|------|------|-----|
| `text` | `#e6edf3` | White | 37 | Primary text: names, important values |
| `dim` | `#8b949e` | Dim | 2 | Secondary text: paths, counters, post-glyph messages |
| `muted` | `#484f58` | Gray | 90 | Tertiary text: separators, tree chars, arrows, table headers |

**Three levels, no more.** The hierarchy `text` > `dim` > `muted` is sufficient. Do not introduce intermediate colors or brightness variations. Clarity comes from restraint.

- `dim` (`\x1b[2m`) attenuates the base text color — it is relative
- `muted` (`\x1b[90m`) is a fixed gray — it is absolute
- They are distinct levels and not interchangeable

**Principle:** Color only appears when it requires user attention. The eye scans colored glyphs and alert states; everything else stays neutral. Use 1-2 accent colors with dim variations rather than a rainbow. Reserve yellow and red exclusively for warnings and errors.

</color_palette>

<command_color>

**Commands render entirely in brand color.** The prompt `$` renders in `muted`.

```
$  →  muted
mytool run --verbose  →  all brand color
```

Do not color the binary, subcommand, flags, or arguments separately. One color, clean and scannable. Within text messages (fix suggestions, next steps), apply the same rule:

```
Next → mytool doctor
       ^^^^^^^^^^^^^
       brand color, the rest dim
```

</command_color>

<color_standards>

<standard name="NO_COLOR">
**Source:** no-color.org
**Rule:** When `NO_COLOR` environment variable is set and non-empty (regardless of value), do not emit ANSI color escape codes.
**Scope:** Color only — bold, underline, italic, dim are still permitted.
**Override:** User-level config and explicit `--color=always` flag may override NO_COLOR.
**Adoption:** Hundreds of tools (git, ripgrep, bat, fd, jq, gh, cargo, etc.)
</standard>

<standard name="FORCE_COLOR">
**Source:** force-color.org
**Rule:** When `FORCE_COLOR` is set and non-empty, force color output regardless of TTY detection.
**Values:** Optionally indicate depth: `0` = no color, `1` = 16 colors, `2` = 256 colors, `3` = 16M colors.
**Priority:** FORCE_COLOR overrides NO_COLOR.
**Adoption:** Node.js, chalk, pytest, Jest, Deno, rich, and 30+ others.
</standard>

<standard name="CLICOLOR">
**Source:** bixense.com/clicolors
**Rule:** `CLICOLOR=1` enables color when output is a TTY. `CLICOLOR_FORCE=1` forces color even in non-TTY.
**Status:** Older convention, less universally adopted. Support if your ecosystem uses it.
</standard>

</color_standards>

<color_decision_tree>

**All five disable mechanisms must be supported. Missing any is a FAIL.**

**Disable color when ANY of these is true:**
1. `NO_COLOR` is set and non-empty
2. `TERM=dumb`
3. The output stream (stdout or stderr) is not a TTY
4. `--no-color` flag is passed
5. Tool-specific env var disables it (e.g., `MYTOOL_NO_COLOR`)

**Force color when ANY of these is true (overrides above):**
1. `FORCE_COLOR` is set and non-empty
2. `--color=always` flag is passed

**Check each stream independently.** stdout may be piped while stderr goes to the terminal. Color stderr but not stdout in that case.

**Pseudocode:**
```
if flag == "--color=always" or FORCE_COLOR:
    use_color = true
elif flag == "--no-color" or NO_COLOR or TERM == "dumb":
    use_color = false
else:
    use_color = isatty(stream)
```

**Python reference implementation:**
```python
import os, sys

def use_color(stream=sys.stderr) -> bool:
    if os.environ.get("FORCE_COLOR", ""):
        return True
    if os.environ.get("NO_COLOR", ""):
        return False
    if os.environ.get("TERM") == "dumb":
        return False
    return stream.isatty()
```

</color_decision_tree>

<color_levels>

| Level | Colors | Detection | Recommendation |
|-------|--------|-----------|----------------|
| 4-bit | 16 (standard ANSI) | `TERM` contains "color" | **Use this as your base palette** |
| 8-bit | 256 | `TERM` contains "256color" | Optional enhancement |
| 24-bit (truecolor) | 16.7M | `COLORTERM=truecolor` or `COLORTERM=24bit` | Target visual if supported, always fall back to 4-bit |

**Why 4-bit (16 colors) as baseline:**
- Users customize these 16 colors in their terminal preferences
- A tool using 4-bit colors automatically matches the user's theme (light or dark)
- 24-bit hardcoded colors may be invisible on some backgrounds
- The gh CLI standardized on 4-bit colors for this reason
- Compatible with every terminal emulator

</color_levels>

<accessibility>

**Screen reader compatibility:**
- Screen readers read text content, not color. Ensure meaning is conveyed through words and symbols.
- Avoid animated spinners — they generate continuous text-to-speech output. Use static progress messages.
- Use blank lines between sections (screen readers use them as navigation anchors).

**Contrast requirements:**
- Test output against both light and dark terminal backgrounds
- 4-bit colors adapt to user themes; 8-bit and 24-bit may not
- Avoid low-contrast combinations: yellow on white, blue on black (depends on theme)

**Cognitive accessibility:**
- Consistent color meanings across all commands (red always means error)
- Three text levels maximum — more creates cognitive load
- Don't use color for categorization beyond 5 categories

</accessibility>

<implementation_notes>

**Color reset:** Always emit reset code (`\033[0m` / `\e[0m`) after colored text. Unclosed color sequences leak into subsequent terminal output.

**Nested attributes:** Bold + color is fine. Avoid stacking more than 2 attributes (bold + dim + underline + color = hard to read).

**Testing checklist:**
```bash
NO_COLOR=1 tool command              # No ANSI codes
TERM=dumb tool command               # No ANSI codes
tool command | cat -v                 # No ^[[ sequences in piped output
tool command --no-color               # Flag exists and disables color
FORCE_COLOR=1 tool command | cat -v  # ANSI codes present even in pipe
```

</implementation_notes>

<auditing_color_usage>

**How to verify color compliance from terminal output:**

Capture raw ANSI output for inspection:
```bash
tool command 2>&1 | cat -v
```

This reveals ANSI escape codes as readable text (e.g., `^[[31m` for red).

**Check each color code against the palette:**

| ANSI code | Color | Should only appear with |
|-----------|-------|------------------------|
| `^[[32m` | Green (success) | `✓` glyph |
| `^[[31m` | Red (error) | `✗` glyph |
| `^[[33m` | Yellow (warning) | `△` glyph |
| `^[[34m` | Blue (info) | `i` marker |
| `^[[36m` | Cyan (brand) | Tool name in header, command suggestions |
| `^[[2m` | Dim | Secondary text (paths, counters, metadata) |
| `^[[90m` | Gray (muted) | Separators, tree chars, arrows, table headers |

**Red flags:**
- Yellow used for anything other than warnings
- Red used for emphasis that isn't an error
- Cyan used for text that isn't a command reference or brand name
- Multiple colors in the same command suggestion (should be one brand color)
- Color without accompanying glyph (violates "color never sole indicator")
- `^[[1m` (bold) used in body text (bold is for headers and summary only)

</auditing_color_usage>

<anti_patterns>
- **Color as only signal:** Red text with no glyph or label
- **Hardcoded 24-bit without fallback:** `#FF0000` without ANSI 31 fallback
- **Color in pipes by default:** ANSI codes in piped output break downstream tools
- **Ignoring NO_COLOR or TERM=dumb:** Forcing color when the user explicitly disabled it
- **Rainbow output:** Too many colors dilute meaning — reserve strong colors for important states
- **Yellow for non-warnings:** Using yellow for "info" or "highlight" when it means "warning" everywhere else
- **Unclosed color sequences:** Forgetting `\033[0m` leaves the entire terminal colored
- **Animated spinners without fallback:** Breaking screen readers and `TERM=dumb` terminals
- **Emoji or text prefixes in color mode:** Never use emoji (🎉 ❌ ✅). Never use `[ERROR]`, `[WARN]`, `[INFO]` prefixes — glyphs serve this purpose
- **Multiple colors for command parts:** Coloring binary, subcommand, flags separately — one brand color for the entire command
- **Bright/saturated body text:** Dim and muted dominate; bright colors reserved for glyphs only
</anti_patterns>
