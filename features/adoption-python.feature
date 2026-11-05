Feature: Check Python applications through native bindings
  Teams can connect their own named handlers without maintaining a TypeScript bridge.
  Installed language backends apply the same admission rules and behavioral gate.

  Scenario: A Python team checks its application without TypeScript bindings
    The maintained application and its action dictionary are Python files.
    Bonsai must exercise the named handler and apply the same behavioral gate.
    When I invoke "check" with {"fixture": "python"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
