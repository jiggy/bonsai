# Purpose

Automate formatting, verify proposed changes, and publish the landing page.

## Ownership

`workflows/ci.yml` and `workflows/pages.yml`.

## Local Contracts

Formatting and candidate validation have read-only tokens with no persisted credentials. Only isolated jobs apply patches, push branch updates, report check results, or deploy Pages. PR validation checks the merge result. The normal test step includes Bonsai’s executable feature contracts; a passing suite does not claim the root retained-code gate passes.

The website workflow runs `website:build` and `website:check` with read-only contents and Pages permissions. PRs never configure Pages, upload deployment artifacts, or deploy. Main-branch pushes and manual main-branch runs read existing Pages metadata and upload the checked `_site` output. Pages must already use GitHub Actions as its publishing source; the workflow does not enable or change repository settings.

The isolated deploy job has only `pages: write` and `id-token: write`, targets the `github-pages` environment, and deploys the uploaded artifact without a checkout or candidate commands. Other branches may be checked manually but cannot deploy.

Formatting covers Biome-managed files. Read-only validation installs the pinned native TypeScript checker through Bun and runs differential source comparisons, types, the full test suite, and the demo. There is no authored Cargo crate. Keep native analysis commands out of write-capable jobs.

`native-platforms` runs installation regressions on `macos-15-intel` (darwin-x64) and `macos-15` (darwin-arm64), asserting Bun's actual platform and architecture. Intel builds the immutable upstream tsrs revision matching the pinned SDK with its optimized `ci` profile without LTO; Apple Silicon uses its published package. Both require a real explicit-override check with passing evidence, and Intel also exercises the actual unsupported packaged target. There is no authored Cargo crate. These jobs validate the same merge result and formatting commit as Linux. Formatting check reporting includes native-platform failures. Use the ordinary suite's isolated Bun runner and 30-second test timeout for these targeted regressions, including the multi-command check/explain case.

`test:package` explicitly downloads production dependencies into an isolated consumer and fresh Bun cache. It packs the actual release files, disables install scripts, and runs `bunx` without Node, Cargo, or a native override on PATH. Keep this network-dependent release check in the read-only validation job; the ordinary test suite remains network-free.

The normal test step sets `BONSAI_SELF_CHECK_REPORT` to the runner's temporary directory. The native root regression saves its actual decision, snapshot, and command timings before assertions. Always upload that report as `bonsai-self-check` when available, retaining failures as well as successes for 14 days. This records existing verification, without another full check or changed deadline.

## Work Guidance

Never execute candidate scripts in write-capable jobs. Preserve checks on formatting commits. Keep website action versions pinned and preserve the separation between validation and deployment.

## Verification

Workflow lint and GitHub Actions. Website changes also require `bun run website:build` and `bun run website:check`.

## Child DOX Index

None. This file owns the full subtree.
