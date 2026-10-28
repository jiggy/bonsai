## Behavior

Describe the user or maintainer, the rule they need, and the observable result.
For a refactor or technical fix, identify the existing promise being preserved;
new BDD scenarios are not required when product behavior does not change.

## Specifications and regressions

Explain why any acceptance examples belong in BDD and would survive an internal
redesign. List the technical tests for compiler, protocol, schema, presentation,
or race details. When moving assertions between layers, name their destinations.

Record the meaningful red/green evidence, or the control/fault/restored-control
evidence for retrospective coverage. See [the BDD workflow](https://github.com/jiggy/bonsai/blob/main/docs/bdd.md).

## Bonsai impact

Report contract surface and ceiling separately from retained size and the actual
gate verdict. Justify each new action–selector pair as a product observation;
extra diagnostics, fixture aliases, and implementation details do not establish
new product scope. State any deliberate policy change separately.

## Validation

List commands and results, including relevant skips or unresolved limitations.
