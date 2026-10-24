# Performance

The native engine replaces the TypeScript program, binder, and checker with the
pinned tsrs implementation. The Bun frontend, token metric, graph rules, and real
verification remain shared. Reference comparisons run in development tests, outside
the production native command. See [the native boundary](native-prototype.md).

## Measure a complete check

```sh
bun run ./src/cli.ts check --root examples/checkout --verbose
bun run ./src/cli.ts check --root examples/checkout --verbose --json
```

Use the same root, policy, contracts, and engine for comparisons. Record the
decision and completed observations alongside time: skipping diagnostics or
interrupting verification changes the workload. JSON retains command and candidate
timings, including interrupted phases. Their endpoints differ from external wall
time and the policy feedback measurement; see [timing boundaries](design.md#timing-boundaries).

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

The existing TypeScript engine now avoids two repeated costs:

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

The benchmark runs fresh TypeScript and Rust CLI processes alternately against the
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

Reproduce the checkout workload with:

```sh
bun run native:bench --runs 5 --root examples/checkout --output work/checkout-benchmark.json
```

For an equivalent complete-root comparison, pass `--root` pointing to a disposable
copy with the same maintained files and an explicit 60-second feedback window.
Running the tool on the original root preserves its saved limit and records any
completion difference. These small samples establish improvement on the measured
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
the TypeScript engine and JSONC fallback as controls. This detects duplicated
startup even on machines fast enough to stay below the feedback ceiling.
