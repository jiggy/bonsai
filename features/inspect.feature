Feature: Understand the gate without running the application
  A maintainer investigating a budget or ancestry decision needs to inspect the effective policy
  and the selected component's requirements without triggering application side effects.

  Scenario: A maintainer can inspect the project's saved bootstrap allowance
    The order application has a saved bootstrap allowance of 1000.
    Loading its application module and placing an order each record a separate side effect.
    When I invoke "config-show" with {}
    Then response "exitCode" equals 0
    And response "config.policy.bootstrap" equals 1000
    And response "applicationLoaded" equals false
    And response "handlerExecuted" equals false

  Scenario: A maintainer can inspect the contracted order handler without placing an order
    The placeOrder handler has saved requirements for quantity 1 to be accepted and quantity 0 rejected.
    Loading its application module and placing an order each record a separate side effect.
    When I invoke "explain" with {"target": "orders.ts#placeOrder"}
    Then response "exitCode" equals 0
    And response "components.length" equals 1
    And response "components[0].id" equals "orders.ts#placeOrder"
    And response "requirements" equals [{"action":"place-order","selector":"status","expected":"accepted"},{"action":"place-order","selector":"status","expected":"rejected"}]
    And response "applicationLoaded" equals false
    And response "handlerExecuted" equals false

  Scenario: Automation can distinguish a missing component from a successful explanation
    The requested missing.ts file does not belong to the order application.
    When I invoke "explain" with {"target": "missing.ts"}
    Then response "exitCode" equals 4
    And response "applicationLoaded" equals false
    And response "handlerExecuted" equals false
