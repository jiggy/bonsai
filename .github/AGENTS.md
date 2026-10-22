# Purpose

Automate formatting and verify proposed changes.

## Ownership

`workflows/ci.yml`.

## Local Contracts

Formatting and candidate validation have read-only tokens with no persisted credentials. Only isolated jobs apply patches, push branch updates, or report check results. PR validation checks the merge result.

## Work Guidance

Never execute candidate scripts in write-capable jobs. Preserve checks on formatting commits.

## Verification

Workflow lint and GitHub Actions

## Child DOX Index

None. This file owns the full subtree.
