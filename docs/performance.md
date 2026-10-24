# Performance

TypeScript compiler work and repeated verification processes are the main targets
for improving `check`. The Rust structural collector still runs after the complete
TypeScript reference in compatibility mode, so faster Rust parsing alone cannot
remove that cost. See [the native collector boundary](native-prototype.md).

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
asynchronous SDK reported `API server connection lost: server closed the
connection`. These bounded probes did not diagnose the asynchronous failure.
The tsrs CLI itself worked through Bun.

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

Adoption needs a compatible Bun transport or Node sidecar, an AST/checker adapter,
batching, and differential checks for diagnostics, retained components, tokens,
relationships, and source locations. An integrated native checker must replace
the reference pass to realize its compiler gains while preserving evidence and
admission requirements.

## Internal optimizations and complete-check results

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

The same source timings now expose retained-size measurement, compiler setup,
type checking, and dependency graph collection in JSON and `--verbose`. Rust
compatibility includes an additional comparison phase; it still runs the full
reference and does not become a faster native default.

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
