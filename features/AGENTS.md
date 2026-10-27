# Purpose

Define Bonsai's externally observable behavior as executable Gherkin contracts.

## Ownership

`check.feature` covers admission, source and verification timing, native Rust checker evidence, unsupported native tracing, and missing native-server failures. Its subprocess scenarios require real child execution and preserve unused exports, uncontracted launches, measured inventory, and missing-entry blocking. `inspect.feature` covers read-only inspection; `discover.feature` covers initialization and CLI discovery, including the Rust compatibility option without starting a compiler. Root `bonsai.bindings.ts` connects these actions to `src/self-host.ts`, which invokes the real CLI against isolated projects.

The missing native-server contract requires an actionable `BONSAI_NATIVE_BINARY` repair without running handlers.

## Local Contracts

Assert actual CLI reports, exit codes, and filesystem outcomes. Keep every required example executable. Surface deduplication must preserve the individual checks. Fixture behavior belongs in executable support; product requirements belong in `.feature` scenarios.

## Work Guidance

Cover both successful behavior and blocking outcomes. Native checking is the default; the removed TypeScript engine choice is not an executable obligation. Keep unsupported self-analysis visible rather than manufacturing a passing gate.

## Verification

`bun run test:features` verifies that the committed contracts execute and their assertions pass.

## Child DOX Index

None. This file owns the full subtree.
