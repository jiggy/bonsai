# Behavior-driven development in Bonsai

Bonsai's own repository is the reference for adopting Bonsai. Start with the
product promise, express it as executable examples, and retain the smallest
implementation that fulfills those examples within the governing allowance.

## What determines the allowance

The executable `.feature` contracts define the external action–observation
surface. Bonsai deduplicates action names and normalized response selectors,
then applies one project-wide ceiling to that surface. The configured bootstrap,
growth, hard cap, and feedback deadline remain the policy; specifications do not
override them.

Every concrete observation remains a verification obligation. More outline rows,
duplicate files, test functions, assertions, callers, or fixture names do not
earn extra allowance. Lower-level tests add confidence and can inherit ancestry
from already justified production subjects; they cannot justify otherwise
unsupported production code. Every maintained file, including specification
support, tests, and documentation, still consumes its full retained cost.

The current checker counts literal action–selector pairs. It cannot decide
whether a newly named promise is legitimate. Keep bindings aligned with public
operations, select arrangements through fixture inputs, and review new selectors
against actual observable behavior. Creating action aliases or wrapping the same
response under new names to enlarge the surface is budget gaming. Product scope
comes from the requested behavior, never from the amount of code needing space.

## New behavior: example, red, green, refactor

1. State the user-visible rule and the authorized scope change. Choose concrete
   successful, rejected, and boundary examples. Use scenario names and fixture
   context to explain why each outcome matters.
2. Add the examples to the owning `.feature` file. A binding may arrange inputs,
   launch the real CLI, and return its report or independently observed effects.
   Keep expected product outcomes in the specification.
3. Run the focused example before implementing the rule. Confirm that it fails
   because the product behavior is missing or wrong. Missing fixtures, unbound
   actions, invalid source, and unavailable tools require repair; they do not
   demonstrate the intended red step.
4. Implement the smallest change that makes the example pass. Add focused unit,
   protocol, compiler, or race regressions where they explain technical edges.
5. Refactor while retaining every required example and observation. Run complete
   feature verification and the other required checks before claiming completion.

Use the compiled authored cases for focused feedback:

```sh
bun run test:specs -- --list
bun run test:specs -- --scenario 'part of a scenario name'
```

A focused run is development feedback. It does not establish that the complete
inventory has ancestry, all other observations passed, or the size budget fits.
The complete checks remain:

```sh
bun run test:features
bun run check
bun run test
bun run demo
bun run bonsai check --json
```

The final command reports the actual root verdict. Complete feature evidence is
required even when the root still correctly rejects size or ancestry violations.
Keep those violations visible; do not enlarge coefficients, exclude authored
material, or extend the feedback deadline to turn the report green.

## Existing behavior: a control and a meaningful counterexample

When an implemented rule lacks a specification, first establish a green example
against the real product. Then show that a narrowly controlled product fault or
rejection probe makes its intended observation fail. Restore the control and
verify it again. Use disposable copies so the demonstration cannot contaminate
the working implementation or another scenario.

Record this as retrospective specification coverage. Do not describe an already
passing example as a spec-first red step. A compiler crash or broken test setup
also does not prove that an assertion detects the intended rule violation.
Selected controlled-fault regressions protect important promises; they are not a
general mutation score, complete coverage claim, or new allowance input.

## Keep the executable boundary honest

- Exercise actual commands, exit codes, reports, streams, and externally observed
  effects. A marker or invocation log can establish execution independently of
  the verifier's reported check count.
- Keep helpers limited to arrangement, execution, and observation. They must not
  reimplement the ceiling, ancestry, or admission algorithm to produce expected
  answers, catch failures as successes, or fill in missing passing observations.
- When a scenario exercises several public operations, invoke each under its own
  action identity and observe its ordinary report. Nesting another command's
  report under a new helper label must not create additional product surface.
- Prove concurrent progress with synchronization and observations of running
  work. Worker metadata alone cannot prove concurrency; machine-specific
  stopwatch thresholds are not a substitute for a behavior contract.
- Keep scenarios independent. The default uses CPU-sized concurrent workers and
  fresh application modules per scenario; `--serial` explicitly tests shared
  module state across ordered scenarios. External resources need independent
  fixture ownership in either mode.
- Preserve detailed technical regressions at the appropriate level. Compiler
  conformance, protocol permutations, terminal styling, and process races do not
  each need another public feature or action name.

## Where product rules live

This is a navigation map, not an allowance ledger or a second list of required
checks. The executable feature files remain authoritative.

| Product rule | Specification |
| --- | --- |
| Admission outcomes and supported analysis boundaries | `features/check.feature` |
| Surface deduplication, budget boundaries, and full retained cost | `features/accounting.feature` |
| Production/test ancestry, effective policy scope, and supported source boundaries | `features/ancestry.feature` |
| Every required execution, freshness, deadlines, and worker lifecycle | `features/evidence.feature` |
| Safe initialization and project/configuration handling | `features/project.feature` |
| Human diagnostics, automation output, and usable recovery guidance | `features/ux.feature` |
| Help, version, and completion discovery | `features/discover.feature` |
| Read-only inspection | `features/inspect.feature` |

The normal test suite executes the product specifications through real command
bindings. Network-dependent tarball installation and `bunx` acceptance remain in
the explicit release check, `bun run test:package`; ordinary root verification
does not acquire a network dependency. The compiler oracle and technical tests
remain additional evidence outside the published runtime sources.

## Review and report

For a behavior change, report the promise and examples, the red/green evidence
or retrospective control/fault evidence, the final required checks, and the real
Bonsai verdict. Inspect changes to action–selector surface separately from changes
to retained size. Removing or weakening a promise requires authorization in the
product task; changing policy is a separate governance change.

A contract-to-component path establishes structural eligibility. It is not proof
of necessity, runtime coverage, or complete specification. Keep the known adapter
limits and trusted-merge admission gaps explicit while using the implemented gate
consistently.
