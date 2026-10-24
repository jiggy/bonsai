# Purpose

Define Bonsai's externally observable behavior as executable Gherkin contracts.

## Ownership

`check.feature` covers admission, source and verification timing, and missing native-collector failures; `inspect.feature` covers read-only inspection; `discover.feature` covers initialization and CLI discovery, including available source engines without requiring a Rust build. Root `bonsai.bindings.ts` connects these actions to `src/self-host.ts`, which invokes the real CLI against isolated projects.

## Local Contracts

Assert actual CLI reports, exit codes, and filesystem outcomes. Keep every required example executable. Surface deduplication must preserve the individual checks. Fixture behavior belongs in executable support; product requirements belong in `.feature` scenarios.

## Work Guidance

Cover both successful behavior and blocking outcomes. Keep unsupported self-analysis visible rather than manufacturing a passing gate.

## Verification

`bun run test:features` verifies that the committed contracts execute and their assertions pass.

## Child DOX Index

None. This file owns the full subtree.
