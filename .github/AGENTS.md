# Purpose

Guide pull request review, automate formatting, verify proposed changes, and publish the landing page.

## Ownership

`pull_request_template.md`, `workflows/ci.yml`, `workflows/action.yml`, `workflows/pages.yml`, and the development-only `workflows/rust-backend.yml`.

The root `action.yml` delegates checker execution and GitHub summaries to `action/run.ts`.

The reusable action installs its own frozen checker dependencies with scripts disabled, validates the Git root and exact PR or merge-group base, and reads the base configuration directly with Git. It runs the candidate CLI under those original configuration bytes and fails unless the exit code and validated report agree on a complete pass. Candidate package scripts and ambient policy overrides cannot select the checker or loosen its policy. Outputs and summaries preserve rejection and incomplete verdicts; the summary identifies the reviewed base commit.

`workflows/action.yml` verifies the composite action against independent pass/reject/incomplete consumers, asserting actual step outcomes and outputs. Its focused regression job runs the action, adversarial evidence, content identity, native-session content guards, diagnostics, scheduling, registry, and complete self-host tests and archives their actual root report. Its root measurement records the strict action failure without blocking stabilization; this exception belongs to this development workflow, never to the reusable action. The complete verification job and focused root regressions use the fixed `ubuntu-24.04-arm` reference runner; x64 consumer checks and supporting-runner checks retain their own coverage. Keep the saved 15-second deadline, full inventory, and every obligation unchanged when comparing timings across runners. External required-check examples must remain strict and require an independently protected workflow definition. A status-check name alone cannot prevent a candidate workflow from substituting a passing no-op. Document active required-workflow rules and the weaker trusted-owner-review alternative; do not claim automatic workflow protection from the Action pin or read-only token.

## Local Contracts

The PR template requires change classification before acceptance examples, distinguishing new or changed product rules, missing meaningful examples, and technical regressions. Refactors can preserve existing promises without adding BDD scenarios. Require explicit destinations for moved assertions, meaningful failure evidence, and separate contract-surface, ceiling, retained-size, and gate-verdict reporting. These are review prompts, not automated semantic eligibility checks.

Formatting and candidate validation have read-only tokens with no persisted credentials. Only isolated jobs apply patches, push branch updates, report check results, or deploy Pages. PR validation checks the merge result. The normal test step includes Bonsai’s executable feature contracts; a passing suite does not claim the root retained-code gate passes.

The website workflow runs `website:build` and `website:check` with read-only contents and Pages permissions. PRs never configure Pages, upload deployment artifacts, or deploy. Main-branch pushes and manual main-branch runs read existing Pages metadata and upload the checked `_site` output. Pages must already use GitHub Actions as its publishing source; the workflow does not enable or change repository settings.

The isolated deploy job has only `pages: write` and `id-token: write`, targets the `github-pages` environment, and deploys the uploaded artifact without a checkout or candidate commands. Other branches may be checked manually but cannot deploy.

Formatting covers Biome-managed files. Read-only validation installs the pinned native TypeScript checker through Bun and runs differential source comparisons, types, the full test suite, and the demo. There is no authored Cargo crate. Keep native analysis commands out of write-capable jobs.

`native-platforms` runs installation regressions on `macos-15-intel` (darwin-x64) and `macos-15` (darwin-arm64), asserting Bun's actual platform and architecture. Intel builds the immutable upstream tsrs revision matching the pinned SDK with its optimized `ci` profile without LTO; Apple Silicon uses its published package. Both require a real explicit-override check with passing evidence, and Intel also exercises the actual unsupported packaged target. There is no authored Cargo crate. These jobs validate the same merge result and formatting commit as Linux. Formatting check reporting includes native-platform failures. Use the ordinary suite's isolated Bun runner and 30-second test timeout for these targeted regressions, including the multi-command check/explain case.

`test:package` explicitly downloads production dependencies into an isolated consumer and fresh Bun cache. It packs the actual release files, disables install scripts, and runs `bunx` without Node, Cargo, or a native override on PATH. Keep this network-dependent release check in the read-only validation job; the ordinary test suite remains network-free.

`runner-adapters` separately runs `test:runners` with Bun and Node 24 in a read-only job. Its disposable consumer installs pinned framework versions and verifies actual Vitest/Cucumber/Stryker reports, coverage, and skipped-work rejection. Preserve formatted-commit validation and include this job in the reported formatting-commit conclusion. The ordinary suite remains network-free.

`report-browser` generates actual CLI reports and checks them in Chromium using `test/report-browser.ts`. Install Playwright 1.64.1 and its matching Chromium only in runner-temporary tooling directories; keep them outside the product dependency graph and package. The read-only job validates the formatting commit, blocks page HTTP(S) requests, exercises keyboard and explorer flows at desktop/mobile widths, and uploads screenshots, HTML, raw check JSON, and browser results for 14 days, including failures. Include its result in the formatting-commit conclusion. Browser assertions do not substitute for reviewing the screenshots; no pixel baseline or complete accessibility claim is implied.

The browser job enables `BONSAI_BROWSER_PREVIEWS=1` only for its fictional consuming fixture. It logs at most two viewport JPEG previews at quality 45 (desktop/mobile overview), with at most 200 kB of encoded log output total. Preserve full PNG artifacts; the bounded previews allow visual review through job logs when artifact downloads are unavailable. Never enable previews for private consuming-project data.

The native platform job also runs `test/cli-base-paths.test.ts` on both macOS architectures. Preserve coverage of physical and symlinked Git roots, worktrees, read-only inspection, invocation-relative policy paths, and rejection of actual subdirectories. Its real native checks use the same selected compiler override as installation regressions.

The normal test step sets `BONSAI_SELF_CHECK_REPORT` to the runner's temporary directory. The native root regression saves its actual decision, snapshot, and command timings before assertions. Always upload that report as `bonsai-self-check` when available, retaining failures as well as successes for 14 days. This records existing verification, without another full check or changed deadline.

CI emits a compact actual root verdict, observation completion, ancestry count, and timing summary from the already-saved self-check report before archiving it. This is measured diagnostic output, not another verification run or a changed feedback deadline.

`rust-backend.yml` is a separate read-only feasibility check. It installs the pinned optional Rust 1.86.0 rust-analyzer/rust-src components and runs a disposable Cargo/LSP probe. It does not enable production Rust analysis or change the ordinary package's toolchain requirements. Keep candidate execution credential-free and bound the probe's requests, output, and process cleanup.

## Work Guidance

Never execute candidate scripts in write-capable jobs. Preserve checks on formatting commits. Keep website action versions pinned and preserve the separation between validation and deployment.

## Verification

Workflow lint and GitHub Actions. Website changes also require `bun run website:build` and `bun run website:check`.

## Child DOX Index

None. This file owns the full subtree.
