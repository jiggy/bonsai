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

## Rust engine

`check` and `explain` share their frontend when `--engine rust` is selected. The
Rust path collects diagnostics and symbols independently through pinned tsrs.
The TypeScript reference runs separately in development comparisons, never as
part of a production native check. Neither engine claims universal compiler
compatibility.

`test/native-cli.test.ts` checks actual Rust-backed pass/reject reports, JSON facts,
plain columns, quiet and verbose output, and read-only explanations. Presentation
comparisons normalize only elapsed measurements, explicit engine selection, and
the additive engine metadata. PTY checks inspect red, non-dim blocker text across
narrow wrapping, monochrome output, and independently redirected stdout.

Unsupported facts remain explicit incomplete results. Interrupted native collection
retains provisional inventory measurements. Missing, crashed, or malformed workers return runtime
errors without raw worker output. Tests check base analysis, compiler diagnostics,
subprocess cleanup on timeout and SIGINT, and a handler side-effect marker proving
that failed native analysis cannot run candidate code. Recovery commands retain
the selected engine; invalid binary overrides receive an unset-and-install repair.

Fixed subprocess entry-point failures now group missing/unmaintained and unsupported
targets with their launch locations and an explicit inventory/path repair. PTY
tests preserve readable red blocker text through wrapping, cyan recovery commands,
and complete uncolored JSON facts; inspection still starts no children.
