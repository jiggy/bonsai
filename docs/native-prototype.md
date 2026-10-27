# Native TypeScript checker

`check` and `explain` use the Rust TypeScript compiler
[tsrs](https://github.com/oxc-project/tsrs) through the Bun CLI. Rust is the only
production engine. `--engine rust` remains valid for existing commands;
`--engine typescript` is a usage error. Remove that option to use native analysis.

## Install and run

Use Bun 1.4.3 or later. A source checkout uses its committed lockfile:

```sh
bun install --frozen-lockfile
bun run ./src/cli.ts check --root examples/checkout --verbose
bun run ./src/cli.ts explain src/checkout.ts --root examples/checkout --json
```

After the native npm release is published, the equivalent installation-free
commands are:

```sh
bunx --bun @jigging/bonsai@alpha check --verbose
bunx --bun @jigging/bonsai@alpha explain src/orders.ts --json
```

Select an exact published version for reproducible CI. The old published
`0.0.0-alpha.0` lacks native analysis; preparing `0.0.0-alpha.1` in Git does not
publish it or update the registry tag.

The package pins `tsrs@0.18.0-ts7.1.0-dev.20260929`, including prebuilt binaries
and standard libraries. Its optional platform packages have no install/build
scripts. Users need neither Node nor Cargo, `rustc`, or a local compiler toolchain.
The CLI, asynchronous SDK, and verification subprocess run through Bun.

| Target in the pinned release | Availability |
| --- | --- |
| Linux x64 and arm64, GNU or musl | Prebuilt |
| macOS arm64 | Prebuilt |
| Windows and macOS x64 | Unsupported |

Newer upstream releases add platforms, but Bonsai does not claim support until
its pinned SDK and runtime are tested there. Missing dependencies and unsupported
platforms fail before application handlers run; there is no alternate compiler
fallback or automatic compilation.

Native packages resolve from the installed checker, independently of candidate
packages and the caller directory. On Linux without the GNU binary's dynamic
loader, the resolver can select an installed static-musl binary. This accommodates
hosts such as NixOS without asking users to compile the checker. If that package
is unavailable, the diagnostic gives a dependency repair.

`BONSAI_NATIVE_BINARY` optionally selects an absolute path to a matching tsrs
API-server binary; relative overrides resolve against the caller directory.
Bonsai clears upstream `TSRS_BINARY` at the worker boundary. The override does not
accept the retired Oxc collector. Remove an obsolete override before reinstalling:

```sh
unset BONSAI_NATIVE_BINARY
bun install --frozen-lockfile
bun run ./src/cli.ts check --verbose
```

That lockfile command applies to a source checkout. Installed-package repairs
reinstall the published package, rather than asking users to enter a temporary
`bunx` cache directory. Help and version never start or install a native checker.

## Analysis and verification

The native backend constructs fresh programs from maintained TypeScript roots and
collects configuration, options, syntax, binding, global, and semantic diagnostics.
Explicit ambient-type discovery preserves the established collector's scope.
Batched symbol queries resolve aliases, declarations, type references, and selected
module properties for the retention graph.

The `typescript` dependency remains for TypeScript 5.9 lexical scanning, local AST
parsing, JSONC conversion, and type-root discovery. These helpers preserve the
retained-token metric and structural rules; production never constructs a
JavaScript TypeScript compiler program, binder, or checker. The independent
reference implementation lives in `test/reference.ts` and `test/compiler.ts`,
which are excluded from the published package.

Source diagnostics, unsupported syntax, incomplete queries, or interruptions block
required verification. The pinned native compiler and the TypeScript 5.9 oracle
are not universally equivalent: known default-library directive and lexical-parser
gaps remain explicit incomplete results. A missing, crashed, or malformed worker
is a runtime failure with exit 1, never a fallback pass. Base and candidate use
the same native analysis. `explain` never runs application handlers.

The existing colors, wrapping, output streams, plain columns, gate codes, timing
boundaries, and loading receipts remain in force. Snapshots identify the compiler:

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

`status` is `complete` or `unsupported`. Source completeness alone does not satisfy
behavior, ancestry, size, or feedback requirements. Worker execution uses the
caller's privileges and is not a sandbox for hostile candidates.

## Invocation-scoped worker reuse

Verification opens a private local broker. The first matching nested CLI request
starts a lexical worker; subsequent requests can reuse its loaded modules. Every
request re-reads source and declarations, starts a fresh SDK/native compiler
process and program, collects all diagnostics, and waits for actual compiler
closure before returning facts. Application modules remain isolated between
verification runs. Scenarios and handler calls retain their order; no handler
results, evidence, or semantic snapshots are cached.

Reuse requires the same checker, selected binary, and compiler environment,
including preload options. A busy worker permits a fresh native path; a broken
matching session fails explicitly. Request identities and strict collector
validation acknowledgments prevent malformed or stale responses from being reused.
Transport, waiting, and cleanup count toward existing deadlines.

Cancellation retires the worker and reaps its compiler, including when the SDK has
already cleared its process field during shutdown. Frames are bounded at 4 MiB
for requests and 64 MiB for responses, with 64 KiB diagnostics per request. Normal
cleanup removes the private socket directory. A hard kill before lazy startup can
leave an inert directory; the operating system closes its listener.

## Development conformance checks

```sh
mkdir -p work
bun run native:compare work/native-parity.json
```

`native:compare` runs the development TypeScript oracle and the production native
collector separately on identical fixtures. It compares diagnostics, whole-file
and component costs, identities, source locations, graph relationships, actions,
and binding facts. The corpus includes shadowing, aliases, unused siblings, tests
that cannot root production, ambient declarations, invalid imports, unsupported
registrations, and unmaintained dependencies.

Derived ancestry and policy comparisons use explicitly assumed fixture observations;
those development inputs are not runtime evidence. A mismatch exits 1. Real CLI
and executable feature tests separately require actual candidate-bound observations.
Reference comparison never runs inside a production command.

## Measure fresh checks

```sh
bun run native:bench --runs 3 --output work/native-benchmark.json
bun run native:bench --runs 3 --root /absolute/project --output work/project-benchmark.json
```

Protocol 3 launches one fresh native CLI process per sample with the saved policy.
`--runs` accepts 1–20 samples, default 3; the default root is `examples/checkout`.
Reports keep every sample, minimum/median/maximum wall times, command and phase
timings, compiler identity, decisions, and required/passed observations.

Repeated-run source, contract, decision, ancestry, and evidence facts must match
after removing measured durations. `sourceAndDecisionParity` and structured
`parityMismatches` describe that stability. They do not compare separate runtime
engines. `completedVerification` records whether every sample collected complete
evidence. There is no engine speedup ratio; compare saved reports from equivalent
workloads and revisions to assess a change.

A fresh process does not flush operating-system filesystem caches. External wall
time includes startup, serialization, delivery, and cleanup; reported command and
feedback timings retain their own endpoints. Skipped or interrupted verification
cannot establish a completed-check improvement. See [performance evidence](performance.md).

## Scope

Both root and copied-archive regressions analyze the complete maintained inventory
and run every current feature observation under the saved 15-second policy. They
still reject genuine budget and ancestry violations. The TypeScript oracle is
retained development material, not a public engine or a narrower root inventory.

The retired Oxc implementation, Cargo files, and authored Rust sources were deleted
rather than excluded. Other projects' authored `.rs` files remain measured and
unsupported until a Rust ancestry adapter exists. A Rust implementation of the
TypeScript checker does not add Rust source-language support. Computed imports,
unsupported registrations, and framework boundaries retain their explicit limits.
