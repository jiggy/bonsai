# Experimental standalone Rust bindings

This adapter checks a narrow standalone Rust crate with ordinary named handlers.
It does not load Cargo workspaces. TypeScript and Python projects do not install
or start the Rust toolchain.

Install the optional pinned components explicitly:

```sh
rustup toolchain install 1.86.0 --profile minimal --component rust-analyzer --component rust-src
```

Create the Rust binding file manually and select its maintained `bindings.rs`
in `bonsai.json`. `init` currently scaffolds TypeScript or Python, not Rust.
For example:

```rust
// bindings.rs
mod orders;
pub fn actions() -> &'static [(&'static str, fn(&str) -> String)] {
    &[("ready", orders::ready)]
}
```

```rust
// orders.rs
pub fn ready(_input: &str) -> String {
    String::from(r#"{"status":"ready"}"#)
}
```

Handlers receive the JSON input as a UTF-8 string and return a JSON string.
Bonsai parses the returned JSON and its existing verifier checks every declared
observation. There is no Rust SDK, serde requirement, TypeScript bridge, or
handwritten component graph. The literal native registry supports named
cross-module handlers; an unrequested registration does not justify its handler.

The first supported syntax is deliberately narrow: free functions, constants,
statics, ordinary file modules, and named imports using the standard library.
Attributes, conditional compilation, user types/traits/implementations, macros,
generated source, unsafe/FFI, subprocess launches, external crates, Cargo
manifests, inline modules, nested items, and mixed-language program inventories
produce incomplete analysis. Unresolved references also block execution.
Rust lexical-v1 counts tokens from the actual backend syntax tree, ignores
whitespace, charges comments consistently, and charges string/raw/byte/C literals
in four-byte blocks. Long literal payloads cannot hide as one word.
Every maintained file remains charged, including unused code and unsupported
inputs. A requested control-depth policy stays incomplete because this backend
does not yet supply that metric.

Source analysis starts the pinned rust-analyzer directly with an explicit inline
crate, sysroot, host cfg, and edition 2021. Cargo discovery, build scripts,
procedural macros, and checks on save are disabled. Candidate Cargo settings,
rustc wrappers, toolchain overrides, and ambient Rust flags do not choose the
backend. Tools must resolve outside the candidate root; candidate PATH directories
are removed before tool startup. `explain` never compiles or runs the application. Its validation receipt
identifies rust-analyzer; a real check additionally compiles the exact source
with the resolved rustc before any handler runs.

A check compiles one private generated harness per invocation. It reads the entire
bounded action/input plan before invoking handlers; stdout/stderr are sinks. Only
after every handler returns does it open an exclusive result file. Bonsai reads
its bounded frames only after successful native process exit, then applies the
existing selected-value verifier. Direct stdout writes cannot replace return values.
Each isolated scenario starts a fresh native process. Serial mode preserves one
native process and its state across ordered scenarios and steps. The existing
feedback deadline includes compiler startup, application startup, execution and
cleanup. Application processes retain the caller's privileges; this is not an
OS sandbox or execution authenticity.

The compiler receipt binds actual rustc and analyzer paths/content, compiler
driver libraries, target standard libraries, Rust source sysroot, host cfg,
edition and fixed dev profile. Before compilation and after verification,
Bonsai rechecks the context and maintained source fingerprint. The private
artifact also carries its content digest and candidate fingerprint. These
receipts detect context drift; they do not attest the host or a hostile candidate.

`test/standalone-rust.test.ts` exercises this compatibility promise through the
real CLI in a separate read-only CI job. The initial test returned incomplete
against the old adapter because maintained Rust was unsupported. Normal tests
skip the optional Rust test and require no Rust installation. Run it explicitly
with `BONSAI_RUST_PROBE=1 bun test --isolate --timeout 60000 test/standalone-rust.test.ts`.
The consuming contract is maintained test data and earns no additional root
product allowance.

The dedicated integration proof currently runs on Linux. Its technical tests
cover raw stdout forgery and blocked-plan rejection in both profiles, native pass/reject/incomplete outcomes, selected and unused registrations,
isolated and serial state, full literal cost, read-only explanation, cancellation
and process reaping, candidate PATH rejection, and a changed disposable analyzer
after completed native evidence. Platform-wide support and ordinary Cargo
adoption remain future work.

The authored Rust-team example in `features/adoption.feature` exercises this real CLI
outcome. It reuses the existing check exit/status observations and grants no
additional allowance. Complete repository self-host tests require the pinned
components above; CI installs them explicitly before measurement. This does not
add installation to consuming TypeScript or Python checks. The optional native
job also proves the retrospective example detects a real wrong handler response
and passes again after restoration. Detailed compiler/transport cases stay in
technical tests.

Plain inventory accounting is compiler-independent; Rust check/explain does not
load the TypeScript compiler. Interrupted toolchain/analyzer collection keeps the
initial complete inventory and reports incomplete analysis with interrupted
timings. Partial semantic facts and unrun evidence are never admitted.

Interrupted collection retains a conservative inventory: plain-text token cost plus
all Rust source bytes divided by four, rounded up per file. This preserves literal
payload charges without a compiler. Completed collection replaces that upper bound
with exact Rust lexical accounting; incomplete reports do not establish acceptance.

Selected JSON integers must fit JavaScript’s exact safe range. Selecting a containing
array or object also checks its integers; unrelated fields do not invalidate valid
observations.

`std::fs` and `std::thread` operations, including imported aliases, are unsupported
and block before execution. They could race or replace the native completed-result
file. Its path exclusivity alone is not authentication; Bonsai does not claim an
OS sandbox or independently authenticated result collection from arbitrary Rust.
