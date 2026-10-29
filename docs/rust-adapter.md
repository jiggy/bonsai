# Rust adapter feasibility

Rust support is an active adapter milestone. The first slice is an opt-in,
development-only experiment, not production Rust acceptance.

## Backend decision

Investigate a compiler-aware backend before adding a Rust gate. A syntax parser
can count and classify declarations, and Cargo can compile them, but neither alone
supplies Bonsai's resolved contract-to-component graph.

The probe uses the rust-analyzer component shipped with the explicitly selected
Rust 1.85.0 toolchain. It opens one disposable, dependency-free Cargo binary and
uses bounded LSP requests to resolve an aliased action across modules, expand a
declarative macro, and distinguish active `cfg` definitions. It builds and executes
the same target twice, with and without the `experimental` feature. The native
dispatcher returns application JSON; it never reports an authoritative pass.

The ordinary suite verifies that maintained `.rs` source is still charged and
produces incomplete analysis. No grammar, allowance, production dependency, or
supported-language claim changes in this experiment.

## Run the experiment

```sh
rustup toolchain install 1.85.0 --profile minimal --component rust-analyzer --component rust-src
BONSAI_RUST_PROBE=1 bun test --isolate --timeout 180000 test/rust-backend.test.ts
```

The separate read-only Rust backend workflow installs this optional toolchain.
Normal checks and package installation do not install or start it. The probe
prints versioned samples with the actual compiler/backend versions, selected
features, semantic results, native response checks, elapsed time, and output size.
Those timings describe this fixture; they do not establish a full gate deadline.

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
