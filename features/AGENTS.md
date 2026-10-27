# Purpose

Define Bonsai's externally observable behavior as executable Gherkin contracts.

## Ownership

`check.feature` covers admission, source and verification timing, native checker evidence, subprocess ancestry, and unsupported analysis. `accounting.feature` specifies the allowance, retained cost, contract grammar, and actual compaction. `ancestry.feature` specifies production/test boundaries, effective base policy, supported source and registration boundaries, and measured JSON dependencies. `evidence.feature` specifies actual execution, concurrency, freshness, and shutdown. `project.feature` covers safe adoption; `ux.feature` covers user-visible diagnostics and automation. `inspect.feature` covers read-only inspection; `discover.feature` covers help, version, and completion discovery. Root `bonsai.bindings.ts` connects stable public command identities to `support/actions.ts`.

The missing native-server contract requires an actionable `BONSAI_NATIVE_BINARY` repair without running handlers.

## Local Contracts

Assert actual CLI reports, exit codes, and filesystem outcomes. Keep every required example executable. Surface deduplication must preserve the individual checks. Fixture behavior belongs in executable support; product requirements belong in `.feature` scenarios.

Reviewed external action–observation pairs govern the allowance. Cases, files, helpers, and aliases do not justify extra capacity. Keep command identities stable and express fixture differences in their inputs. Helpers must arrange, execute, and observe; they must not copy the policy evaluator or fabricate passing evidence. Follow [the BDD workflow](../docs/bdd.md), including meaningful red/green for new behavior and control/fault evidence for retrospective specifications.

## Work Guidance

Cover both successful behavior and blocking outcomes. Native checking is the default; the removed TypeScript engine choice is not an executable obligation. Keep unsupported self-analysis visible rather than manufacturing a passing gate.

The default verification contract requires fresh state between scenarios, ordered steps within a scenario, automatic CPU-sized concurrency, and every observation. The `--serial` contract requires shared state across ordered scenarios through the real CLI. Discovery exposes `--serial` as a check-only flag; neither profile uses project execution settings.

## Verification

`bun run test:features` verifies that the committed contracts execute and their assertions pass.

## Child DOX Index

- [support/AGENTS.md](support/AGENTS.md): disposable projects, real CLI launches, factual observations, and public command bindings.
