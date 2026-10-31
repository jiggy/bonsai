# Rust adapter feasibility

Rust support is an active adapter milestone. The first slice is an opt-in,
development-only experiment, not production Rust acceptance.

## Backend decision

Investigate a compiler-aware backend before adding a Rust gate. A syntax parser
can count and classify declarations, and Cargo can compile them, but neither alone
supplies Bonsai's resolved contract-to-component graph.

The probe uses the rust-analyzer component shipped with the explicitly selected
Rust 1.86.0 toolchain. It opens one disposable, dependency-free Cargo binary and
uses bounded LSP requests to resolve an aliased action across modules, expand a
declarative macro, and distinguish active `cfg` definitions. It builds and executes
the same target twice, with and without the `experimental` feature. The native
dispatcher returns application JSON; it never reports an authoritative pass.

The existing native CLI regressions verify that maintained `.rs` source is still
charged and produces incomplete analysis. No grammar, allowance, production dependency, or
supported-language claim changes in this experiment.

## Run the experiment

```sh
rustup toolchain install 1.86.0 --profile minimal --component rust-analyzer --component rust-src
BONSAI_RUST_PROBE=1 bun test --isolate --timeout 180000 test/rust-backend.test.ts
```

The separate read-only Rust backend workflow installs this optional toolchain.
Normal checks and package installation do not install or start it. The probe
prints versioned samples with the actual compiler/backend versions, selected
features, semantic results, native response checks, elapsed time, backend executable
size, and protocol output size.
Those timings describe this fixture; they do not establish a full gate deadline.

## Initial result and selected next step

The first Linux probe passed against rustc/rust-analyzer 1.85.0. Both Cargo feature
profiles resolved the selected cross-module action and their correct active
definition; declarative macro expansion and native JSON dispatch passed. The
first samples took 3.94s and 3.35s, including analyzer startup, the explicit Cargo
build, and native response checks. Each sample starts a fresh analyzer but shares
Cargo's target directory; the second sample is not an independent cold build.
The analyzer executable measures 36,819,280 bytes (about 35.1 MiB), excluding
other toolchain components and caches. Versions and sizes are observations, not
content attestation. This is not a production gate benchmark.

The next source-graph probe actually failed on the 1.85.0 component: it returned
`-32601` for `rust-analyzer/viewSyntaxTree`. The 1.86.0 component provides that
API. An explicit inline `linkedProjects` crate disables Cargo discovery, build
scripts, and procedural macros, while matching the compiler's sysroot and target
`cfg`. It derives declarations from the returned syntax tree and edges from LSP
definitions, then feeds those facts into Bonsai's real `buildSnapshot`.

Both feature profiles passed this graph experiment in 2.98s and 2.70s, including
the controlled fixture's Cargo build and native response. The 1.86.0 analyzer
executable is 37,414,448 bytes. Selected-handler ancestry and unused-handler
rejection worked. Rust-looking string data did not create declarations; syntax
byte offsets were converted to LSP UTF-16 positions. Eight unresolved references
and missing macro-generated method edges remain explicit blockers. These partial
facts preserve the production unsupported-language diagnostics and cannot pass a
gate. Macro expansion success alone does not establish complete macro ancestry.

Continue with a bounded standalone std-only Rust binding adapter before Cargo
workspace support. Its source analysis must use the proven semantic backend
without executing project build scripts. Runtime actions can use an ordinary
literal native registry and a generated persistent stdio harness; the existing
verifier remains responsible for assertions. Reject unsupported macros, traits,
conditional/generated source, external crates, and mixed-language dependencies
until their graph can be established. Do not ship a parser-only Rust gate.
The unresolved work is systematic reference collection, completeness diagnostics,
toolchain/target identity, resource/initialization semantics, and execution
isolation for build scripts and procedural macros.

## Integration gate

Use the experiment's actual results to choose the next implementation:

- Reuse the language-neutral collector facts and native JSON action boundary.
  Python/Rust consumers must not need dummy TypeScript bindings.
- Resolve named Rust registrations independently of returned application results.
  An unused registration must not root its handler; supporting tests cannot root
  production. Every retained file remains fully charged.
- Bind analysis and execution to identical target, features, toolchain, policy,
  and source identities. Version any new accounting metric explicitly.
- Support or explicitly diagnose traits, macro expansion, generated source,
  build scripts, and unresolved references. Successful sample queries are not a
  complete reference graph or proof that rust-analyzer reports every limitation.
- Integrate build scripts and procedural macros with the separately implemented
  candidate execution boundary. They are disabled in this first semantic probe.
  No ordinary process or identity receipt authenticates hostile execution.

If the backend cannot expose the required facts within a useful footprint,
record that limitation and investigate a bounded alternative. Do not replace
semantic ancestry with a parser-only pass.

Primary references: [rustup components](https://rust-lang.github.io/rustup/concepts/components.html),
[rust-analyzer configuration](https://rust-analyzer.github.io/book/configuration.html),
[LSP extensions](https://rust-analyzer.github.io/book/contributing/lsp-extensions.html),
and [execution risks](https://rust-analyzer.github.io/book/security.html).
