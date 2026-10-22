Feature: Inspect the gate without executing application handlers
  Scenario: Show the effective project policy
    When I invoke "config-show" with {}
    Then response "exitCode" equals 0
    And response "origin.policy" equals "project"
    And response "config.bindings" equals "bindings.ts"
    And response "config.policy.bootstrap" equals 1000
    And response "handlerExecuted" equals false

  Scenario: Explain a component's required checks
    When I invoke "explain" with {"target": "orders.ts#placeOrder"}
    Then response "exitCode" equals 0
    And response "components[0].id" equals "orders.ts#placeOrder"
    And response "components[0].checks.length" equals 2
    And response "handlerExecuted" equals false

  Scenario: An unknown component has a distinct failure status
    When I invoke "explain" with {"target": "missing.ts"}
    Then response "exitCode" equals 4
    And response "code" equals "NOT_FOUND"
    And response "handlerExecuted" equals false
