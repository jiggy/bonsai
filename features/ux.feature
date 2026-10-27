Feature: Recover from blocked checks and compose Bonsai with other tools
  Scenario: A blocked human check explains its cause and preserves readable alert and repair text
    When I invoke "check" with {"fixture": "ux", "case": "human-blocker"}
    Then response "exitCode" equals 2
    And response "stdout" equals ""
    And response "title" equals "Can't trace 1 local subprocess entry point"
    And response "titleColors" equals [31]
    And response "titleDimmed" equals false
    And response "titleWrapped" equals true
    And response "hasSourceLocation" equals true
    And response "hasFix" equals true
    And response "recoveryExitCode" equals 2
    And response "recoveryDecision" equals "incomplete"
    And response "handlerExecuted" equals false

  Scenario: Machine reports stay complete and clean while quiet failures retain their repair
    When I invoke "check" with {"fixture": "ux", "case": "machine-quiet"}
    Then response "machine.exitCode" equals 2
    And response "machine.report.decision.status" equals "incomplete"
    And response "machine.report.snapshot.source.problems.length" equals 1
    And response "machine.stderr" equals ""
    And response "machine.hasAnsi" equals false
    And response "quiet.exitCode" equals 2
    And response "quiet.stdout" equals ""
    And response "quiet.hasBlocker" equals true
    And response "quiet.hasFix" equals true
    And response "quiet.hasProgress" equals false
    And response "quiet.hasMeasurements" equals false

  Scenario: Generated Bash completions offer a usable command-scoped serial flag
    When I invoke "completion" with {"fixture": "ux", "case": "completion"}
    Then response "exitCode" equals 0
    And response "shell" equals "bash"
    And response "bashExitCode" equals 0
    And response "checkCandidates" equals ["--serial"]
    And response "explainCandidates" equals []
