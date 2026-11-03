# GitHub Action

Use Bonsai as a required check to block pull requests whose combined merge
candidate exceeds the project's retained-token allowance. Growth within the
allowance can pass. A reduction that still leaves the project over budget fails.

The action also fails on failed behavior, unrooted production code, incomplete
analysis, missing or mismatched evidence, invalid configuration, and execution
errors. Only a complete Bonsai pass succeeds. There is no allowance override in
the action.

## Licensing

The adapter files `action.yml` and `.github/action/run.ts` use the
[MIT license](../LICENSE-ACTION). The Bonsai checker they invoke, including
shared source imported from `src/`, is separately licensed under
[Bread License 1.0](../LICENSE.md). Downloading the Action does not buy a Bonsai
company license or extend the adapter's MIT grant to the checker.

Personal non-business use, genuine evaluation, and qualifying business use below
US$1 million in consolidated Group annual revenue are free. Ordinary development
and CI at or above that threshold need paid or existing permission; see
[Bonsai's price schedule](../PRICING.md). Generic runner-infrastructure charges
do not themselves buy that permission.

For ordinary purchased coverage, pin the reviewed full source commit identified
by a covered official release. Later uncovered releases need applicable
permission even when a moving tag selects them automatically. Raw development
snapshots remain available under applicable free permissions or a separate grant.
The earlier `v0` release retains its previous terms; a new official release
containing the adoption must be published before its company-purchase coverage
can be used. The [component notices](../LICENSES.md) explain distribution and
source obligations.

## Add it to a repository

First initialize Bonsai, connect the real application handlers, and commit the
reviewed `bonsai.json`, bindings, and executable contracts to the base branch.
A base without configuration fails; the action does not silently fall back to
the PR's proposed rules.

Replace `<reviewed-release-commit-sha>` with the chosen release's full source
commit, then save this as `.github/workflows/bonsai.yml`:

```yaml
name: Bonsai
on:
  pull_request:
  merge_group:
permissions:
  contents: read
jobs:
  allowance:
    name: Bonsai allowance
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2
        with:
          bun-version: 1.4.3
      - run: bun install --frozen-lockfile --ignore-scripts
      - name: Check Bonsai allowance
        id: bonsai
        uses: jiggy/bonsai@<reviewed-release-commit-sha> # Replace with a covered release's full SHA.
      - name: Save Bonsai report
        if: always() && steps.bonsai.outputs.report-path != ''
        uses: actions/upload-artifact@v4
        with:
          name: bonsai-report
          path: ${{ steps.bonsai.outputs.report-path }}
          retention-days: 14
```

A protected gate requires a workflow definition controlled outside the candidate
PR. Configure an organization or enterprise ruleset with **Require workflows to
pass before merging**, select the maintained source repository, protected ref,
and workflow path, target the destination branch, and set enforcement to
**Active**. Keep the source workflow and its Action SHA pin under trusted
maintainer control, and do not grant contributors a ruleset bypass. The example
above can serve as that required source workflow. GitHub documents
[required workflows](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-workflows-to-pass-before-merging)
and their [event and source-repository requirements](https://docs.github.com/en/enterprise-cloud@latest/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/troubleshooting-rules#troubleshooting-ruleset-workflows).

Requiring only the **Bonsai allowance** status-check name is insufficient:
a PR can keep that name and replace its candidate-controlled workflow with a
successful no-op. A full Action SHA pin and read-only token do not prevent the
workflow from omitting the Action altogether. An independently required source
workflow must still run and pass even if a PR removes or replaces its local
workflow.

Before relying on the gate, open a disposable PR with a known Bonsai rejection
and replace its local workflow with a successful no-op using the same job name.
Confirm that the independently required source workflow still runs Bonsai,
reports the rejection, and blocks merging. A green same-name job must not satisfy
that requirement. If this probe can merge, repair the ruleset before treating the
check as a protected gate.

Where required-workflow rules are unavailable, require trusted code-owner
approval for workflow files and the `CODEOWNERS` file itself, dismiss stale
approvals, and require approval after the latest push. This is a gate that depends
on trusted review of workflow changes, not equivalent automatic protection
against a substituted workflow. See
[CODEOWNERS and branch protection](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-and-branch-protection).
Without either enforced workflow ownership or a protected required-workflow
definition, use this check as feedback; do not treat its name as an unbypassable
merge restriction.

Require an up-to-date branch or use a merge queue. A failing action alone does
not configure GitHub's merge permissions. Run the required workflow for every PR;
avoid path filters, job conditions, and `continue-on-error` on the allowance check.

The default PR checkout is GitHub's test merge commit; do not replace it with
the PR head. `merge_group` checks the queued merge candidate. Full history makes
the exact base revision available, including for fork PRs.

The dependency step prepares the consuming application. The action separately
installs its checker dependencies from its own frozen lockfile, disables install
scripts, and invokes its own CLI directly. It does not run the candidate's
`bonsai` package script or depend on a published npm release. If the consuming
application needs generated assets, prepare those explicitly in the same
read-only job.

## Inputs and outputs

| Input | Default | Purpose |
| --- | --- | --- |
| `working-directory` | `.` | Git repository root containing `bonsai.json`; relative to the workspace or absolute |
| `base` | PR base SHA or merge-group base SHA | Exact reviewed revision supplying policy and maintained inventory |
| `serial` | `false` | Set to `true` for ordered scenarios sharing application state |

For push or manual workflows, pass `base` explicitly. A missing or unavailable
base fails with repair guidance. Subprojects inside a larger Git repository are
not supported by the CLI's base comparison; check a repository root.

| Output | Meaning |
| --- | --- |
| `status` | `pass`, `reject`, `incomplete`, or `error` |
| `exit-code` | Original CLI exit code, when the CLI ran |
| `retained-tokens` | Candidate's full retained cost |
| `allowance` | Global ceiling under the base policy |
| `required-reduction` | Tokens to reclaim to fit that ceiling |
| `report-path` | Absolute path to the raw JSON report, suitable for artifact upload |

The job summary shows the verdict, measured tokens, allowance, required
reduction, reviewed base commit, and blocking findings. Incomplete measurements are labeled
provisional. A malformed report or disagreement between report and CLI exit code
fails with `status: error`; it cannot produce a passing verdict. Outputs and
reports remain available after an ordinary rejected or incomplete check.
Dependency installation failures fail the action before a CLI report exists.

## Policy and execution boundaries

The action resolves the base to an exact commit and reads its `bonsai.json`
with Git. It preserves the original configuration bytes, including JSON comments,
and runs the real candidate `check` with that reviewed configuration as
`--policy`. The CLI supplies configuration validation, inventory, token accounting,
and acceptance. No base handlers execute and no base dependencies are installed.

The exact base supplies policy and inventory. Candidate edits to limits,
maintained paths, or saved exclusions cannot relax that run. The wrapper clears
ambient `BONSAI_POLICY`, `BONSAI_BASE`, and `BONSAI_ROOT` overrides and supplies
the selected root and base explicitly. Intentional policy or inventory changes
need their own review and take effect when adopted into the trusted base.

Pin Bonsai to a reviewed full commit SHA containing `action.yml`, identified
by an official release covered by your applicable permission. Publishing source
or changing a branch does not itself publish that release; no `v1` is implied.
Protect the consuming workflow and review contract changes: the action cannot
judge whether newly added observations describe warranted product behavior.

Candidate handlers still execute with the runner's privileges. Use an ephemeral
GitHub-hosted runner, a read-only token, no persisted checkout credentials, and
no secrets. Do not execute PR code under `pull_request_target` or in jobs with
write permissions. Process separation is not a hostile-code sandbox or an
independently published trusted admission service. The current TypeScript and
native-platform limits still apply; the example targets supported Linux x64.

Bonsai's own CI exercises this action against passing, rejected, and incomplete
consumers and publishes the real root verdict. During stabilization its
documented root overage remains a non-blocking development measurement. That
repository workflow exception does not change this action's strict result or
the recommended required-check workflow above.

Candidate handlers execute in a separate worker heap inside each application
subprocess. No verifier IPC descriptor is inherited. Bootstrap input is closed
before candidate startup; a private native message port carries selected values.
The subprocess main runtime keeps a fresh authentication key outside the candidate
heap, terminates that runtime, then writes an authenticated result file. The
verifier checks it after successful process exit. Assertions and
evidence serialization stay in the verifier. There is no signing key in the
candidate heap, and public parent-port posts are ignored. The private port is
started and its native operations captured before binding import, so replacement
of port methods during initialization cannot acquire it. This protects the
JavaScript evidence path from transport replacement, prototype setters, and heap
key recovery. It does not sandbox runner privileges, files, or native debuggers;
the permissions and isolation limits above still apply.

