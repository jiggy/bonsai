Feature: Retain production code only through declared product behavior
  A maintainer needs code justified by reviewed product promises, rather than
  by unit-test activity or candidate changes to the admission rules.

  Scenario: Testing production code does not create contract ancestry
    The contract exercises app.ts#live successfully. The unit test exercises
    both live and dead, but dead.ts#dead has no product contract.
    When I invoke "check" with {"fixture": "ancestry", "case": "mixed-test"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "handlerExecuted" equals true

  Scenario: Registration without a contract does not justify a production handler
    Both live and dead are registered actions, but only live has a contract.
    The declared behavior succeeds; merely registering dead cannot justify it.
    When I invoke "check" with {"fixture": "ancestry", "case": "uncontracted-registration"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "handlerExecuted" equals true

  Scenario: An imported local dependency outside the maintained inventory blocks verification
    The declared handler imports dead.ts, but the policy does not measure that file.
    Its potentially successful result cannot justify running unmeasured code.
    When I invoke "check" with {"fixture": "ancestry", "case": "missing-inventory"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "handlerExecuted" equals false

  Scenario: Raising candidate policy does not increase the reviewed allowance
    The reviewed base permits 400 tokens. The candidate raises its own limit to
    100000 and adds retained material without adding product behavior.
    When I invoke "check" with {"fixture": "ancestry", "case": "trusted-budget"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "decision.ceiling" equals 400
    And response "handlerExecuted" equals true
    When I invoke "config-show" with {"fixture": "ancestry", "case": "trusted-budget"}
    Then response "exitCode" equals 0
    And response "origin.policy" equals "base"
    And response "config.policy.bootstrap" equals 400
    And response "handlerExecuted" equals false

  Scenario: Candidate exclusions and nested project markers cannot hide reviewed source
    The base maintains all of src. The candidate narrows its maintained paths,
    edits exclusions and .gitignore, and adds a nested Bonsai project marker.
    Its two new uncontracted functions must still prevent acceptance.
    When I invoke "check" with {"fixture": "ancestry", "case": "trusted-scope"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "snapshot.unrooted" equals ["src/dead.ts#dead", "src/nested/hidden.ts#hidden"]

  Scenario: An explicit policy deliberately selects different admission rules
    The reviewed base permits 400 tokens, while the explicitly selected policy
    permits 100000. The maintainer deliberately selects those rules for this check.
    When I invoke "check" with {"fixture": "ancestry", "case": "explicit-policy"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.ceiling" equals 100000

  Scenario: A type error prevents execution even when the declared result would match
    The handler would return the expected status, but its source assigns text to
    a numeric variable. A successful response cannot replace valid source analysis.
    When I invoke "check" with {"fixture": "ancestry", "case": "type-error"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "handlerExecuted" equals false
