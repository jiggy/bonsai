Feature: Admit implementations that fulfill their declared behavior within the code allowance
  A maintainer can admit a supported implementation only when its required
  behavior passes, its retained code is justified, and it fits the reviewed limit.
  Unsupported analysis must stop before the application runs.

  Scenario: A supported application fulfills its declared requests
    The application accepts a positive quantity and rejects a zero quantity.
    It delegates its answer to a maintained worker, and its source fits the allowance.
    When I invoke "check" with {"subprocess": "live"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "childExecuted" equals true
    And response "invocationCount" equals 2

  Scenario: Unavailable or unsupported source analysis stops before application handlers run
    The maintainer checks two independent applications. The first has no selected local
    checker executable; the second required handler selects its imported module at runtime.
    Neither analysis blocker may bypass source tracing and run the application.
    When I invoke "check" with {"missingNative": true}
    Then response "exitCode" equals 1
    And response "handlerExecuted" equals false

    When I invoke "check" with {"computedImport": true}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "handlerExecuted" equals false

  Scenario: Additional examples still share the same external surface
    Repeating a required request strengthens verification without earning space.
    When I invoke "check" with {"examples": 5}
    Then response "decision.surface" equals 1
    And response "decision.status" equals "pass"
    And response "invocationCount" equals 5

  Scenario: Completed checks reject incorrect behavior, unjustified code, and excess retained cost
    The maintainer compares three independent order applications.
    The first incorrectly accepts a zero quantity, although that request must be rejected.
    The second has a working handler that shares its module with an unused exported operation.
    The third fulfills its requests but its maintained source exceeds a one-token limit.
    When I invoke "check" with {"broken": true}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "handlerExecuted" equals true
    And response "invocationCount" equals 2

    When I invoke "check" with {"unrooted": true}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "snapshot.unrooted" equals ["orders.ts#unused"]

    When I invoke "check" with {"overBudget": true}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "decision.ceiling" equals 1
    And response "invocationCount" equals 2

  Scenario: A comment-only requirement or unbound action cannot grant admission
    The first application has no executable contract, only a comment in its requirement file.
    An independent application has a requirement naming an operation its registry does not bind.
    When I invoke "check" with {"missingContracts": true}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "handlerExecuted" equals false

    When I invoke "check" with {"unbound": true}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "handlerExecuted" equals false

  Scenario: Saved exclusions determine the declared analysis scope
    An authored unused module is explicitly outside the reviewed maintained scope.
    When I invoke "check" with {"ignoredCode": true}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "snapshot.unrooted" equals []

  Scenario: Independent scenarios keep fresh state and ordered steps
    Two scenarios each advance their own counter twice, expecting one then two.
    When I invoke "check" with {"fixture": "scenario-state"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "invocationCount" equals 4

  Scenario: Serial verification preserves state between ordered scenarios
    The counter is shared: the first scenario expects one then two and the next expects three then four.
    When I invoke "check" with {"fixture": "scenario-state", "serial": true}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "invocationCount" equals 4

  Scenario: Reviewed nesting limits apply even when behavior fits the code allowance
    The team permits at most four nested decisions. The application evaluates five
    approval conditions and fulfills its accepted and denied requests under budget.
    A guard-clause rewrite preserves those requests with shallower control flow.
    The maintainer checks the nested implementation and the rewrite independently.
    When I invoke "check" with {"fixture": "control-depth", "layout": "nested"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    When I invoke "check" with {"fixture": "control-depth", "layout": "flat"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"

  Scenario: A Python team checks its application without TypeScript bindings
    The maintained application and its action dictionary are Python files.
    Bonsai must exercise the named handler and apply the same behavioral gate.
    When I invoke "check" with {"fixture": "python"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
