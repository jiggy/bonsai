# Native TypeScript checker

`check --engine rust` and `explain --engine rust` use the Rust TypeScript compiler
[tsrs](https://github.com/oxc-project/tsrs) through the existing Bun CLI. The native
path supplies diagnostics and symbol resolution without running the JavaScript
TypeScript compiler program first. The default engine remains `typescript`.

## Install and run

Use Bun 1.4.3 or later and install the committed dependencies:

```sh
bun install --frozen-lockfile
bun run ./src/cli.ts check --root examples/checkout --engine rust --verbose
bun run ./src/cli.ts explain src/checkout.ts --root examples/checkout --engine rust --json
```

The package pins `tsrs@0.18.0-ts7.1.0-dev.20260929`, including its platform binary
and standard libraries. Its bundled compiler targets TypeScript 7.1 development
sources; Bonsai's reference engine uses TypeScript 5.9.3. The CLI, asynchronous
SDK, and fresh verification subprocess run through Bun. Node and a Rust toolchain
are not required.

Published native binaries cover Linux x64 and arm64 with GNU or musl libc, and
macOS arm64. Windows and macOS x64 are not supported by this pinned package.
Missing optional dependencies or an unsupported platform produce a runtime error
with a repair instruction. Install dependencies before checking; commands never
download or compile a missing checker automatically.

`BONSAI_NATIVE_BINARY` can select an absolute path to a matching tsrs API-server
binary, independently of the selected project and caller directory. An inherited
`TSRS_BINARY` is cleared at the Bonsai worker boundary. This override no longer
accepts the removed Oxc collector executable. If an older setup exports that
path, unset it before using the packaged checker:

```sh
unset BONSAI_NATIVE_BINARY
bun install --frozen-lockfile
bun run ./src/cli.ts check --engine rust --verbose
```

The former authored Rust/Oxc prototype, Cargo build, and local Rust toolchain pin
have been deleted. `CARGO_TARGET_DIR` no longer selects Bonsai's checker. On a host
without the GNU binary's dynamic loader, a matching static-musl binary may be
selected through `BONSAI_NATIVE_BINARY`.

## Analysis and verification

The native backend creates a program from the maintained TypeScript roots and
the same compiler options used by the reference collector. It preserves automatic
ambient-type discovery explicitly when bridging to TS7. It collects configuration,
options, syntax, binding, global, and semantic diagnostics. Batched native symbol
queries resolve declaration targets, aliases, type references, and selected module
properties for Bonsai's retention graph.

Bonsai still uses TypeScript 5.9's lexical scanner and local AST parser for its
retained-token metric, source locations, and structural collection rules. These
helpers do not create a TypeScript compiler program, bind symbols, or check types
on the native path. They keep the existing size metric and graph accounting
consistent while the native compiler supplies semantics.

Both engines use the same contract compilation, ancestry, policy evaluation,
terminal presentation, and evidence execution. Flags, colors, wrapping, stream
routing, plain columns, exit codes, and recovery commands retain their existing
meanings. `explain` never runs application handlers. Native analysis applies to
both base and candidate when `--base` is selected.

During verification, nested native CLI commands may reuse a lexical worker within
the owning invocation. A private local broker starts that worker only for the first
nested request, then closes it when verification finishes. Each request still
re-reads source and declarations and starts a fresh SDK, native compiler process,
and program. Application module caches stay within their own verification run;
the analysis worker caches no handler responses, evidence, or semantic snapshots.
Scenarios and handler calls retain their execution order.

Reuse requires the same installed checker, binary selection, and compiler runtime
environment, including preload options. Concurrent callers
that encounter a busy worker use a fresh native worker; failed matching sessions
remain errors. Every response carries a request identity and must pass the same
strict collector validation before reuse is acknowledged. Cancellation, incomplete
frames, and unaccepted responses retire the worker. Transport and cleanup retain
the existing deadline and timing boundaries. This changes no public flags or JSON
fields and does not start a persistent daemon.

The SDK closes its input stream before its process exits. Bonsai retains that
process handle and waits for actual closure before returning source facts;
cancellation can still kill and reap it during shutdown. Shared transport bounds
request frames at 4 MiB, output frames at 64 MiB, and diagnostics at 64 KiB per
request. Normal scope cleanup removes the private socket directory. Force-killing
an owner before its lazy worker starts can leave an inert directory; the operating
system closes its listener.

Only successful analysis can continue to required verification. Compiler errors,
unsupported source, incomplete semantic queries, and interrupted work cannot
produce a passing fallback. A missing, crashed, or malformed worker is a runtime
failure with exit 1. Help and version do not need to start the native checker.
The native backend and its SDK still execute with the caller's filesystem
privileges; their subprocess boundary is not a sandbox for untrusted candidates.

Rust-mode snapshots include:

```json
{
  "analysis": {
    "engine": "rust",
    "backend": "tsrs",
    "validation": "native-diagnostics",
    "status": "complete",
    "version": "0.18.0-ts7.1.0-dev.20260929"
  }
}
```

`status` is `complete` or `unsupported`. Complete source analysis does not establish
contract success or policy acceptance; the gate still requires matching runtime
evidence, ancestry, retained size, and feedback time. Timing reports retain native
analysis phases beneath source analysis, including interruptions. Different
compiler versions may report different diagnostics. This experimental backend does
not promise universal equivalence with TS5.9.

## Compare the engines

```sh
mkdir -p work
bun run native:compare work/native-parity.json
bun run native:bench --runs 3 --output work/native-benchmark.json
bun run native:bench --runs 3 --root /absolute/project --output work/project-benchmark.json
```

`native:compare` runs the full reference and production native collector on the
same fixture corpus. It compares diagnostic strings, file and component token
costs, component identities and locations, relationship targets and provenance,
registry actions, and binding facts. The corpus covers aliases, unused siblings,
dead cycles, tests that cannot root production, lexical shadowing, destructuring,
type references, namespace exports, Unicode, ambient declarations, decorators,
invalid imports, unsupported registration forms, and unmaintained dependencies.

Derived ancestry and policy decisions are compared under identical **assumed
fixture observations**. Those inputs are not executed evidence and cannot
establish gate acceptance. The normal suite separately tests actual CLI checks,
verification outcomes, timeouts, cancellation, and terminal presentation. A
comparison mismatch exits 1. Both development tools print JSON and can save it to
the requested path. Reference comparison is a development check, not work repeated
inside production `--engine rust` commands.

## Measure fresh checks

`native:bench` launches a fresh CLI process for every sample, alternating engines
on the same project and saved policy. `--runs` accepts 1-20 samples per engine
(default 3); `--root` defaults to `examples/checkout`. The former synthetic `--size`
workload has been removed. The harness compares source, contract, decision,
ancestry, and evidence facts after removing timings and explicit engine metadata.
It does not raise a policy limit. Mismatches retain both engines' measurements,
record structured details, and exit 1 after writing the report.

Reports retain individual samples, minimum/median/maximum external wall times,
command timings, expected and passed checks, verification completion, and runtime
details. Cold means a fresh process without flushing operating-system filesystem
caches. External wall time includes process startup, serialization, output delivery,
and cleanup; published command and feedback timings retain their own boundaries.

`completedVerification` identifies whether every timed run collected complete
verification evidence. `completedCheckSpeedup` is a median ratio only when every
run completed verification and all compared facts matched; it is `null` for
incomplete verification or a mismatch. Skipped or interrupted checks remain
visible and do not establish a completed-check speedup. See
[performance measurements](performance.md) for measured results and their scope.

## Scope and self-hosting

The compiler implementation is supplied by the installed tsrs dependency. Removing
Bonsai's obsolete authored Rust collector removes those files from the repository
by deletion, not by excluding retained source or inventing contract ancestry.
Other projects' authored `.rs` files remain measured and explicitly unsupported
until Bonsai has a Rust ancestry adapter. Selecting a Rust implementation of the
TypeScript checker does not add Rust source-language support.

The native path preserves the current collector's explicit limits around computed
imports, unsupported registrations, and application-framework adapters. Runtime
verification, retained-code limits, and missing ancestry remain independent gate
requirements. Passing parity fixtures or a timing comparison cannot override them.
