# Purpose

Prototype a Rust TypeScript source collector and measure it against the existing engine.

## Ownership

One Cargo crate in `src/`, with Bun comparison and benchmark tools in `tools/`. The normal Bonsai CLI remains on the TypeScript engine.

## Local Contracts

Use a mature TypeScript parser. Preserve exact component, relationship, token, binding, and source-location facts for supported syntax. Unsupported syntax or unresolved dependencies must remain explicit. Native structural collection does not supply TypeScript compiler diagnostics and cannot independently establish gate acceptance.

Keep Rust source and this tooling in maintained inventory. Build output is generated material. Until Rust ancestry is supported, the default collector must report Rust source as unsupported rather than silently classifying it as data.

Compare both engines on identical inputs. Count process startup and any preparation in cold-run timings; label warm runs and diagnostics costs separately. Never present a structural-only comparison as an equivalent full-gate speedup.

## Work Guidance

Keep the prototype bounded and its protocol versioned. Do not switch the default engine before compatibility and performance are demonstrated.

## Verification

Cargo tests and the native differential comparison command.

## Child DOX Index

None. This file owns the full subtree.
