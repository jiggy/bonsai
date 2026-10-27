# Purpose

Explain Bonsai’s supported behavior and limits.

## Ownership

Design baseline, roadmap, command reference, CLI review evidence (`check-ux-review.md`), native collector evaluation (`native-prototype.md`), performance profiling and native checker research (`performance.md`), and the distinction between executable behavior contracts and full self-budget acceptance.

## Local Contracts

Document actual commands, defaults, streams, and exit codes. Keep unsupported adapters and admission guarantees explicit. Distinguish the internal validated binding-loader boundary from general computed imports, and development oracle comparisons from native full-root admission checks under the saved deadline.

Document fixed subprocess entry-point syntax separately from runtime coverage. Child launches root executable startup, not entire modules or exports. Keep unsupported launch forms, import side effects, and class initialization explicit. Test-helper subject discovery uses established production ancestry; supporting helper ancestry cannot justify unrelated callers.

Keep command elapsed time, candidate phase durations, and policy feedback measurements distinct. Document timing endpoints and partial/interrupted measurements; profiling doesn't change acceptance or deadline limits.

Keep native semantic conformance, lexical accounting, and runtime evidence distinct. Label benchmark process reuse, timing endpoints, workloads, and engine responsibilities; never present structural-only timing as an equivalent full-gate speedup. Rust is the sole production engine, and authored Rust stays measured with explicit unsupported analysis until an adapter exists.

Document native analysis as the default and `--engine rust` as a compatibility spelling. `--engine typescript` is unsupported. Keep development compiler oracles outside published runtime sources. Reference comparisons run in development tests, never inside a native check. Preserve explicit TypeScript-version gaps, Bun asynchronous transport requirements, native platform support, and the distinction between analysis speed, completed verification, and gate acceptance. Never compare an incomplete run with a completed gate as an equivalent speedup.

Document prebuilt platform coverage and source-checkout versus installed-package repairs. Never imply a prepared npm version has been published or ask users to compile a missing published platform package. Unpublished targets may use an explicit local build matching the pinned SDK through `BONSAI_NATIVE_BINARY`; distinguish this from prebuilt package support and automatic installation.

## Work Guidance

Update CLI reference and migration notes with behavior changes.

## Verification

Compare examples with `bun run bonsai --help` and the executable

## Child DOX Index

None. This file owns the full subtree.
