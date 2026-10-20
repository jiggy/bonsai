# Set up a project

Read this branch when the consuming project has no established Bonsai gate. Return to the main skill after a verified baseline and rejection probe.

## 1. Check applicability

Inspect the consuming project's language, module resolution, product entry points, and verification commands. Read the installed Bonsai README's adapter limits before deciding the scope of adoption.

The current adapter follows TypeScript top-level symbols and literal named-handler registrations. For HTTP routing, queues, dependency injection, side-effect registrations, assets, or another language, identify the missing connection explicitly. An in-process pilot can cover a real supported behavior, provided its report states that limited scope.

**Done:** list the supported maintained scope and every unsupported boundary. A limited pilot is described as a pilot; whole-project adoption requires the intended scope to be analyzable.

## 2. Establish a reproducible checker

Reuse the project's installed checker when available. Otherwise obtain a separate checkout of `https://github.com/jiggy/bonsai`, select a reviewed commit, and install its locked dependencies with `npm ci`. The prototype package is private and has no supported npm-registry installation workflow.

Set `BONSAI_DIR` to that checkout's absolute path and `PROJECT_DIR` to the consuming project's absolute root. Invoke through `npm --prefix "$BONSAI_DIR" run --silent bonsai -- …` so the checker's loader and dependencies resolve from its own checkout. Confirm the Node requirement from its `package.json`, run `--help`, and record the selected revision for reproduction.

**Done:** the checker runs independently of the consuming project's package scripts and its revision is recorded.

## 3. Define the maintained inventory

Start from the checker's `examples/checkout/bonsai.json` and its README, then create one `bonsai.json` in the consuming project's root. Set explicit project-relative maintained paths and the executable bindings path. Include production code, contracts, bindings, relevant tests, fixtures, and maintained configuration within the declared adoption scope.

Compare the inventory against the actual tree. Every scoped maintained artifact must be accounted for; local dependencies must be included. Identify generated outputs and external dependencies deliberately. Rooting a symbol does not erase its file's retained cost, and excluding a troublesome directory narrows the gate's guarantee.

Choose project-wide coefficients and a feedback deadline from the measured baseline and the project's intended constraint. The example numbers are demonstration settings. Record the calibration rationale; keep the resulting acceptance policy stable during ordinary implementation work.

**Done:** each maintained path exists, the binding file is included, the scope has no unexplained exclusions, and the policy's initial allowance and deadline have a recorded rationale.

## 4. Connect one real behavior

Use the checker's `examples/checkout/features/checkout.feature` and `examples/checkout/bindings.ts` as the executable syntax reference. Adapt them to a real product behavior and its actual named handler rather than copying the demo application into the project.

The literal `actions` registry serves both static resolution and runtime execution. Keep action identifiers and response selectors explicit. Put cases and expected outcomes in `.feature` files; Bonsai expands each example and owns the response assertions. Read the installed README before introducing other Gherkin forms.

Run `check --root "$PROJECT_DIR" --json` through the checker. Resolve every unrooted component within the declared scope by connecting it to required behavior or removing unsupported material. Expand contracts to the intended adoption scope before claiming the entire inventory is justified.

**Done:** the baseline has a complete `pass`, all required observations executed, and the scope identified in step 1 matches the implemented contracts and inventory.

## 5. Demonstrate rejection and recovery

Use an isolated copy or a reversible edit outside existing user changes. Add an unused top-level function to an inventoried production module. The gate must exit 1 and identify its missing ancestry, including when the module's other symbols are retained. Remove exactly that probe and rerun: the original candidate must pass again.

Record the baseline fingerprint, retained size, ceiling, surface count, check results, and the rejection/recovery outcomes. Keep generated reports outside maintained paths.

**Done:** the installed gate distinguishes a measured pass from an actual unsupported-code rejection, and the temporary probe is removed.

## 6. Make the loop discoverable

Add a project command that preserves the checker's exit status and an agent-instruction pointer such as:

> Bonsai: read `.agents/skills/bonsai/SKILL.md` when implementing changes under the gate or resolving its failures. Run `<project gate command>` before claiming acceptance.

Use the installed skill's actual location and the real command. Copy this entire skill directory, including `references/`, into the agent system's skill location when installing it; the reference link must remain valid.

For initial adoption, run without `--base` until the base revision contains the project-root configuration and contracts. Subsequently, `--base <revision>` requires `--root` to be the Git repository root and uses the base's policy and inventory by default. Ensure that revision is available in local and CI checkouts. Treat additions to the maintained inventory as explicit scope changes; a candidate edit alone does not change the base inventory.

A local or CI command establishes a development loop. Production admission additionally requires an independently controlled checker and effective policy, isolated candidate execution, checking the combined merge tree, and required status enforcement. Consult the installed checker's `docs/roadmap.md` when that stronger integration is requested. Preserve the project's other verification commands alongside Bonsai.

**Done:** agents can find the skill, the project command preserves failure, the first usable base is identified, and the deployment's actual enforcement guarantees are stated accurately.
