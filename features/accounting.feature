Feature: Earn one global allowance from observable product surface
  Additional examples strengthen verification. They do not create separate feature budgets.
  These examples start with 1000 tokens for up to two action-observation pairs,
  add 500 tokens per surface doubling, and stop at a hard limit of 1800 tokens.

  Scenario Outline: Allowance grows per surface doubling and stops at the hard limit
    When I invoke "check" with {"fixture": "accounting", "case": "ceiling", "surface": <surface>}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals <surface>
    And response "decision.ceiling" equals <ceiling>
    And response "invocationCount" equals 1

    Examples:
      | surface | ceiling |
      | 2       | 1000    |
      | 3       | 1292    |
      | 4       | 1500    |
      | 8       | 1800    |

  Scenario Outline: Duplicate and split contracts keep every invocation without earning more allowance
    When I invoke "check" with {"fixture": "accounting", "case": "duplicate-contracts", "layout": "<layout>"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 1
    And response "decision.ceiling" equals 1000
    And response "snapshot.evidence.checks.length" equals 4
    And response "invocationCount" equals 4
    And response "inputValues" equals [0, 0, 1, 1]

    Examples:
      | layout    |
      | duplicate |
      | split     |

  Scenario: Collection positions share allowance while distinct actions remain distinct
    When I invoke "check" with {"fixture": "accounting", "case": "selectors"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 2
    And response "snapshot.evidence.checks.length" equals 3
    And response "invocationCount" equals 2
    And response "inputValues" equals [0, 1]

  Scenario: Background obligations run before every scenario without multiplying surface
    When I invoke "check" with {"fixture": "accounting", "case": "background"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 1
    And response "snapshot.evidence.checks.length" equals 4
    And response "invocationCount" equals 4
    And response "inputValues" equals [0, 1, 1, 2]
    And response "invocationSequences" equals [[1, 0], [1, 2]]

  Scenario: Every invalid requirement is rejected before application execution
    Seven separate files contain skipped, malformed, unobserved, unsupported, selector,
    DocString, and DataTable requirements. Each file must retain its own rejection.
    When I invoke "check" with {"fixture": "accounting", "case": "invalid-contract"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "snapshot.contracts.cases.length" equals 0
    And response "verificationTiming.status" equals "skipped"
    And response "invocationCount" equals 0
    And response "snapshot.contracts.problems[0]" equals "Error: datatable.feature:3: DataTables and DocStrings are not supported yet"
    And response "snapshot.contracts.problems[1]" equals "Error: docstring.feature:3: DataTables and DocStrings are not supported yet"
    And response "snapshot.contracts.problems[2]" equals "SyntaxError: JSON Parse error: Expected '}'"
    And response "snapshot.contracts.problems[3]" equals "Error: selector.feature:4: unsupported response selector"
    And response "snapshot.contracts.problems[4]" equals "Error: skipped.feature: skip tags are not accepted"
    And response "snapshot.contracts.problems[5]" equals "Error: unobserved.feature: scenario must invoke an action and observe its result"
    And response "snapshot.contracts.problems[6]" equals "Error: unsupported.feature:4: unsupported or unbound step: maybe response \"status\" equals \"accepted\""
    And response "snapshot.contracts.problems[7]" equals "No executable contract cases found"

  Scenario: Actual compaction releases the full cost of reachable wrappers and unused source
    Two operations share a wrapper costing ten tokens; an unused declaration costs nine.
    The ceiling stays fixed at 213 tokens while both are removed.
    When I invoke "check" with {"fixture": "accounting", "case": "compaction"}
    Then response "previous.exitCode" equals 1
    And response "previous.decision.status" equals "reject"
    And response "previous.snapshot.unrooted[0]" equals "handlers.ts#abandoned"
    And response "previous.decision.requiredReduction" equals 19
    And response "wrapperCost" equals 10
    And response "wrapperAncestryCount" equals 2
    And response "sharedFileCopies" equals 1
    And response "retainedReduction" equals 19
    And response "allowanceChange" equals 0
    And response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.requiredReduction" equals 0
    And response "snapshot.evidence.checks.length" equals 2
