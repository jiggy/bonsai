Feature: Check Rust applications through native bindings
  Teams can connect their own named handlers without maintaining a TypeScript bridge.
  Installed language backends apply the same admission rules and behavioral gate.

  Scenario: A Rust team checks its application without a TypeScript bridge
    The team has installed the supported Rust toolchain. Its maintained handlers
    and literal native bindings are Rust files, without a Cargo dependency or SDK.
    Bonsai must exercise the named handler and apply the same behavioral gate.
    When I invoke "check" with {"fixture": "rust"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
