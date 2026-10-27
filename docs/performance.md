# Performance

Production analysis uses the pinned Rust tsrs program, binder, and checker. The Bun frontend, token metric, graph rules, and real
verification remain shared. Reference comparisons run in development tests, outside
the production native command. See [the native boundary](native-prototype.md).

## Measure a complete check

```sh
bun run ./src/cli.ts check --root examples/checkout --verbose
bun run ./src/cli.ts check --root examples/checkout --verbose --json
```

Use the same root, policy, contracts, compiler version, and measurement boundaries for comparisons. Record the
decision and completed observations alongside time: skipping diagnostics or
interrupting verification changes the workload. JSON retains command and candidate
timings, including interrupted phases. Their endpoints differ from external wall
time and the policy feedback measurement; see [timing boundaries](design.md#timing-boundaries).

## Current profiling priorities

`native:bench` protocol 3 records repeated fresh native checks, their individual
samples, fact consistency, and verification completion. It does not compare the
Rust default with its `--engine rust` compatibility spelling as different engines.
The TypeScript oracle lives only in development tooling.

The saved complete-root profile after test-harness compaction measured 6.39 seconds
of feedback: 4.47 seconds in verification and 1.81 seconds in source analysis.
The source total included 1.28 seconds in graph transfer, 340 ms of worker overhead,
62 ms of native program setup, and 99 ms of diagnostics. These nested measurements
must not be added to their enclosing source total. The run completed all 117
observations present in that revision under its 15-second policy.

The query-pruning pass below profiles that work and removes unused symbol requests.
The following verification pass removes redundant contract-compiler initialization.
Further verification work should target measured startup or transport costs while
preserving every handler call, sequential scenario semantics, and fresh compiler
programs. Result caching or parallel verification would change the workload.

## Prune unused semantic requests

On 2026-10-27, an external development preload observed native SDK requests and
nested CLI reports without modifying handlers or the published reporting format.
In the baseline root check, 28 nested CLIs accounted for 4.64 seconds of the
5.06-second verification phase, about 92%. One initial lexical worker and one
shared worker served a total of 20 fresh native programs. Across the 19 nested
programs, snapshot creation took 826 ms; symbol-query windows totaled 166 ms.
The root program's symbol-query window was 639 ms of its 1,483 ms graph phase.
Concurrent request waits overlap and must not be added as elapsed phases.

The adapter now requests symbols for identifiers, literal dynamic-import module
names, component declaration names, and conservative binding-loader target/callee
expressions. Ordinary strings and whole property expressions are not needed for
normal graph references; their property-name identifiers remain queried.
Repeated imports are grouped by module identity before asynchronous export
lookups, preventing duplicate requests within one analysis. No result survives
into another analysis.

Observed root symbol locations fell from 40,240 to 30,966, including the added
regression fixture; identical nested fixture workloads fell from 513 to 357.
Diagnostics, metadata requests, worker counts, and all 116 root observations were
preserved. The observer adds overhead: its after-run also slowed unrelated
contract compilation and file transfer, so those traced elapsed samples do not
establish a speedup or regression.

Uninstrumented measurements alternated fresh processes using baseline `906f6bf`
and the updated implementation, on Linux x64, Bun 1.4.3, and an Intel Xeon Platinum
8573C. Filesystem caches were not flushed. Median durations:

| Workload or phase | Samples per revision | Before | After |
| --- | ---: | ---: | ---: |
| Complete checkout check | 5 | 554 ms | 548 ms |
| Complete root check | 3 | 7,158 ms | 6,955 ms |
| Root source analysis | 3 | 2,098 ms | 1,830 ms |
| Root graph transfer, within source analysis | 3 | 1,529 ms | 1,261 ms |
| Root verification | 3 | 4,922 ms | 4,909 ms |

The unchanged checkout input had identical complete source facts, decisions,
ancestry, contracts, and evidence. Each root revision measured all 94 of its
maintained files, including its own implementation and tests; their contents
therefore differ. Contracts and all executed observation results matched, and
every root run completed under the unchanged saved 15-second feedback policy.
Both roots correctly rejected retained-size and ancestry violations.

A separate source-only comparison used one identical frozen root through the
baseline Rust collector, optimized Rust collector, and independent TypeScript
oracle. All source facts, derived ancestry, and policy results matched across
94 files, 530 components, and 1,245 relationships. No handlers ran or evidence
was created in that comparison; it establishes source conformance, not acceptance.

Graph time fell about 18%, but complete-check medians improved only about 3%.
Root wall-time ranges overlapped: 7.07–14.13 seconds before and 6.63–7.25 seconds
after. The checkout difference is small relative to sample variation. These
measurements establish reduced requests and a smaller graph phase on this
workload, not a guaranteed user-visible speedup. Verification remains the larger
target; its fresh native programs and required CLI executions still run.

## Reduce repeated contract compiler startup

The verification profile also attributed 538 ms to contract compilation across
18 nested checks. Each CLI loaded Gherkin's Messages 31 schema package and Bonsai's
separate Messages 32 schema package. Bonsai used the latter only for
`IdGenerator.incrementing()`, a small callback factory.

Contract compilation now supplies an equivalent local incrementing callback to
Gherkin's public AstBuilder and pickle compiler. Both receive the same callback,
reset once per feature file. Gherkin's parser, matcher, outline expansion, and
compiler remain unchanged. Removing the direct Messages dependency leaves only
Gherkin's compatible transitive version. Contract outputs, IDs, locations, example
rows, and unsupported-input diagnostics are preserved. No compiler, application,
or verification results are cached.

On 2026-10-27, alternating fresh Bun 1.4.3 processes compared baseline `cbd4ecf`
with this change on Linux x64 and an Intel Xeon Platinum 8573C. The baseline used
its own dependency copy so reinstalling the optimized dependencies could not
change the baseline workload. Filesystem caches were not flushed. Median times:

| Workload or phase | Samples per revision | Before | After |
| --- | ---: | ---: | ---: |
| Complete root check | 3 | 8,850 ms | 8,085 ms |
| Root verification | 3 | 6,056 ms | 5,296 ms |
| Root source analysis | 3 | 2,296 ms | 2,069 ms |
| Complete checkout check | 5 | 752 ms | 820 ms |
| Checkout contract compilation | 5 | 56 ms | 39 ms |

Root verification improved about 13% in these samples; total time improved about
9%. Each revision measured its own complete 94-file inventory using its own
installed dependencies, with identical contracts and all 116 observation results. Every sample completed
under the unchanged saved 15-second feedback limit and correctly rejected the
root's retained-size and ancestry violations. Nested commands and handler calls
still execute sequentially with fresh application modules and native programs.

The unchanged checkout input retained identical source facts, ancestry, contracts,
decisions, and evidence. Its full-check median was slower despite less contract
compilation work; ranges overlapped widely: 579–1,251 ms before and 574–1,493 ms
after. Root ranges were 8.40–9.98 seconds before and 7.20–8.25 seconds after.
Microbenchmarks of dependency loading also showed substantial scheduling/CPU
variation. These are workload-specific measurements, not a general speedup
guarantee or proof of a checkout regression.

A separate Rust-server reuse probe compared 31 edits to source, declarations,
imports, package resolution, ambient types, and project roots. Fresh independent
snapshots with full filesystem-cache invalidation matched fresh-process facts.
However, fresh program creation still dominated: the observed startup savings
were small and noisy, around 10 ms per analysis. Production retains its existing
fresh-process lifecycle; this pass removes redundant dependency initialization.

The measurements below describe earlier revisions, including the removed public
TypeScript engine and comparison-only 60-second fixture windows. Their historical
numbers remain evidence for those workloads; current commands use one native
engine and the saved project deadline.

## Historical compiler profile

A local pre-optimization source profile measured 6,587 ms for 79 maintained files,
414 components, and 838 relationships. TypeScript reported 1,447 ms for program
construction, 672 ms for binding, and 3,982 ms for checking. The 1,225 ms parser
measurement is contained in program construction, so it must not be added again.
These compiler operations account for most of this sample. Inventory, token
counting, and Bonsai's graph traversal are smaller targets. This instrumented local
sample identifies work to remove; its absolute duration is not a user benchmark.

Verification can repeat compiler loading and analysis when executable self-host
contracts spawn CLI processes. Full-command measurements must include those
processes and their required observations.

## Rust TypeScript checker research

Research checked official project sources on 2026-10-24. The strongest current
candidate is **[tsrs](https://github.com/oxc-project/tsrs)**, an actual Rust port of
the TypeScript compiler/checker/LSP. Cloudflare and VoidZero
[announced it on October 20](https://blog.cloudflare.com/typescript-rust-port/),
including plans to consolidate [tsc-rs](https://github.com/pingdotgg/ts-rust) with it.
Its [compatibility report](https://github.com/oxc-project/tsrs/blob/main/docs/COMPATIBILITY.md)
documents extensive conformance against a pinned TS7 compiler and remaining gaps.
That does not establish equivalence with Bonsai's TS5.9 compiler.

| Other candidate | Relevant limit |
| --- | --- |
| [tsz](https://github.com/tsz-org/tsz) | Real Rust checker; pre-release and explicitly not a drop-in replacement. |
| [Ezno](https://github.com/kaleidawave/ezno) | Real Rust checker; does not yet support enough features to check existing projects. |
| [STC](https://github.com/dudykr/stc) | Older Rust checker, archived March 12, 2025. |

Oxc parsing and lexical binding do not supply complete TypeScript checking.
[Oxlint's current type-aware engine](https://oxc.rs/docs/guide/usage/linter/type-aware.html)
uses the **Go** TypeScript implementation. [SWC](https://swc.rs/docs/migrating-from-tsc)
does not type-check, and [Biome's inference](https://biomejs.dev/blog/vercel-partners-biome-type-inference/)
implements a subset for lint rules. These capabilities cannot replace the compiler
diagnostics required by Bonsai.

## Isolated tsrs feasibility spike

The spike used Linux x64 GNU, Bun 1.4.3, Node 24.19.0, and the committed Bonsai
source at `93e57551740239b3906ec5d57fc40d732c0b7b97`, archived away from ongoing
edits. It downloaded npm `tsrs@0.18.0-ts7.1.0-dev.20260929` and its matching Linux
binary into an isolated directory, without changing production dependencies.
Both tarballs matched their npm SHA-512 integrity metadata. The package targets
TypeScript commit `b85298b6a81f772d080b0455de0ca9d744cd6fd6`; its version metadata
says TS7.1.0-dev.20260929, while its binary prints TS7.1.0-dev.20260930.4.

Three fresh processes per engine ran sequentially and alternated engines, without
flushing filesystem caches. Both launchers ran through Bun. Durations measure
compiler CLI completion, including startup; they exclude Bonsai collection and
runtime evidence.

| Workload | TypeScript 5.9.3 median | tsrs median | Result |
| --- | ---: | ---: | --- |
| Strict two-file import/alias fixture | 699.84 ms | 55.35 ms | Identical TS2322 diagnostic text and location. |
| Archived Bonsai with explicit Node typings | 3,105.42 ms | 98.28 ms | Both exit 0 with no diagnostics. |

Bonsai's individual samples were 3,105/2,973/4,060 ms for TS5 and 98/100/95 ms for
tsrs. Both listed 259 files, including exactly the same 47 checkout source files.
Timing varied; this compiler-only comparison is not a full-gate speedup or proof
of universal diagnostic parity.

The Bonsai comparison explicitly set `types: ["node"]` for **both** compilers.
With the original implicit type discovery, TS5 found Node declarations but tsrs
reported 415 diagnostics. The explicit setting restored the intended typing
workload. This difference itself requires a TS5-to-TS7 migration policy.

The published SDK exports `tsrs/unstable/sync` and `tsrs/unstable/async`. Current
source [Node API documentation](https://github.com/oxc-project/tsrs/blob/main/docs/NODE_API.md)
uses `tsrs/sync` and `tsrs/async`; those names are not exported by this release.
Its snapshot API is not compatible with TS5 `createProgram` objects.

Both SDK variants worked under Node 24: create a snapshot/project, collect semantic
diagnostics, traverse a remote AST, resolve an imported alias across files, query
and format its type, and resolve its declaration. Under Bun 1.4.3 the synchronous
SDK failed at `syncChannel.js:131` because `stdout._handle.fd` was undefined. The
asynchronous SDK initially reported a closed connection inside the managed
execution sandbox. Repeating the same probe with IPC allowed succeeded under Bun
1.4.3, including ASTs, diagnostics, aliases, types, and declarations. The asynchronous
SDK now runs Bonsai's native worker; no Node runtime dependency is required.

For an independent CLI trial, install the prerelease in an isolated directory:

```sh
mkdir -p work/tsrs-trial
cd work/tsrs-trial
cat > package.json <<'JSON'
{"name":"bonsai-tsrs-trial","private":true,"type":"module"}
JSON
bun add --exact tsrs@0.18.0-ts7.1.0-dev.20260929
bun ./node_modules/tsrs/bin/tsrs --noEmit --pretty false --project /absolute/project/tsconfig.json
```

Compare the same configuration with the project's existing `tsc --noEmit`;
preserve all diagnostics and inspect differences before comparing durations.
This installs a research tool under ignored `work/`, without adding a Bonsai
engine or changing its production dependencies.

The integrated adapter uses Bun's asynchronous SDK and batches native symbol/type
queries before running the shared graph rules. TypeScript supplies lexical parsing
and scanning, not a compiler program. Runtime tests trap JS compiler factories to
verify this distinction. Native compiler gaps remain explicit blockers: the pinned
release ignores source directives disabling default libraries, so Bonsai marks
those inputs incomplete. Local lexical-parser failures also block acceptance.

## Earlier internal optimizations

Before its removal from production, the TypeScript engine avoided two repeated costs:

- Verification imports inventory and fingerprinting from a compiler-independent
  module. Fresh evidence workers no longer load TypeScript unless the application
  itself needs it. Loading receipts, fingerprint checks, deadlines, and fresh
  application module caches remain required.
- TypeScript's DocumentRegistry reuses unchanged parsed files within one checker
  process. Every request rereads exact source/declaration text and creates a fresh
  compiler host and program, resolves imports again, and runs all diagnostics.
  No diagnostic, source-result, or evidence cache is written to disk. Only the
  preceding request's documents are retained, capped at 4,096 documents and 64 MiB
  of source text. Fresh CLI processes start without this cache; base and candidate
  analyses in one invocation can share library documents.

Those changes retained the full reference compiler. Their process-local reuse
helped repeated analyses and base/candidate comparisons, while lighter workers
helped only checks that actually reached verification. They did not remove the
compiler bottleneck from fresh root commands.

A Linux x64/Bun 1.4.3 comparison used baseline `93e5755` and the optimized tree on
2026-10-24. Each command launched a fresh process against the same checkout
example, alternating implementations for five samples each without flushing
filesystem caches. A second workload copied that project into a Git repository
and checked it against its unchanged `HEAD`. Every check passed all three
observations; decision, fingerprint, contracts, source facts, ancestry, and
evidence matched after removing timings. External wall-time medians:

| Complete check | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| `check --root examples/checkout --json` | 1,599 ms | 1,354 ms | 15% |
| Same project with `--base HEAD --json` | 2,202 ms | 1,537 ms | 30% |

Separate five-sample measurements of the same fixture found fresh evidence-worker
round trips falling from 242 ms to 27 ms. Repeated source analysis in a single
process, after one unrecorded warmup per implementation, fell from 867 ms to
88 ms. These smaller measurements explain the savings; they are not complete
command timings or a promise for larger projects. The native-checker spike above
measures different work and does not contribute to these implementation gains.

Regression coverage compares diagnostics, symbol targets, and complete source
facts with a fresh compiler through source edits and repairs, external declaration
changes, package resolution changes, newly created and deleted modules, ambient
type packages, and changing root sets. Real-worker tests verify complete evidence
without loading the compiler; CLI tests retain timing, deadline, stream, and
semantic color guarantees.

## Native complete-check measurements

The native implementation now runs the compiler only once through tsrs. The
unused Oxc prototype, Cargo metadata, and Rust sources were deleted. Its syntax
and token limitations therefore no longer gate the project. Rust source in other
projects remains explicitly unsupported; nothing was excluded to manufacture
self-hosting support.

Source timings retain measurement, program, diagnostics, and graph phases. Worker
startup, transport, and cleanup overhead are recorded separately. Native graph
work includes lexical AST mapping and batched semantic transfer, which can become
the next source-analysis bottleneck after type checking is removed.

The comparison harness used for these measurements ran fresh TypeScript and Rust CLI processes alternately against the
same inventory and policy, comparing decisions, source facts, and runtime
evidence. It retains mismatched results with structured details and exits 1 after
writing the report. It records every observation and completion state. An incomplete
or mismatched run cannot establish a completed-gate speedup. Root measurements also include nested
CLI checks: Bonsai's own bindings inherit the selected engine, so the backend being
measured performs those checks too.

On 2026-10-24, Linux x64 with Bun 1.4.3, an Intel Xeon Platinum 8573C, and five
available logical CPUs produced these external wall-time medians. Each sample
launched a fresh CLI process; filesystem caches were not flushed. Engines
alternated, and all timed facts and runtime evidence matched.

| Complete check | Samples per engine | TypeScript | Rust/tsrs | Reduction |
| --- | ---: | ---: | ---: | ---: |
| Checkout example, all 3 observations | 5 | 1,501 ms | 774 ms | 48% |
| Full Bonsai inventory, all 95 observations | 3 | 23,093 ms | 13,215 ms | 43% |

The full-root workload copied all 81 maintained files into a disposable project.
Both engines used that same inventory and saved configuration, with only that
fixture's feedback window set to 60 seconds so both could finish. The size budget
was unchanged. Every full-root sample correctly rejected its retained-size and
ancestry violations after executing all observations; every checkout sample passed.
The committed root's 15-second policy was not changed.

For the full-root workload, median source analysis fell from 2,986 ms to 1,622 ms.
Native program construction and diagnostics took about 169 ms combined, while
lexical mapping and graph transfer took 1,120 ms. Required verification fell from
19,403 ms to 11,274 ms as nested CLI checks inherited the selected engine. These
phase medians have separate measurement boundaries and need not sum to the median
external command time. Verification is now the largest remaining cost, followed
by native graph transfer.

A separate fresh pair used the actual root's saved 15-second policy. TypeScript
was incomplete at 15,325 ms external wall time; Rust completed all 95 observations
and correctly rejected the policy violations at 13,803 ms. The benchmark preserved
both results, reported the mismatch, exited 1, and set `completedCheckSpeedup` to
`null`. Unequal completion states do not establish a speedup.

Measure the checkout workload with the current native-only harness:

```sh
bun run native:bench --runs 5 --root examples/checkout --output work/checkout-benchmark.json
```

Those historical complete-root comparisons used disposable copies with identical
maintained files and an explicit 60-second comparison window. Current root
measurements preserve the saved 15-second policy; compare equivalent completion
states and workloads rather than reproducing the removed runtime engine. These small samples establish improvement on the measured
workloads, not a guarantee for other projects or machines. Complete feature
evidence does not erase ancestry or retained-size violations.

## Remove repeated native frontend startup

A subsequent user profile still exhausted the 15-second window: source analysis
took 2.1 seconds and verification was interrupted after 12.9 seconds. The earlier
four-second incomplete profiles had not executed verification. Those durations
cannot establish a completed-check regression or improvement.

The remaining repeated cost included loading the full JavaScript TypeScript
package in each project-aware CLI parent, then loading it again in its native
semantic worker. Bonsai's 23 self-host scenarios launch 24 real CLI commands;
17 of those commands previously loaded TypeScript in the parent. Moving compiler
dependencies behind the selected engine removes that unnecessary load. Standard
JSON objects use equivalent native configuration parsing; JSONC, malformed input,
and unusual property keys retain the exact reference conversion and diagnostics.
The lexical parser still loads in each semantic worker. No handler results or
evidence are cached, and every scenario still executes sequentially.

Fresh-process comparisons on the same Linux x64/Bun 1.4.3 environment alternated
the `f7ffa42` implementation and the updated implementation. Filesystem caches
were not flushed. External wall-time medians:

| Rust check | Samples per revision | Before | After | Reduction |
| --- | ---: | ---: | ---: | ---: |
| Identical checkout project, all 3 observations | 5 | 720 ms | 507 ms | 30% |
| Full Bonsai inventory, all 95 observations | 3 | 15,020 ms | 10,120 ms | 33% |

Checkout decisions, fingerprints, contracts, source facts, ancestry, and evidence
matched after removing timings. Root measurements used each revision's full
inventory: 81 files before and 82 after, including the new regression test.
The root contracts and all 95 executed observation results matched. Both revisions
used the same explicit 60-second comparison window and unchanged budget; their
source facts naturally differ where implementation and test files changed.
Complete root samples ranged from 13,636–16,282 ms before and 9,961–10,533 ms after.

Median parent setup fell from 255 ms to 43 ms. Median root verification fell from
13,006 ms to 8,411 ms; source analysis remained about 1.6–1.7 seconds. This change
targets repeated startup, rather than claiming another native compiler speedup.

Separately, the actual root under its saved 15-second policy completed every
observation when the CLI and all descendants were restricted to one CPU. Feedback
took 13,079 ms and reported command elapsed was 13,164 ms. The result still
correctly rejected retained-size and ancestry violations. CPU affinity is a local
stress check, not a guarantee for other hardware.

Regressions compare configuration values, prototypes, and exact syntax errors
with the reference parser. A runtime load guard forbids TypeScript in native CLI
parents with standard configs, observes its load in semantic workers, and uses
the then-available TypeScript engine and JSONC fallback as controls. This detects duplicated
startup even on machines fast enough to stay below the feedback ceiling.

## Reuse lexical startup during verification

On 2026-10-25, a further comparison against `29a2413` measured invocation-scoped
worker reuse. The same Linux x64/Bun 1.4.3 environment alternated fresh CLI
processes without flushing filesystem caches. Every required observation executed,
and all native compiler processes had closed before source facts were returned.

| Rust check | Samples per revision | Before | After |
| --- | ---: | ---: | ---: |
| Identical checkout project, all 3 observations | 5 | 511 ms | 494 ms |
| Full Bonsai inventory, all 95 observations | 3 | 9,107 ms | 5,408 ms |

The complete-root median improved by 41%. Root verification fell from 7,408 ms to
3,463 ms; source analysis was 1,529 ms before and 1,831 ms after. Each revision
measured its complete inventory: 82 files before and 85 after, including the new
implementation and tests. The root contracts and all 95 executed observation
results matched, with the same explicit 60-second comparison window and unchanged
budget. Root samples ranged from 8,945–9,125 ms before and 5,024–5,414 ms after.
Both revisions correctly rejected their real budget and ancestry violations.

The unchanged checkout input retained matching source facts, decisions, ancestry,
contracts, and evidence. Its small timing difference is within these samples'
variation; it remains roughly a half-second check. A lean local broker adds no
semantic worker until a nested native CLI requests one.

The shared Bun worker keeps lexical modules initialized. Every request still
re-reads files and declarations, creates a fresh SDK and native compiler process,
collects diagnostics, and waits for that process to close. Application module
caches remain isolated between verification runs; every action invocation executes.
The analysis worker caches no handler results, semantic snapshots, or evidence. The broker
exists only for the owning verification. Different runtime contexts and busy
workers retain the ordinary fresh native path.

A separate actual-root run restricted the CLI and all descendants to one CPU.
All 95 observations passed within the saved policy: 6,759 ms of feedback against
15,000 ms, with 6,819 ms reported command elapsed. This is a local stress check,
not a hardware-independent deadline guarantee. No committed limits or exclusions
changed.

Regressions observe one lexical-module load across repeated checks while requiring
six actual stateful handler calls and fresh application modules. Fresh reference
comparisons cover source, declarations, import targets, and maintained-root edits.
Protocol tests cover busy fallback through real verification, per-request diagnostic
bounds, request identity, strict response validation, context changes, cancellation,
and warm-owner death. A delayed shutdown proxy proves that success awaits native
process exit and that cancellation still reaps it after the SDK clears its handle.
