Feature: Earn one global allowance from observable product surface
  Additional examples strengthen verification. They do not create separate feature budgets.
  These examples start with 1000 tokens for up to two action-observation pairs,
  add 500 tokens per surface doubling, and stop at a hard limit of 1800 tokens.

  Scenario: Allowance grows per surface doubling and stops at the hard limit
    The maintainer compares applications with two, three, four, and eight required fields.
    Each application is checked independently under the same reviewed policy.
    When I invoke "check" with {"fixture": "accounting", "case": "ceiling", "surface": 2}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 2
    And response "decision.ceiling" equals 1000
    And response "invocationCount" equals 1
    When I invoke "check" with {"fixture": "accounting", "case": "ceiling", "surface": 3}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 3
    And response "decision.ceiling" equals 1292
    And response "invocationCount" equals 1
    When I invoke "check" with {"fixture": "accounting", "case": "ceiling", "surface": 4}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 4
    And response "decision.ceiling" equals 1500
    And response "invocationCount" equals 1
    When I invoke "check" with {"fixture": "accounting", "case": "ceiling", "surface": 8}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 8
    And response "decision.ceiling" equals 1800
    And response "invocationCount" equals 1

  Scenario: Duplicate and split contracts keep every invocation without earning more allowance
    The positive input 1 and negative input 0 are each required twice.
    The maintainer compares independent projects whose requirements are duplicated
    across files in one project and split by outcome in the other.
    When I invoke "check" with {"fixture": "accounting", "case": "duplicate-contracts", "layout": "duplicate"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 1
    And response "decision.ceiling" equals 1000
    And response "invocationCount" equals 4
    And response "inputValues" equals [0, 0, 1, 1]
    When I invoke "check" with {"fixture": "accounting", "case": "duplicate-contracts", "layout": "split"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 1
    And response "decision.ceiling" equals 1000
    And response "invocationCount" equals 4
    And response "inputValues" equals [0, 0, 1, 1]

  Scenario: Collection positions share allowance while distinct actions remain distinct
    The sample action requires prices at items[0] and items[1]; the other action
    requires its own items[0].price. The two positions for sample share one pair.
    The application must still execute sample with input 1 and other with input 0.
    When I invoke "check" with {"fixture": "accounting", "case": "selectors"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 2
    And response "invocationCount" equals 2
    And response "inputValues" equals [0, 1]

  Scenario: Pruning obsolete source makes the unchanged allowance sufficient
    The base revision fulfills both required operations. Its retained code exceeds
    the reviewed 213-token allowance by 19 tokens.
    The candidate removes a shared wrapper and an unused declaration while keeping
    the same required behavior and policy.
    When I invoke "check" with {"fixture": "accounting", "case": "compaction", "revision": "base"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "decision.ceiling" equals 213
    And response "decision.requiredReduction" equals 19
    When I invoke "check" with {"fixture": "accounting", "case": "compaction", "revision": "pruned"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.ceiling" equals 213
    And response "decision.base.additionalCapacity" equals 0
    And response "decision.requiredReduction" equals 0
