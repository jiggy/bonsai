Feature: Understand the gate without running the application
  A maintainer investigating a budget or ancestry decision needs to inspect the effective policy
  and the selected component's requirements without triggering application side effects.

  Scenario: A maintainer can inspect the project's saved bootstrap allowance
    The order application has a saved bootstrap allowance of 1000 and a handler with side effects.
    When I invoke "config-show" with {}
    Then response "exitCode" equals 0
    And response "config.policy.bootstrap" equals 1000
    And response "handlerExecuted" equals false

  Scenario: A maintainer can inspect the contracted order handler without placing an order
    The placeOrder handler has requirements for accepted and rejected quantities.
    When I invoke "explain" with {"target": "orders.ts#placeOrder"}
    Then response "exitCode" equals 0
    And response "components.length" equals 1
    And response "components[0].id" equals "orders.ts#placeOrder"
    And response "components[0].checks.length" equals 2
    And response "handlerExecuted" equals false

  Scenario: Automation can distinguish a missing component from a successful explanation
    The requested missing.ts file does not belong to the order application.
    When I invoke "explain" with {"target": "missing.ts"}
    Then response "exitCode" equals 4
    And response "handlerExecuted" equals false
