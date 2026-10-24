# Purpose

Compare the native TypeScript checker with the reference engine and measure complete CLI checks.

## Ownership

Bun development tools in `tools/`: shared differential fixtures, canonical source facts, reference/native comparisons, and fresh-process CLI benchmarks. The production native collector lives under `src/` at the repository root and uses the pinned tsrs package; this directory contains no Cargo crate or native implementation.

## Local Contracts

Compare component, relationship, token, binding, source-location, and diagnostic facts against the TypeScript reference. tsrs performs the native compiler work. Reference comparison belongs in development tooling; production native checks do not repeat the reference compiler pass.

Unsupported source or unresolved dependencies remain explicit. A matching source comparison does not establish runtime evidence or gate acceptance. Any assumed observations used to compare derived ancestry and policy decisions stay labeled as development inputs and never authorize acceptance.

Keep this authored tooling in maintained inventory. Retire obsolete implementations by deleting them, rather than excluding retained source. Other projects' authored Rust remains measured and unsupported until a Rust ancestry adapter exists.

Compare both engines on identical inputs. Benchmarks launch fresh CLI processes, include startup, alternate engines, and preserve individual samples, decisions, and verification state. Cold means a fresh process, without flushing operating-system file caches. Distinguish incomplete runs from completed verification and never report skipped work as a complete-check speedup.

The reference collector retains its production compiler-session rules. No benchmark or comparison persists trusted diagnostics, source results, or runtime evidence.

## Work Guidance

Keep development commands small and their JSON reports versioned. Do not switch the default engine before compatibility and performance are demonstrated.

## Verification

`bun run native:compare`, `bun run native:bench`, and the normal Bun suite's source and real-CLI engine comparisons.

## Child DOX Index

None. This file owns the full subtree.
