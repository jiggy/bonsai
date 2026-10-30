# Working on Bonsai

Read README.md and docs/design.md before changing behavior. Bonsai should embody its own restraint: prefer one small package and concrete adapters over speculative extension machinery.

Preserve these invariants:
- Surface deduplication never removes verification obligations.
- Tests cannot root otherwise unsupported production code.
- Unrooted source still consumes the full retained budget.
- Missing or mismatched evidence cannot produce a pass.
- A reachable wrapper receives no cost discount.
- No per-feature grants or accumulated allowance ledgers.

Use Bun by default for dependency installation and package scripts. Install with `bun install --frozen-lockfile`; keep `bun.lock` current and do not generate npm lockfiles. Bun also runs the CLI, tests, and verification workers.

## Change delivery

Work on a topic branch and open a pull request against `main` for repository changes. Do not push directly to `main`. Leave merging to the user unless explicitly requested.

Until the first mature release, the root retained-code allowance overrun is not a
development delivery blocker. Continue measuring and reporting the actual verdict;
do not relax policy, omit inventory, or turn an over-budget check into a pass.

## BDD and the code allowance

Read [the BDD workflow](docs/bdd.md) before changing product behavior or its contracts. BDD starts by discovering and agreeing on stakeholder rules through examples. Red/green/refactor is implementation discipline; real CLI execution, Gherkin, public JSON, and fault sensitivity alone do not qualify a test as a product specification.

- State whose problem the rule solves, its meaningful context, and its observable consequence. Choose the fewest examples that distinguish the rule and its important boundaries. A specification should survive a replacement implementation that preserves the product promise. User-important rejection, safety, and recovery cases belong in BDD.
- Keep action identities aligned with public commands and observations aligned with domain facts. Explain fixture context in the feature; an opaque case name cannot carry the requirement. Do not rename technical bookkeeping into friendly aliases, create an opaque `scenarioPassed` oracle, or invent promises to justify existing code.
- For new behavior, write the executable example first and observe a failure caused by the missing product behavior. A broken fixture, missing binding, compiler error, or unavailable tool is not that evidence. Implement the smallest change, make the example pass, then refactor while preserving its obligations.
- For already implemented behavior missing a specification, establish a green real-CLI example and demonstrate that a controlled product fault or rejection probe makes the intended observation fail. Record this as retrospective coverage, not a spec-first red step.
- Keep expected product outcomes in `.feature` files. Support arranges inputs, invokes the real CLI, and returns reports or independently observed facts; it must not duplicate the decision algorithm, hide expected outcomes, or manufacture passed observations.
- Keep implementation identities, exact schema layout, compiler diagnostics, ANSI codes, worker protocols, and detailed performance regressions in the appropriate tests. A public compatibility promise can justify a feature; visibility of a field alone cannot. Technical tests grant no product allowance and cannot root unsupported production code. Ancestry is structural, not proof of behavioral completeness.
- Preserve product promises and regression coverage. During a BDD migration, move lower-level assertions into technical tests with explicit destinations and verification; do not simply delete them or keep them in features to retain headroom. Removing a product promise still requires an authorized scope change.
- For a refactor or technical regression with no product behavior change, say so and use the appropriate tests; do not invent a new feature to justify the work.
- Review every added action–selector pair against its stakeholder rule. The engine counts literal normalized pairs and cannot assess semantic eligibility. Test counts, examples, fixture names, aliases, and technical proof artifacts must not manufacture allowance. Keep one global ceiling without a second ledger; report changes to allowance separately from actual retained-code savings. All maintained specifications, support, tests, and documentation remain charged.

The normal suite executes `features/*.feature` against the real CLI. Use the focused specification command for the red/green loop and `bun run test:features` for the complete self-verification. Keep passing feature evidence distinct from the root retained-code verdict; never change its scope, coefficients, or deadline merely to obtain a pass.

Verification runs concurrent isolated scenarios by default, sized from available CPU capacity and bounded by scenario count. Use `check --serial` for ordered scenarios sharing application state. Execution mode and worker count do not belong in project settings.

Run `bun run check`, `bun run test`, and `bun run demo`. Add behavioral tests for changes to acceptance or graph propagation. Do not claim broader framework or verification support than the collector actually supplies. Keep README limitations current.

---

# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

- Use all applicable CLI skills in `.agents/skills/` for CLI behavior, help, errors, and terminal presentation; verify semantic colors and wrapped alert text, rather than merely checking for ANSI output.
- Keep automated formatting in CI rather than adding formatting instructions to agent context.
- During stabilization, report the repository's retained-size overage but defer its remediation. Preserve the gate's measurements and policy while fixing other failures.

## Child DOX Index

The root owns the reusable `action.yml` manifest, package metadata, runtime dependencies, environment setup, repository-wide contracts, and the legacy `native/README.md` migration note.

`bun run test:runners` is an explicit network-dependent release check for pinned supporting-runner compatibility. Ordinary tests stay network-free; no runner install belongs in product checks.

- [src/AGENTS.md](src/AGENTS.md): CLI, analysis, policy evaluation, and evidence workers
- [features/AGENTS.md](features/AGENTS.md): executable contracts for Bonsai’s own observable behavior
- [test/AGENTS.md](test/AGENTS.md): behavioral and CLI integration tests, native comparisons, and benchmark tooling
- [docs/AGENTS.md](docs/AGENTS.md): design, roadmap, and CLI reference
- [examples/AGENTS.md](examples/AGENTS.md): executable checkout fixture
- [skills/AGENTS.md](skills/AGENTS.md): distributed Bonsai adoption skill
- [.agents/skills/AGENTS.md](.agents/skills/AGENTS.md): installed CLI design and review skills
- [.github/AGENTS.md](.github/AGENTS.md): the reusable action implementation, pull request review guidance, CI formatting, validation, permissions, and website deployment
- [website/AGENTS.md](website/AGENTS.md): landing page, static assets, and GitHub Pages artifact
