# Supporting verification and execution identity

Bonsai always runs its product observations. A project can additionally require
concrete supporting runners. Their results do not create contract ancestry or
increase the code allowance.

## Configure required runners

Add `runners` beside `maintained`, `bindings`, and `policy` in `bonsai.json`:

```json
{
  "runners": [
    {
      "id": "unit",
      "adapter": "vitest-json",
      "command": ["node", "node_modules/vitest/vitest.mjs", "run", "--reporter=json", "--outputFile=.bonsai/vitest.json", "--coverage", "--coverage.reporter=json-summary", "--coverage.reportsDirectory=.bonsai/coverage"],
      "report": ".bonsai/vitest.json",
      "coverage": { "report": ".bonsai/coverage/coverage-summary.json", "lines": 80 }
    },
    {
      "id": "acceptance",
      "adapter": "cucumber-messages",
      "command": ["node", "node_modules/@cucumber/cucumber/bin/cucumber.js", "--format", "message:.bonsai/cucumber.ndjson"],
      "report": ".bonsai/cucumber.ndjson"
    },
    {
      "id": "mutation",
      "adapter": "stryker-json",
      "command": ["node", "node_modules/@stryker-mutator/core/bin/stryker.js", "run"],
      "report": ".bonsai/mutation.json",
      "minimumMutationScore": 75
    }
  ]
}
```

Configure Stryker's JSON reporter to write the selected path. Configure each
framework's test selection and coverage scope explicitly, and review those inputs
with the policy. Install framework dependencies with Bun. Bonsai and its own
workers run under Bun; supporting commands may use the runtimes their frameworks
require. The explicit framework smoke check uses pinned Vitest 4.0.18, Cucumber
13.3.0, and Stryker 9.2.0. The smoke uses Bun for Cucumber and Node for
Vitest/Stryker; CI supplies Node 24.

Each command is an argument array, runs from the project root, and shares the
existing feedback deadline with source analysis and product verification.
Supporting runners execute in configured order. Failed product assertions do not
remove their obligations. Cancellation or an expired deadline stops active work
and prevents later commands from starting. Execution settings for Bonsai's own
scenario workers remain invocation choices, not project settings.

Use unique project-relative report paths. Reports and coverage summaries must be
regular files with no symlinked path components, at most 16 MiB each. Bonsai
removes previous reports before launching the command and reads their replacements
only after it exits. Generated reports should stay outside authored inventory;
initialization already proposes `.bonsai` as an excluded output directory. A
maintained input changed by a runner still invalidates the check.

## What blocks the configured gate

Missing reports, malformed formats, nonterminating commands, abnormal exits,
inconsistent summaries, empty runs, and missing execution identities cannot pass.
The adapters inspect individual results instead of trusting a top-level success
flag. Unsupported report versions remain incomplete.

- **Vitest JSON:** every reported assertion must pass; pending, skipped, todo,
  failed suites, and hook failures remain blocking. Summary counts must agree
  with the assertions. Optional Istanbul JSON-summary floors use measured
  covered/total counts for lines, branches, functions, and statements.
- **Cucumber Messages:** supported protocol families are 31.x and 34.x. The
  stream must contain a completed run and correlated starts/results/finishes for
  every declared case and step. Skips, pending or undefined steps, unfinished started hooks,
  failures, and retried attempts remain blocking.
- **Stryker JSON:** supported mutation-report schema families are 1.x and 2.x.
  The score is detected / (detected + undetected): killed/timeouts are detected;
  survived/no-coverage mutants are undetected. Pending, invalid, and ignored
  mutants remain blocking under this adapter's strict completion rule. A
  nonzero valid denominator and an explicit `minimumMutationScore` are required.

Quality floors range from 0 to 100. A missing or zero coverage denominator is
incomplete. These floors describe the report's configured scope; they do not prove
coverage of the full maintained inventory, specification completeness, necessity,
or exclusive fixture ownership. Coverage and mutation facts remain distinct from
static references and passed product observations.

## Versioned facts

Snapshots use `bonsai-snapshot-v1`. Product evidence now uses
`bonsai-evidence-v2`, with a required `bonsai-execution-v1` identity. Supporting
runner reports use `bonsai-runner-evidence-v1`. Regenerate older product evidence;
the original evidence-v1 envelope does not satisfy the new identity requirement.

The checker validates nested serialized snapshot facts before returning a
collected report. Pure structural snapshots can omit execution identity, but
policy cannot pass without matching candidate/product evidence identities and
matching identities for every required supporting runner.

The execution identity records installed checker source and manifest content,
selected native binary and installed SDK/lexical-toolchain content, Bun version,
and a digest of Bun/Node preload environment options. Paths do not define content
identity, so unchanged installed copies can move. Candidate-local packages cannot
replace the checker's resolved toolchain. Root lockfile presence/content and the
effective project configuration remain bound through the candidate fingerprint.
The final integrity check also detects changes to the checker or toolchain.
Native analysis captures the context before work and checks it afterward.
Application workers independently compare checker bytes and Bun/preload context,
and carry the parent's validated compiler receipt: they do not run that compiler.
Warm native scopes bind loaded checker/SDK/lexical code content, so changed code
at unchanged paths needs a fresh worker. This shares initialization, never source
facts or application evidence.

Bonsai refuses report destinations that overlap maintained inputs before report
cleanup or execution, including existing filesystem aliases. Supporting commands
still run with the caller's privileges and can themselves modify files; this is
not a write sandbox.

These are content identities and locally collected execution facts. They do not
authenticate hostile worker messages, attest every installed dependency or
external service, or turn ordinary subprocesses into a sandbox. Trusted merge
admission still needs independently protected checker/policy inputs, isolated
candidate execution, authenticated publication, and required checks for the exact
combined tree. Demonstrating combined-budget evaluation alone does not deploy
that trust boundary.

## Verify adapter compatibility

`bun run test` stays network-free. Run `bun run test:runners` explicitly to install
the pinned framework CLIs into a disposable consumer, generate its lockfile, then
install with that frozen lock and exercise fresh passing/skipped reports, coverage,
and mutation results. CI runs this in a separate read-only job with Node 24.
