Feature: Admit only supported implementations of required behavior
  Scenario: A contracted subprocess justifies its executable entry point
    When I invoke "check" with {"subprocess": "live"}
    Then response "exitCode" equals 0
    And response "snapshot.evidence.complete" equals true
    And response "childExecuted" equals true
    And response "childMeasured" equals true
    And response "childHasAncestry" equals true

  Scenario: Launching a child does not justify its unused exports
    When I invoke "check" with {"subprocess": "unused"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "snapshot.unrooted[0]" equals "order-worker.ts#unused"
    And response "childExecuted" equals true
    And response "childMeasured" equals true
    And response "childHasAncestry" equals true

  Scenario: An uncontracted subprocess does not justify its child
    When I invoke "check" with {"subprocess": "uncontracted"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "handlerExecuted" equals true
    And response "childExecuted" equals false
    And response "childMeasured" equals true
    And response "childHasAncestry" equals false

  Scenario: A missing local subprocess entry point blocks verification
    When I invoke "check" with {"subprocess": "missing"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "handlerExecuted" equals false
    And response "childExecuted" equals false
    And response "verificationTiming.status" equals "skipped"

  Scenario: Checking needs a working native collector before handlers can run
    When I invoke "check" with {"missingNative": true}
    Then response "exitCode" equals 1
    And response "code" equals "RUST_COLLECTOR"
    And response "run" equals "export BONSAI_NATIVE_BINARY=/absolute/path/to/tsrs"
    And response "handlerExecuted" equals false

  Scenario: Verify behavior with the Rust TypeScript checker
    When I invoke "check" with {"examples": 2}
    Then response "exitCode" equals 0
    And response "snapshot.analysis.engine" equals "rust"
    And response "snapshot.analysis.backend" equals "tsrs"
    And response "snapshot.analysis.validation" equals "native-diagnostics"
    And response "snapshot.analysis.status" equals "complete"
    And response "snapshot.evidence.complete" equals true
    And response "snapshot.evidence.checks.length" equals 2
    And response "handlerExecuted" equals true

  Scenario: Rust tracing keeps unsupported runtime imports incomplete
    When I invoke "check" with {"computedImport": true}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "snapshot.source.problems.length" equals 1
    And response "handlerExecuted" equals false

  Scenario: Verify every example without multiplying the allowance
    When I invoke "check" with {"examples": 3}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 1
    And response "snapshot.evidence.checks.length" equals 3
    And response "handlerExecuted" equals true

  Scenario: Additional examples still share the same external surface
    When I invoke "check" with {"examples": 5}
    Then response "decision.surface" equals 1
    And response "snapshot.evidence.checks.length" equals 5
    And response "decision.status" equals "pass"

  Scenario: Measure the command and candidate verification
    When I invoke "check" with {"examples": 1}
    Then response "exitCode" equals 0
    And response "timingMeasured" equals true
    And response "timing.feedback.limitMs" equals 15000
    And response "verificationTiming.name" equals "verification"
    And response "verificationTiming.status" equals "completed"
    And response "sourceTiming.stages[0].name" equals "measurement"
    And response "sourceTiming.stages[1].name" equals "program"
    And response "sourceTiming.stages[2].name" equals "diagnostics"
    And response "sourceTiming.stages[2].status" equals "completed"
    And response "sourceTiming.stages[3].name" equals "graph"

  Scenario: Wrong behavior is rejected
    When I invoke "check" with {"broken": true}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "snapshot.evidence.checks[0].status" equals "passed"
    And response "snapshot.evidence.checks[1].status" equals "failed"

  Scenario: An unused symbol in a used module has no product justification
    When I invoke "check" with {"unrooted": true}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "snapshot.unrooted[0]" equals "orders.ts#unused"

  Scenario: Passing behavior must fit the retained-code ceiling
    When I invoke "check" with {"overBudget": true}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "decision.ceiling" equals 1
    And response "snapshot.evidence.checks[1].status" equals "passed"

  Scenario: Missing contracts cannot grant a pass
    When I invoke "check" with {"missingContracts": true}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "snapshot.contracts.cases.length" equals 0
    And response "handlerExecuted" equals false

  Scenario: An unbound external action cannot grant a pass
    When I invoke "check" with {"unbound": true}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "handlerExecuted" equals false

  Scenario: Saved exclusions determine the declared analysis scope
    When I invoke "check" with {"ignoredCode": true}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "snapshot.unrooted.length" equals 0

  Scenario: Unsupported runtime imports cannot skip source tracing
    When I invoke "check" with {"computedImport": true}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "snapshot.source.problems.length" equals 1
    And response "handlerExecuted" equals false
    And response "timingMeasured" equals true
    And response "verificationTiming.status" equals "skipped"

  Scenario: Independent scenarios keep fresh state and ordered steps
    When I invoke "verify-isolated-scenarios" with {}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "snapshot.verification.profile" equals "isolated-scenarios-v1"
    And response "cpuPlanMatches" equals true
    And response "snapshot.evidence.profile" equals "isolated-scenarios-v1"
    And response "snapshot.evidence.complete" equals true
    And response "snapshot.evidence.checks.length" equals 4
    And response "observations" equals ["passed", "passed", "passed", "passed"]

  Scenario: Serial verification preserves state between ordered scenarios
    When I invoke "verify-isolated-scenarios" with {"serial": true}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "snapshot.verification.profile" equals "in-process-v1"
    And response "snapshot.verification.workers" equals 1
    And response "snapshot.evidence.profile" equals "in-process-v1"
    And response "snapshot.evidence.complete" equals true
    And response "snapshot.evidence.checks.length" equals 4
    And response "observations" equals ["passed", "passed", "passed", "passed"]
