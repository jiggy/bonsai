# Domain requirements and named Jig routes

Bonsai can connect publisher-facing Gherkin to its existing action and
observation model. A separate bounded adapter follows a literal Jig binding
route from a command wrapper into the selected local TypeScript Flow. Both
integrations keep the ordinary maintained-code ledger and policy.

Use the normal [installation and initialization](../README.md#in-your-project)
steps. These integrations add no configuration switch or alternate acceptance
command. The [BDD guide](bdd.md) owns the review of product rules and which
observations qualify for allowance.

## Keep domain language and individual obligations

Suppose a publisher needs both a sample and its practice materials:

```gherkin
Feature: Commission a useful pilot
  Scenario: Prepare a pilot for a chosen reader problem
    Given a publisher has chosen "daily practice"
    When they commission a pilot
    Then they receive a sample and its practice materials
```

In the TypeScript module selected by `bindings` in `bonsai.json`, keep the
ordinary action registry and add a literal exported `steps` array:

```ts
import { invokePilot } from './handler.ts'

export const actions = { pilot: invokePilot }

export const steps = [
  {
    given: 'a publisher has chosen {problem:string}',
    input: { problem: { parameter: 'problem' } },
  },
  { when: 'they commission a pilot', action: 'pilot' },
  {
    then: 'they receive a sample and its practice materials',
    observations: [
      { selector: 'sample.available', equals: true },
      { selector: 'materials.available', equals: true },
    ],
  },
]
```

The `Given` constructs `{ problem: 'daily practice' }`. The `When` invokes
the registered `pilot` application handler with that input. The `Then` requires
two independent response observations. A response missing either result fails
its corresponding obligation; a single scenario-passed boolean does not replace
them.

Run the same commands used for the technical invocation/response vocabulary:

```sh
bonsai check --json
bonsai explain handler.ts --json
```

The feature remains the requirement's source location. Each compiled check also
records contributing registry locations in `definitionRefs`, so a reviewer can
trace the feature's context, action, and observation to their definitions.
Used definitions receive source ancestry through that connection. Defining a
phrase does not independently create product surface or justify unrelated code.

### Parameters and scenario context

Patterns match the entire step text and use these named captures:

| Capture | Feature text | Value supplied to the template |
| --- | --- | --- |
| `{problem:string}` | `"daily practice"` | A JSON-decoded string |
| `{count:int}` | `3` | An exact safe integer |
| `{request:json}` | `{"audience":"new readers"}` | A JSON value |

Substitute a capture with a sole-key `{ parameter: 'name' }` object anywhere in
an input or expected-value template. Every capture must contribute to an input
field or observation. A JSON capture must end its pattern; adjacent captures
need literal separating text. Strings use JSON quoting and escapes, and JSON
numbers must be finite.

Keep case-specific expectations visible in the feature. For example, a separate
definition can bind `the sample status is "ready"` to its actual expected value:

```ts
{
  then: 'the sample status is {status:string}',
  observations: [
    { selector: 'sample.status', equals: { parameter: 'status' } },
  ],
}
```

A literal `equals: true` is appropriate when it expresses the fixed meaning of
the phrase, as in receiving both deliverables. Definitions should not conceal
different expected outcomes behind a fixture name or compute an expected result.

Each `Given` adds a nonempty object of named input fields before the first
action. A domain `When` uses this accumulated context; its optional literal
`input` object adds fields. Duplicate top-level keys fail, even when their values
are equal. The technical `When I invoke ... with ...` vocabulary also preserves
context, so its input must be an object when context is present. This is a
shallow merge, not a mutable scenario world.

Context starts fresh for every scenario and every Scenario Outline row.
Gherkin Background steps expand normally, and `And` inherits its preceding
step's role. `Given` cannot perform setup side effects, call an action, run after
the first action, or provide hooks. Put necessary application behavior in the
real registered action and make its required consequences observable.

### Supported metadata and accounting limits

`steps` must be one directly exported `const` literal array in the configured
TypeScript bindings module. Literal JSON data and TypeScript type wrappers such
as `as const` and `satisfies` are accepted. Calls, callbacks, aliases, re-exports,
spreads, computed properties, custom regexes, hooks, and general Cucumber step
definitions are outside this adapter. Patterns are single-line text, at most
4,096 characters, with at most 32 uniquely named captures. Template nesting is
bounded to 32 levels.

Unknown, ambiguous, and wrong-role steps make contract compilation incomplete.
This includes a domain pattern overlapping the built-in technical vocabulary.
DocStrings, DataTables, and skip tags remain unsupported. A pattern's action
must identify an entry in the ordinary `actions` registry; the phrase is not a
new action alias for accounting.

Every authored observation remains required, including repeated observations
and all concrete example rows. The allowance counter still deduplicates the
canonical action name paired with its normalized response selector. Two phrases
that select the same `pilot`/`sample.available` observation do not buy two units
of surface. Eligibility remains a human product review obligation; the compiler
does not decide whether a phrase describes meaningful product behavior.

An optional Cucumber supporting runner can contribute its configured supporting
evidence. It does not replace these individual product obligations or establish
their action/source ancestry. See [supporting verification](verification.md).

## Follow a literal local Jig binding

An application can select its Flow through Jig's named command route. For the
supported slice, keep the project declaration literal:

```ts
// jig.ts
import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  flows: discover('./flows'),
  bindings: discover('./bindings'),
})
```

```ts
// bindings/pilot.ts
import { defineBinding } from '@jigging/jig'

export default defineBinding({ package: 'flows/pilot' })
```

```ts
// flows/pilot/FLOW.ts
import { handle } from '@jigging/flow'
import { execute } from './method.ts'

await handle(execute)
```

The actual Flow package must satisfy Jig's contract, metadata, dependency-lock,
and host requirements. Its method can call local child methods through normal
supported imports. Those application dependencies receive the same contract
ancestry as the selected entry point. Unused exports and unrelated flows remain
subject to the usual unrooted-code decision.

Use an explicit project working directory in the application wrapper. This
example lives at the project root:

```ts
// handler.ts
import { spawnSync } from 'node:child_process'

export function invokePilot(input: unknown) {
  const child = spawnSync(
    'jig',
    ['run', 'binding:pilot', '--input', JSON.stringify(input), '--json'],
    { cwd: new URL('./', import.meta.url), encoding: 'utf8', timeout: 25000 },
  )
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(child.stderr || child.stdout)
  const result = JSON.parse(child.stdout)
  if (result.status !== 'succeeded' || result.outcome !== 'done' || result.cleanup !== undefined)
    throw new Error(JSON.stringify(result))
  return result.output
}
```

The `actions.pilot` binding points to this wrapper. Jig's successful CLI response
is an envelope; the wrapper returns its `output` so observations address actual
application fields, such as `sample.available`, rather than the command envelope.
The expected Flow outcome is part of this application's wrapper contract.

### Maintained inputs and route syntax

Include the feature, Bonsai bindings module, wrapper, `jig.ts`, discovered
binding declarations, and selected Flow package in maintained scope. Keep the
**entire selected package** measured, including `FLOW.meta.json`,
`FLOW.contract.json`, `package.json`, lockfiles, and other package data. Nested
`node_modules` are excluded from Jig's package digest; installed dependencies
remain subject to the existing toolchain and runtime limits. A partial package
cannot establish that the current maintained source matches approved execution.

The route adapter supports these explicit forms:

- Named imports, including import aliases, of `spawn`, `spawnSync`, `execFile`,
  or `execFileSync` from `node:child_process`, called with the literal executable
  `'jig'`, a literal argument array, and a literal options object.
- Arguments beginning with `'run'` and a literal `'binding:<id>'`. The only
  additional flags are `--input` with a value and `--json`, each at most once. The input value
  can be computed from the action's input; the route itself must be literal.
- A `cwd` expressed directly as `new URL(relativePath, import.meta.url)`, or that
  expression wrapped by a named `fileURLToPath` import from `node:url`, resolving
  to the analyzed project root. The other supported options are literal
  `encoding`, `timeout`, `maxBuffer`, `stdio`, `windowsHide`, `killSignal`, and
  `shell: false`.
- A direct default `defineJig` export containing only `flows` and `bindings`.
  Each uses `discover` with a literal local directory or an array of distinct
  local directories. Discovery is shallow: binding filenames define route IDs,
  and selected Flow packages are immediate subdirectories of a flow root.
- A direct default `defineBinding` export with a literal local `package`,
  optional literal JSON `settings`, and optional empty `slots` or `attachments`.
  The selected package has exactly one implementation, `FLOW.ts`.

Computed routes or discovery, shell command strings, launch environment
overrides, inherited working directories, external packages, other Flow
languages, symlinks, ambiguous bindings, unmaintained route inputs, providers,
nonempty child-route slots, attachments, grants, limits, and approved execution
overrides are outside this
slice. Recognized unsupported named launches produce incomplete source analysis;
an arbitrary external command cannot acquire ancestry by naming a source file.

### Static explanation and current approved execution

```sh
bonsai explain flows/pilot/method.ts --json
```

`explain` follows the literal source declarations without importing the project,
running a handler, executing Jig, or requiring a reviewed Jig project. It reports
the selected method's structural contract path, and follows supported child
method references. It does not need the Jig executable; ordinary TypeScript type
resolution still applies. It does not establish that the application executed, that
Jig accepted the package, or that the requirement covers every behavior.

```sh
jig review --yes
bonsai check --json
```

`check` requires an installed compatible Jig command on `PATH`, a qualified Jig
host, and approval of the current package through Jig's normal review workflow.
Review is a separate owner action. Bonsai never approves or repairs the project
on the owner's behalf.

Jig executes an immutable approved snapshot. Therefore the currently edited
method and a successful result from an older approved snapshot cannot be joined
as evidence. Before application execution, Bonsai uses read-only
`jig inspect binding:pilot --json` to compare the approved package digest with
the current selected package's bytes and verify the binding's package and settings.
The approved binding must be ready in a matching execution environment, without
unsupported child-route, attachment, artifact, or execution-override state. Bonsai
checks the retained revision and approval again after observations and supporting
runners finish. Both inspections consume the check's existing feedback deadline.
Missing approval, changed source, changed selection, or unstable approval leaves
the check incomplete. A stale approval is detected before the wrapper is loaded.
The editable `jig.lock` file alone is not proof of an approved package. The
installed Jig executable remains part of the trusted execution environment;
recognizing its command name does not authenticate its binary.

After deliberately changing a method, review that change through Jig before
requesting a new behavioral verdict. Once the current changed package is
approved, Bonsai still evaluates each application observation normally: a valid
Jig run returning the wrong application result rejects the contract. Exit `0`
means Bonsai's whole gate passed; exit `1` is rejection; exit `2` is incomplete
verification or analysis. Structural ancestry, successful Jig execution, and a
passing observation are separate facts.

### Runtime qualification scope

The installed-package smoke in `test/jig-real.test.ts` passed with
`@jigging/jig` **0.1.0-alpha.42**, `@jigging/flow`
**0.1.0-alpha.15**, and **Bun 1.4.3** on a qualified **Ubuntu 24.04 x64** host
on 2026-11-03. The [recorded CI job](https://github.com/jiggy/bonsai/actions/runs/41621380926/job/125868629272)
also passed the official host preflight and residue checks. This qualification
covers those exact package versions and host setup; other releases and hosts
need their own validation.

`bun run test:jig` explicitly enables this real-package smoke and requires
registry access and a qualified host. Ordinary tests stay network-free. Static
fixtures use type declarations only and do not qualify a Jig runtime.

The real-package checks cover named CLI execution, a passing Bonsai observation,
ancestry into a selected child method, static explanation without application
execution, refusal of stale approved source, and rejection of an approved method
returning the wrong result. These selected controls and faults do not establish
general framework support, complete runtime coverage, hostile-code isolation,
or independently authenticated admission.
