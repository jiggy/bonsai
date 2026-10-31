# Behavior-driven development in Bonsai

Bonsai's specifications are a reference for its adopters. Use BDD to discover
and agree on product rules through concrete examples, then build the smallest
implementation that fulfills them. Use TDD's red/green/refactor discipline to
implement those rules. Executable Gherkin and failing assertions support that
work; they do not establish that a specification describes the right behavior.

## Discover the rule before choosing the test

Start with the requester’s goal and existing product language. Identify who
needs the behavior, why it matters, the relevant situation, and the observable
consequence. Resolve uncertainty through examples and counterexamples before
choosing response selectors or writing fixture code. Record that context in the
feature’s prose and scenario names; an opaque fixture or case identifier cannot
carry the requirement by itself.

Review a proposed specification against these questions:

- Does it express a rule a user or maintainer can explain and contest?
- Would the rule still hold after replacing the implementation while preserving
  the product’s promised behavior?
- Do the examples distinguish the rule, its meaningful alternatives, and the
  important boundaries with minimal repetition?
- Does each observation establish a product consequence rather than inspect
  an implementation choice or the test harness?

Classify the change before choosing a `.feature` file or starting red/green.
Name the agreed product rule, say whether it is new, changed, or already covered,
and explain which meaningful decision boundary the example adds. A new syntax,
report-layout, or scheduling case under an existing rule normally belongs in a
technical regression. Surviving an implementation rewrite is necessary but not
sufficient: technical compatibility tests can survive one too.

For a developer tool, code and failure cases are often the domain. Rejecting
unsupported source, preserving existing files, refusing false passes, and stopping
work after cancellation are valid product promises. JSON can expose a domain
fact, and a stable public schema can itself be a compatibility promise. A field’s
visibility alone does not make its layout or value a separate capability.

## Put each assertion at the right level

| Product specification | Technical regression |
| --- | --- |
| Repeated examples strengthen verification without buying capacity | Compiler check IDs, parser objects, and report-array ordering |
| Unit tests cannot justify unrelated production code | Shared assertion-helper chains and graph-propagation bookkeeping |
| Incorrect behavior cannot pass; every required input executes | Worker messages and exact process scheduling details |
| Initialization preserves the developer’s files | Exact generated scaffolding and serializer layout |
| Errors explain the cause and remain readable | ANSI numeric codes and complete parser error strings |
| Checks report useful timing and respect the feedback deadline | Internal phase names, backend identities, and benchmark distributions |

Use `.feature` files for the reviewed product rules. Keep detailed assertions in
the relevant `test/*.test.ts` integration, compiler, protocol, presentation, or
performance tests. Both layers can exercise the real CLI. Neither layer is
defined by its file extension or by whether it launches a subprocess.

Bonsai nevertheless discovers executable contracts by the maintained `.feature`
extension, not by directory name. Moving a technical `.feature` file into `test/`
still makes it count. Keep technical cases as test-source data or generate them
inside disposable consuming projects; the maintained technical tests and their
support remain measured.

When migrating a technical feature, preserve its assertions in technical tests,
record their destinations in the change review, and run them. Preserve the product
promise in a focused feature with meaningful examples. Do not merely reword
internal selectors, delete regressions, or replace assertions with an opaque
`scenarioPassed` flag. A migration changes test placement, not authorized scope.

## Review what earns allowance

Reviewed executable product contracts supply one global action–observation
surface. Every authored product observation remains required. More test functions,
example rows, files, callers, and fixture names do not independently earn capacity.
Lower-level tests add confidence and can inherit established production ancestry;
they cannot justify otherwise unsupported production code. All maintained files,
including technical tests, specification support, and documentation, stay charged.

The current engine counts literal action names paired with normalized response
selectors. It does not recognize stakeholder significance, equivalent meanings,
or technical proof artifacts. Eligibility is a human review obligation, not an
implemented semantic counter. Review every added pair against its product rule.
Use canonical public actions and established domain observations; do not create
headroom through helper aliases, backend metadata, or renamed copies of reports.
There is no second capability ledger or per-feature grant.

Moving implementation assertions out of features may reduce the measured surface
and allowance even when every regression is preserved. Report that effect
separately from retained-code savings. Keep the actual root verdict visible; do
not hide authored code, enlarge coefficients, or extend the feedback deadline to
recover a pass. The configured bootstrap, growth, cap, and deadline still govern.

## Worked Bonsai example

This assertion pins a tool choice, rather than a reviewer’s reason to trust a
check:

```gherkin
Scenario: Verify behavior with the Rust TypeScript checker
  When I invoke "check" with {"examples": 2}
  Then response "snapshot.analysis.backend" equals "tsrs"
```

Keep native-backend verification in the native integration tests. A product
specification instead explains a rule reviewers rely on. For example, duplicating
requirements must not buy code capacity or silently skip their execution. Here
two files each contain the same positive and negative order examples; all four
invocations observe the same public action and status, under a 1000-token
bootstrap allowance:

```gherkin
Scenario: Duplicate requirements preserve capacity and every invocation
  When I invoke "check" with {"fixture": "accounting", "case": "duplicate-contracts", "layout": "duplicate"}
  Then response "decision.surface" equals 1
  And response "decision.ceiling" equals 1000
  And response "invocationCount" equals 4
```

Here the arrangement selects the stated contracts, and actual invocations are
independently counted. Surface and ceiling are user-relevant budget decisions;
their JSON representation does not disqualify them. A different analyzer can
fulfill this same rule. This replaces an implementation claim with a product
rule, not a friendly alias for `backend` or a computed test verdict.

## An adopter’s example

A checkout owner agrees that only positive whole quantities can place an order.
The examples distinguish acceptance, the zero boundary, and fractional input.
With `place-order` registered to the actual application handler:

```gherkin
Feature: Place orders only for valid quantities
  Scenario Outline: Decide whether an order quantity is valid
    When I invoke "place-order" with {"quantity": <quantity>}
    Then response "status" equals "<status>"
    Examples:
      | quantity | status   |
      | 1        | accepted |
      | 0        | rejected |
      | 1.5      | rejected |
```

This uses the supported invocation/response DSL. Context is explanatory prose,
not an executable `Given` step; arbitrary domain steps need adapter support.
The three examples retain one `place-order`/`status` pair and every concrete
obligation. See [adoption](../skills/bonsai/references/adoption.md) for setup.

## Implement and verify the agreed rule

For new behavior, author the acceptance example before implementation. Observe
failure caused by the missing or incorrect product behavior, make the smallest
passing change, then refactor under the same rule. Missing bindings, broken
fixtures, compiler crashes, and unavailable tools are setup failures, not the
intended red evidence. Technical tests guide implementation details separately.

For already implemented behavior gaining a specification, establish a green
control, demonstrate that a controlled product fault or rejection probe violates
its intended observation, then restore and rerun the control in disposable copies.
Report this as retrospective coverage, not a spec-first red step. Selected fault
checks prove sensitivity to those faults, not BDD quality, a general mutation
score, or complete behavioral coverage.

Use the authored specifications for focused feedback:

```sh
bun run test:specs -- --list
bun run test:specs -- --scenario 'part of a scenario name'
```

Support arranges inputs, executes actual public operations, and observes domain
facts from reports or independent effects. It must not reimplement policy,
calculate expected answers, catch failures as successes, or manufacture evidence.
An observer can report actual file presence, unchanged bytes, displayed text, or
recorded calls. These describe individual consequences; a combined
`scenarioPassed` flag or a computed expected budget would conceal the assertions.
Observe each public operation under its own canonical action instead of nesting
another command’s report to mint selectors. Avoid hiding context in fixtures.

Prove concurrent progress with synchronized observable work, not worker metadata
alone or machine-specific speed thresholds. Default scenarios have fresh
application processes; `--serial` shares module state across ordered scenarios.
Own external resources independently in either mode.

A focused run does not establish complete source analysis, ancestry, or budget
acceptance. Run the complete specifications and relevant technical regressions:

```sh
bun run test:features
bun run check
bun run test
bun run demo
bun run bonsai check --json
```

The last command reports the actual root verdict. Passing product examples and
technical tests do not erase size or ancestry violations. Structural ancestry
does not prove necessity, runtime coverage, or specification completeness.

## Navigate and review

The feature files are authoritative; this map is navigation, not another ledger.
Technical tests preserve the detailed proofs beside the relevant implementation.

| Product rule | Specification |
| --- | --- |
| Admission outcomes and supported analysis boundaries | `features/check.feature` |
| Surface deduplication, budget boundaries, and full retained cost | `features/accounting.feature` |
| Production/test ancestry and effective policy scope | `features/ancestry.feature` |
| Required execution, freshness, deadlines, and cancellation | `features/evidence.feature` |
| Safe initialization and project/configuration handling | `features/project.feature` |
| Human diagnostics, automation, and recovery guidance | `features/ux.feature` |
| Help, version, and completion discovery | `features/discover.feature` |
| Read-only inspection | `features/inspect.feature` |
| Saved check inspection with faithful rejection/incomplete decisions | `features/report.feature` |

The migrated accounting, source, check, project, and UX proofs live in
`test/accounting-contracts.test.ts`, `test/source-contracts.test.ts`,
`test/check-contracts.test.ts`, `test/project-contracts.test.ts`, and
`test/ux-contracts.test.ts`. Worker protocol and scheduling regressions remain in
`test/evidence-parallel.test.ts`. Consult [test ownership](../test/AGENTS.md) for
the surrounding suites. Map assertions to their subject, not one technical test
per feature or another runtime manifest.

Network-dependent tarball/`bunx` acceptance stays in the explicit release check,
`bun run test:package`; ordinary root verification has no network dependency.

Use [the pull request template](../.github/pull_request_template.md) to explain
the stakeholder rule and examples, meaningful
red/green or retrospective control/fault evidence, technical assertions moved and
their destinations, surface/allowance change, retained-size change, and actual
verification results. Product scope removal and policy changes need their own
authorization. If there is no product behavior change, say so and describe the
technical purpose; a new feature is not required for a refactor or regression.
Keep known adapter and trusted-admission limits explicit.
