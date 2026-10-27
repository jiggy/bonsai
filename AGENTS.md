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

Define Bonsai’s observable behavior in executable `features/*.feature` contracts. The normal test suite must execute them against the real CLI; `bun run test:features` runs them alone. Keep feature verification distinct from the root retained-code gate.

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

## Child DOX Index

The root owns package metadata, runtime dependencies, environment setup, and repository-wide contracts.

- [src/AGENTS.md](src/AGENTS.md): CLI, analysis, policy evaluation, and evidence workers
- [native/AGENTS.md](native/AGENTS.md): native semantic comparisons and fresh-command benchmarks
- [features/AGENTS.md](features/AGENTS.md): executable contracts for Bonsai’s own observable behavior
- [test/AGENTS.md](test/AGENTS.md): behavioral and CLI integration tests
- [docs/AGENTS.md](docs/AGENTS.md): design, roadmap, and CLI reference
- [examples/AGENTS.md](examples/AGENTS.md): executable checkout fixture
- [skills/AGENTS.md](skills/AGENTS.md): distributed Bonsai adoption skill
- [.agents/skills/AGENTS.md](.agents/skills/AGENTS.md): installed CLI design and review skills
- [.github/AGENTS.md](.github/AGENTS.md): CI formatting, validation, permissions, and website deployment
- [website/AGENTS.md](website/AGENTS.md): landing page, static assets, and GitHub Pages artifact
