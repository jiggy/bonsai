# Rust collector prototype

The Rust/Oxc prototype evaluates whether native source collection can reduce
Bonsai's feedback time while preserving its facts. `check` and `explain` offer an
experimental `--engine rust` compatibility mode through the existing Bun CLI.
The default engine remains `typescript`. Build the Rust binary from a source
checkout; the npm package does not bundle it.

Oxc supplies parsing and lexical symbol analysis. Compatibility mode also runs the
full TypeScript reference collector, including compiler diagnostics, and compares
its facts with Rust's on the same input. Verification runs only after the facts
match and all analysis succeeds. The Rust binary itself supplies neither compiler
diagnostics nor runtime evidence.

## Build and evaluate

Use the repository's Bun version and Rust toolchain pinned in
`rust-toolchain.toml` (1.99.1). The crate pins Oxc 0.155.0 and checks in its Cargo
lockfile. Cargo may download the pinned toolchain and dependencies on the first run.

```sh
bun install --frozen-lockfile
bun run native:build
bun run native:test
mkdir -p work
bun run native:compare work/native-parity.json
bun run native:bench --runs 5 --size 64 --output work/native-benchmark.json
```

`native:build` produces a locked release build. `native:format:check` checks Rust
formatting. The default binary is under `native/target/release/`. The CLI resolves
that default against the checker checkout, independently of the selected project
and caller's working directory. `CARGO_TARGET_DIR` and an explicit
`BONSAI_NATIVE_BINARY` path can select another build. Build before running Rust;
the CLI and harnesses never compile or download a missing binary automatically.

Both reports print JSON to stdout and can save the same report to the specified
path. A parity mismatch fails the comparison command. The benchmark also verifies
parity before recording timings. `work/` and generated `native/target/` are excluded
from Bonsai's inventory.

## Run the existing CLI with Rust

Compare the same verbose check through both engines:

```sh
bun run ./src/cli.ts check --engine typescript --verbose
bun run ./src/cli.ts check --engine rust --verbose
```

The root remains incomplete: authored Rust is measured and its ancestry is
unsupported. Rust's bounded TypeScript collector may report additional unsupported
forms in this codebase. Use the supported checkout example to compare a complete
check, including real contract execution:

```sh
bun run ./src/cli.ts check --root examples/checkout --engine typescript --verbose
bun run ./src/cli.ts check --root examples/checkout --engine rust --verbose
bun run ./src/cli.ts explain src/checkout.ts --root examples/checkout --engine rust --json
```

Both engines use the same report and terminal presentation code: flags, verbosity,
colors, wrapping, stream routing, plain columns, exit codes, and evidence execution
keep their existing meanings. Recovery commands preserve an explicit engine choice,
including when a check suggests `explain`. `explain` never runs handlers.

Rust-mode JSON adds `analysis` metadata identifying `engine: "rust"`,
`validation: "typescript-reference"`, and a status of `matched`, `unsupported`, or
`mismatch`. A match establishes equality of the compared source facts for that
input. It does not guarantee universal TypeScript compatibility or byte-identical
reports: measured durations, explicit engine arguments, and unsupported findings
can differ.

Unsupported native analysis or mismatched facts produce an incomplete gate and
skip verification. Provisional inventory and source facts remain available from
the TypeScript reference; they cannot turn a failed Rust analysis into a pass.
A missing, crashed, or malformed native worker produces a runtime error with exit
1 and a repair instruction. Help and version work without a Rust build.

Compatibility mode deliberately runs both collectors. Its source phase and full
command timings include the reference comparison, and it can be slower than the
default. This mode supports direct CLI and compatibility testing; migration still
requires measured improvement of complete checks with equivalent responsibilities.

A complete-CLI sample ran `check --root examples/checkout --verbose --json` three
times per engine, alternating fresh processes without flushing the filesystem
cache. Both engines passed with identical source facts. External wall-time medians
were 1.46 seconds for TypeScript and 1.72 seconds for Rust compatibility mode;
median source phases were 0.85 and 1.08 seconds, respectively. These small-workload
samples show no full-command improvement and do not justify changing the default.
The verbose command profile makes the same measurement boundaries available
locally; the structural-only benchmark below measures a different workload.

## What parity establishes

Eleven supported fixtures compare exact file and component token costs, component
identities and locations, static reference edges and their source locations,
registered actions, and binding registry facts. They cover checkout behavior,
import aliases and unused siblings, a dead cycle and uncontracted registration,
tests that cannot root unused production, lexical shadowing, shorthand properties
and destructuring, type references, selected namespace exports, and Unicode costs,
offsets, and line terminators. Six unsupported fixtures require their intended
blockers for computed imports, spread registrations, an unused missing named import,
decorators, ambient declaration files, and local dependencies outside the inventory.

The harness also compares derived ancestry and policy decisions under identical
**assumed fixture observations**. These are evaluator inputs, not executed contract
evidence. A matching report does not prove that handlers ran, that all TypeScript
programs are supported, or that the prototype can replace the default collector.

The supported syntax is deliberately bounded. Dynamic imports, unsupported export
or registration forms, decorators, ambient `.d.ts` files, escaping namespace values,
and unresolved local dependencies remain problems. Per-file symbol analysis does
not link TypeScript ambient globals. Bare package imports and aliases are also
unsupported; the prototype has no TypeScript package or `tsconfig` resolver. Explicit
`node:` imports are recognized as external runtime dependencies. The token metric
rejects forms it cannot reproduce, including interpolated templates, rather than
silently discounting their cost. Consult the fixture corpus when extending syntax;
a mature parser alone does not supply Bonsai's registration, dependency, or
retained-cost semantics.

## Process protocol

The binary reads one JSON request per stdin line and writes one JSON response per
stdout line. A process can handle sequential requests:

```json
{"protocol":1,"root":"/absolute/project","files":["handler.ts","bindings.ts"],"bindings":"bindings.ts"}
```

A response includes `protocol: 1`, `source` facts, `structuralComplete`,
`typescriptDiagnostics: "not-run"`, and `elapsedMs`. Structural completeness means
the collector reported no structural problems; it does not mean the gate is
complete. Protocol or request failures return an `error`. No compiler diagnostics,
verification observations, or admission result are supplied by this protocol.

## Reading benchmark results

The benchmark uses the checkout fixture and a generated workload with 64 additional
modules by default. `--size` accepts 1–512 modules; `--runs` accepts 1–20 warm
samples and selects up to three cold samples. Reports retain individual samples,
minimum/median/maximum durations, environment details, toolchain/dependency identity,
and source and binary hashes.

Three engines run on identical fixture inputs:

| Engine | Work measured |
| --- | --- |
| `typescriptFullCollector` | Current source collector, including TypeScript diagnostics. |
| `nativeStructuralCollector` | Rust structural facts without TypeScript diagnostics. |
| `typescriptDiagnosticsOnly` | TypeScript compiler program and diagnostics without Bonsai's structural collection. |

Cold samples launch a fresh process; they do not flush the operating system's file
cache. Warm samples reuse one process after an unrecorded warmup, with sequential
requests that reread and analyze files each time. There is no source-result cache.
`roundTripMs` includes serialization, protocol transport, file I/O and response
parsing, plus process startup for cold runs. `workerMs` measures work inside the
worker and excludes startup and request-line transport. Fixture parity preparation
is reported separately from engine samples.

These workloads measure collection, not evidence execution or the full `check`
command. Engine responsibilities differ; a native-to-TypeScript ratio is not an
equivalent full-gate speedup. Diagnostics-only timings expose a separate remaining
cost, but are not a replacement for measuring an integrated implementation. The
strict `--engine rust` compatibility mode runs both collectors, so these native
structural timings do not predict its command duration.

### Measured sample

The 2026-10-23 21:54:22 UTC run used Linux x64, an Intel Xeon Platinum 8573C with
five logical CPUs available, Bun 1.4.3, TypeScript 5.9.3, Rust 1.99.1, and Oxc
0.155.0. Its preflight matched all 11 supported fixtures and reported all six
expected unsupported cases, with zero mismatches. Each engine recorded three cold
and five warm samples. Median request round trips, in milliseconds:

| Workload | Engine | Cold | Warm |
| --- | --- | ---: | ---: |
| Checkout: 4 files, 3 components | TypeScript full collector | 997.44 | 453.38 |
| Checkout | Native structural collector | 2.37 | 0.285 |
| Checkout | TypeScript diagnostics only | 1078.47 | 359.09 |
| Scaled: 68 files, 130 components | TypeScript full collector | 1324.91 | 828.83 |
| Scaled | Native structural collector | 14.16 | 10.90 |
| Scaled | TypeScript diagnostics only | 1289.32 | 701.80 |

These are one environment's small-workload samples. Separate processes and sample
variation mean the diagnostics-only timing is not a quantity to subtract from full
collection. Native timings omit those diagnostics entirely and establish no
full-check performance claim. The generated JSON retains every sample and the
remaining provenance; the measured binary's SHA-256 was
`38371f535b297e63df3909402eb793c5065a3a08922547106db31968a4e984d0`.

## Self-hosting and adoption

The Rust source is authored project material and stays in Bonsai's maintained
inventory. The default TypeScript collector measures it and reports explicit
`Unsupported source language` blockers until a Rust ancestry adapter exists.
The root check therefore remains incomplete and does not run evidence. The test
suite requires exactly those known blockers, so they cannot hide new TypeScript or
binding-loader failures.

A second regression copies the explicitly selected non-Rust inventory into an
isolated fixture and runs its actual CLI through every root feature contract. Its
test-only 60-second feedback window leaves the committed root policy unchanged;
its real retained-code overage still rejects. Neither this fixture nor native parity
claims root acceptance.

Adopting a native core requires expanded parity on representative projects and
unsupported cases, preserved TypeScript diagnostic and candidate-bound evidence
guarantees without repeating the full reference collector, Rust ancestry support
for Bonsai's own maintained source, and measured cold and warm improvement of
complete checks under the saved feedback policy.
CLI reports, failures, exit codes, and inventory scope must retain their current
meaning throughout that transition.
