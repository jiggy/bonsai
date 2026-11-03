---
name: bonsai
description: "Adopt Bonsai, deliver features within its retained-code budget, prune or refactor a Bonsai project, write behavior contracts, or resolve rejected and incomplete checks. Use when configuring Bonsai verification or CI."
---

# Bonsai

Deliver the user's required outcome within the project's measured code allowance.
Start with a complete useful journey; let its missing behavior determine the next component change.

## Select the workflow

Read the linked guide or section for the current task; load other references when that task needs them.

- **Implement or refactor:** read the [development workflow](./reference/workflow.md). It covers delivery slices, naming, modularity, meaningful red/green evidence, pruning, and acceptance.
- **Adopt Bonsai:** read [project setup](./reference/adoption.md). Establish the supported scope, real bindings, a passing baseline, and rejection/recovery probes.
- **Write or review behavior contracts:** read [BDD](./reference/bdd.md). Distinguish stakeholder rules from technical regressions, preserve moved assertions, and review what earns allowance.
- **Resolve a failed check:** read [verdict recovery](./reference/workflow.md#5-resolve-the-verdict) and [report interpretation](./reference/README.md#read-a-check-result). Fix incomplete analysis before treating provisional findings as a verified reduction target.
- **Select an adapter or repair setup:** check [TypeScript scope](./reference/README.md#limits-and-next-steps), [Python scope](./reference/README.md#native-python-projects), and [native installation](./reference/native-prototype.md#install-and-run). Authored Rust and general framework routing are outside the current production adapters.
- **Add required tests or quality floors:** read [supporting verification](./reference/verification.md) for concrete runner formats, fresh reports, and coverage or mutation requirements.
- **Set up CI enforcement:** read the [GitHub Action guide](./reference/github-action.md). A passing development command and an independently protected merge gate provide different guarantees.
- **Check exact commands:** use the [CLI reference](./reference/cli.md) and the installed version's `bonsai --help`.

## Keep the gate authoritative

Find the project's instructions and existing gate command before making changes.
Preserve its root, base, policy, inventory, required observations, and supporting checks.
Run it before and after the change. Without a project wrapper, start with:

```sh
bonsai check --json
```

Use `bonsai explain` with an actual reported file or component to investigate ancestry.
It performs static analysis; rerun `check` to establish acceptance.

Keep one global allowance. More examples, aliases, files, wrappers, or unit tests do not establish more product capability.
Ancestry does not prove necessity or complete behavior coverage, and splitting code does not itself reduce retained cost.
Choose the smallest meaningful components at the application's abstraction level when the split has a beneficiary.

For each change, report the actual verdict, retained size versus ceiling, measured savings, required checks, and unresolved scope.
Report surface or allowance changes separately from code savings.
Only a fresh complete pass supports claiming acceptance; keep rejected and incomplete results visible.
