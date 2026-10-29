# Set up a project

Read this branch when the consuming project has no established Bonsai gate. Return to the main skill after a verified baseline and rejection probe.

## 1. Check applicability

Inspect the consuming project's language, module resolution, product entry points, and verification commands. Read the installed Bonsai README's adapter limits before deciding the scope of adoption.

The current adapter follows TypeScript top-level symbols and literal named-handler registrations. For HTTP routing, queues, dependency injection, side-effect registrations, assets, or another language, identify the missing connection explicitly. An in-process pilot can cover a real supported behavior, provided its report states that limited scope.

For a handler launching a Bun/Node child, read the installed README's fixed child
entry-point syntax. Literal module-relative URLs and immutable path aliases can
connect maintained TypeScript startup code without retaining unused exports.
Computed paths, shells, and arbitrary wrappers still need tracing support. Do not
add contracts merely to hide an unsupported connection.

**Done:** list the supported maintained scope and every unsupported boundary. A limited pilot is described as a pilot; whole-project adoption requires the intended scope to be analyzable.

## 2. Establish a reproducible checker

Reuse the project's installed checker when available. Otherwise obtain a separate checkout of `https://github.com/jiggy/bonsai`, select a reviewed commit, and install its locked dependencies with `bun install --frozen-lockfile`. After the native release is published, `bunx --bun @jigging/bonsai@alpha check` can run it directly, or install globally with `bun add --global @jigging/bonsai@alpha`. Select an exact published version for CI. The old alpha.0 package predates native analysis; preparing a newer version in Git does not publish it. Users need Bun and a supported prebuilt platform, not Cargo or a Rust compiler.

Set `BONSAI_DIR` to that checkout's absolute path and `PROJECT_DIR` to the consuming project's absolute root. Invoke through `bun run --cwd "$BONSAI_DIR" --silent bonsai …` so the checker's loader and dependencies resolve from its own checkout. Confirm the Bun requirement from its `package.json`, run `--help`, and record the selected revision for reproduction.

Bonsai uses native Rust source analysis by default. Existing `--engine rust` commands work; remove `--engine typescript`. Missing native packages must be repaired rather than bypassed with a different engine. Read the installed platform matrix before adopting the gate.

**Done:** the checker runs independently of the consuming project's package scripts and its revision is recorded.

## 3. Define the maintained inventory

Run `init --root "$PROJECT_DIR"` through the selected checker to create `bonsai.json` without writing the schema by hand. It discovers maintained paths, reuses conventional registries and contracts, and creates commented starters when absent. Existing files are preserved and project code never runs. The result lists exclusions and draft settings. Use the checker's README and `config show --root "$PROJECT_DIR"` to inspect them. Include production code, contracts, bindings, relevant tests, fixtures, and maintained configuration within the declared adoption scope.

Compare the inventory against the actual tree. Every scoped maintained artifact must be accounted for; local dependencies must be included. Identify generated outputs and external dependencies deliberately. Rooting a symbol does not erase its file's retained cost, and excluding a troublesome directory narrows the gate's guarantee.

Review the initializer's saved `exclude` patterns as part of that scope. They
capture project Gitignore rules and default cache, lockfile, and nested-project
exclusions. Checks use the saved configuration, including the base version under
`--base`; later candidate ignore-file edits do not change the trusted scope.

Choose project-wide coefficients and a feedback deadline from the measured baseline and the project's intended constraint. The initializer's defaults and example numbers are starting points, not calibrated acceptance rules. Record the calibration rationale; keep the resulting acceptance policy stable during ordinary implementation work.

For releases with supporting runners, use the installed checker's `docs/verification.md` to configure the concrete adapters and reviewed coverage or mutation floors under `runners`. Pin framework dependencies and define their test and coverage scope deliberately. Commands share the existing feedback deadline with product verification. Put fresh reports outside maintained inputs; report paths cannot overlap authored inventory. Supporting results grant no ancestry or allowance, and a configured requirement cannot be replaced by an unintegrated passing suite.

**Done:** each maintained path exists, the binding file is included, the scope has no unexplained exclusions, required verification is explicit, and the policy's initial allowance and deadline have a recorded rationale.

## 4. Connect one real behavior

Use the checker's `examples/checkout/features/checkout.feature` and `examples/checkout/bindings.ts` as the executable syntax reference. Adapt them to a real product behavior and its actual named handler rather than copying the demo application into the project.

The literal `actions` registry serves both static resolution and runtime execution. Keep action identifiers and response selectors explicit. Put cases and expected outcomes in `.feature` files; Bonsai expands each example and owns the response assertions. Read the installed README before introducing other Gherkin forms.

First discover the stakeholder’s rule, relevant context, and observable consequence. Choose minimal examples that distinguish it and its important boundaries. For a checkout owner, a rule might be: only positive whole quantities can place an order. These examples cover acceptance, the zero boundary, and fractional input:

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

Register `place-order` to the actual application handler. Context belongs in explanatory prose and inputs; arbitrary domain `Given` steps are not supported by this DSL. The same product rule should survive a replacement implementation. Running application code, asserting public JSON, or putting a test in Gherkin does not by itself meet that bar.

Choose canonical external operation names and domain observations. Reuse them across fixture contexts and examples; do not relabel technical bookkeeping as product facts or introduce an opaque `scenarioPassed` flag. These examples earn one `place-order`/`status` pair while retaining every concrete obligation. The engine counts literal normalized pairs, so review every pair for product significance; semantic eligibility is not automatically enforced. Technical proofs and helper aliases must not create headroom.

Keep incidental schema layout, backend identities, exact compiler diagnostics, and similar proofs in technical tests. Preserve those regression assertions when moving them out of features, with recorded destinations and verified results. Public compatibility, safety, and rejection promises can warrant features when users depend on them. Report any resulting allowance reduction separately from actual code savings; all maintained tests and support still consume retained space.

For a new behavior, demonstrate its intended failing acceptance example before implementation. For existing behavior being adopted, begin with a green control and show a controlled violation is rejected. Keep that retrospective evidence distinct from a spec-first red step. Arrange data and invoke real handlers in bindings; leave expected outcomes and assertions in the contracts.

Run `check --root "$PROJECT_DIR" --json` through the checker. Resolve every unrooted component within the declared scope by connecting it to required behavior or removing unsupported material. Expand contracts to the intended adoption scope before claiming the entire inventory is justified.

**Done:** the baseline has a complete `pass`, all required observations executed, and the scope identified in step 1 matches the implemented contracts and inventory.

## 5. Demonstrate rejection and recovery

Use an isolated copy or a reversible edit outside existing user changes. Demonstrate both boundaries separately:

- Change one real handler's response for a specified input while preserving a runnable, analyzable program. The gate must reject the violated observation; an unrelated setup or compiler failure is not evidence of assertion sensitivity.
- Add an unused top-level function to an inventoried production module. The gate must exit 1 and identify its missing ancestry, including when the module's other symbols are retained.

If supporting runners are configured, also show that a skipped required result or a command that leaves no fresh report blocks the check. With a quality floor, demonstrate rejection when the suite passes but measured coverage or mutation detection falls below that floor. Restore the passing arrangement and demonstrate recovery without lowering the requirement; a pre-existing passing report must not satisfy it.

Restore each probe and rerun the original candidate. Do not weaken expected results, change scope, or enlarge policy to recover the pass.

Record the baseline fingerprint, retained size, ceiling, surface count, check results, and the rejection/recovery outcomes. Keep generated reports outside maintained paths.

**Done:** the installed gate distinguishes a measured pass from both a behavioral violation and unsupported retained code; every temporary probe is removed and the restored candidate passes.

## 6. Make the loop discoverable

Add a project command that preserves the checker's exit status and an agent-instruction pointer such as:

> Bonsai: read `.agents/skills/bonsai/SKILL.md` when implementing changes under the gate or resolving its failures. Run `<project gate command>` before claiming acceptance.

Use the installed skill's actual location and the real command. Copy this entire skill directory, including `references/`, into the agent system's skill location when installing it; the reference link must remain valid.

State the governing BDD rule in the project's agent instructions: discover stakeholder rules and implementation-independent examples before implementation; reviewed product promises determine the allowance. Test mechanics and supporting test counts do not qualify promises. Require meaningful failure evidence, preservation of technical regressions in the appropriate tests, full verification after refactoring, and separate reporting of allowance changes and code savings. Keep existing product promises unless the task authorizes their change. A failing budget calls for code reduction, not invented promises.

For initial adoption, run without `--base` until the base revision contains the project-root configuration and contracts. Subsequently, `--base <revision>` requires `--root` to be the Git repository root and uses the base's policy and inventory by default. Ensure that revision is available in local and CI checkouts. Treat additions to the maintained inventory as explicit scope changes; a candidate edit alone does not change the base inventory.

A local or CI command establishes a development loop. Production admission additionally requires an independently controlled checker and effective policy, isolated candidate execution, checking the combined merge tree, and required status enforcement. Consult the installed checker's `docs/roadmap.md` when that stronger integration is requested. Preserve the project's other verification commands alongside Bonsai.

**Done:** agents can find the skill, the project command preserves failure, the first usable base is identified, and the deployment's actual enforcement guarantees are stated accurately.
