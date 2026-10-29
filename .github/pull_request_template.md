## Behavior

Classify the change before choosing acceptance examples: a new or changed product
rule, a missing meaningful example of an existing rule, or a technical regression.
Describe the stakeholder, agreed rule, and observable consequence. For each added
BDD scenario, explain the decision boundary the current examples do not cover.
For a technical fix, name the existing promise and technical tests; a new syntax
or protocol case does not by itself require a product scenario.

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
