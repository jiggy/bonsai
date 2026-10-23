# Purpose

Automate formatting and verify proposed changes.

## Ownership

`workflows/ci.yml`.

## Local Contracts

Formatting and candidate validation have read-only tokens with no persisted credentials. Only isolated jobs apply patches, push branch updates, or report check results. PR validation checks the merge result. The normal test step includes Bonsai’s executable feature contracts; a passing suite does not claim the root retained-code gate passes.

Formatting covers Biome-managed files and the Rust crate. Read-only validation also checks Rust formatting, Cargo tests, the release prototype build, and differential source comparisons under the pinned toolchain. Keep native commands out of write-capable jobs.

## Work Guidance

Never execute candidate scripts in write-capable jobs. Preserve checks on formatting commits.

## Verification

Workflow lint and GitHub Actions

## Child DOX Index

None. This file owns the full subtree.
