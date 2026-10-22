# Check UX review

Scope: `bonsai check` in pass, rejected, incomplete, verbose, quiet, plain, and JSON modes. The supplied terminal output showed dim blocking alerts and a large provisional cascade. Review followed all four installed CLI skills and their contract, UX, UI, documentation, checklist, and scoring references:

- [cli-design-system](../.agents/skills/cli-design-system/SKILL.md)
- [cli-style](../.agents/skills/cli-style/SKILL.md)
- [cli-audit](../.agents/skills/cli-audit/SKILL.md)
- [cli-copy-review](../.agents/skills/cli-copy-review/SKILL.md)

## Findings and changes

| Finding | Applied change | Verification |
| --- | --- | --- |
| Blockers and fixes inherited dim styling from indentation | Shared renderer accepts semantic line roles. Critical alerts are red, incomplete/provisional states amber, important values primary, secondary context dim, structural glyphs gray, commands cyan. | PTY tests inspect actual foreground and dim state on alert text. |
| Wrapped alerts lost their severity | Layout preserves each line’s role across continuations. | Narrow and standard terminal tests, with identical monochrome content. |
| Human errors were on stdout | Rejected/incomplete human reports use stderr; successful results use stdout. Capabilities are detected per stream. | Separate stdout/stderr redirection tests. |
| Hundreds of provisional lines obscured the cause | Human findings group by cause and file. `--verbose` discloses context; `--limit` bounds entries; `--limit 0` shows all. | Bounded verbose tests and full JSON/plain reports. |
| Generic or unrelated recovery | Registry, inventory, contract, assertion, budget, and evidence failures have specific repair guidance. Only ancestry-only rejection suggests explaining a component. | Executable failure/recovery regressions. |
| Summary and progress order obscured hierarchy | Header precedes terminal progress. Reports end with compact nonzero counters, then an actionable next command. Quiet mode keeps errors and fixes. | Terminal and quiet-mode regressions. |
| Valid formatted bindings were reported as unbound | Static identifier and quoted action keys resolve equally; computed keys, spreads, and inline handlers remain unsupported. | Source registry tests, including all six committed actions. |

## Preserved contracts and scope

- Gate exits remain 0 pass, 1 reject, and 2 incomplete. Other commands retain their published exit codes and behavior.
- JSON check data retains `decision` and `snapshot`; plain data retains its eight columns. Both remain complete, uncolored stdout data even when the gate blocks.
- Setup errors remain stderr diagnostics. Candidate handlers still execute only for checking; inspection and metadata commands remain read-only.
- GNU flag ordering, scoped options, trusted policy/base precedence, deadline-aware writes, signals, ASCII fallback, and existing explicit color-disable precedence remain supported.
- The installed references disagree on mixed `FORCE_COLOR`/`NO_COLOR` precedence. This change preserves Bonsai’s published explicit-disable behavior.
- Human report wording, styling, stream placement, and grouping are presentation changes. Scripts should consume JSON/plain data rather than terminal prose.
- User-level XDG settings, binary distribution, unrelated command renaming, and destructive-action prompts are outside this check-only change. No global CLI compliance score is inferred.

Run the existing suite for machine contracts, deadlines, signals, and actual `.feature` behavior. `test/check-presentation.test.ts` verifies check-specific rendering; `test/cli-presentation.test.ts` retains shared presentation coverage. The example and distributed adoption skill retain their existing workflows. Third-party skill sources are unchanged.
