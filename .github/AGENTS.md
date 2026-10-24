# Purpose

Automate formatting, verify proposed changes, and publish the landing page.

## Ownership

`workflows/ci.yml` and `workflows/pages.yml`.

## Local Contracts

Formatting and candidate validation have read-only tokens with no persisted credentials. Only isolated jobs apply patches, push branch updates, report check results, or deploy Pages. PR validation checks the merge result. The normal test step includes Bonsai’s executable feature contracts; a passing suite does not claim the root retained-code gate passes.

The website workflow runs `website:build` and `website:check` with read-only contents and Pages permissions. PRs never configure Pages, upload deployment artifacts, or deploy. Main-branch pushes and manual main-branch runs read existing Pages metadata and upload the checked `_site` output. Pages must already use GitHub Actions as its publishing source; the workflow does not enable or change repository settings.

The isolated deploy job has only `pages: write` and `id-token: write`, targets the `github-pages` environment, and deploys the uploaded artifact without a checkout or candidate commands. Other branches may be checked manually but cannot deploy.

Formatting covers Biome-managed files. Read-only validation installs the pinned native TypeScript checker through Bun and runs differential source comparisons, types, the full test suite, and the demo. There is no authored Cargo crate or Rust build step. Keep native analysis commands out of write-capable jobs.

## Work Guidance

Never execute candidate scripts in write-capable jobs. Preserve checks on formatting commits. Keep website action versions pinned and preserve the separation between validation and deployment.

## Verification

Workflow lint and GitHub Actions. Website changes also require `bun run website:build` and `bun run website:check`.

## Child DOX Index

None. This file owns the full subtree.
