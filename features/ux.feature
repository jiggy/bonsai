Feature: Recover from blocked checks and compose Bonsai with other tools
  A maintainer needs to know where a check stopped and how to retry it.
  A CI consumer needs the same incomplete verdict as clean data rather than terminal decoration.

  Scenario: Providing the missing entry point makes the blocked application admissible
    The application launches missing-child.ts, so Bonsai must stop before running its handler.
    The terminal is only 32 columns wide and the project path contains spaces and an apostrophe.
    The maintainer requests verbose output to investigate how long the check took.
    Compare otherwise identical project copies: one lacks the child; the other supplies it
    and includes it in the reviewed maintained scope.
    When I invoke "check" with {"fixture": "ux", "case": "human-blocker"}
    Then response "exitCode" equals 2
    And response "stdout" equals ""
    And response "titleWrapped" equals true
    And response "hasSourceLocation" equals true
    And response "missingEntryVisible" equals true
    And response "hasFix" equals true
    And response "hasTimings" equals true
    And response "recoveryExitCode" equals 2
    And response "recoveryDecision" equals "incomplete"
    And response "handlerExecuted" equals false
    When I invoke "check" with {"fixture": "ux", "case": "included-child"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "handlerExecuted" equals true
    And response "childExecuted" equals true

  Scenario: CI receives the incomplete report while a quiet terminal failure still explains its repair
    The same missing local worker blocks a machine-readable check and a quiet human check.
    Neither consumer should mistake omitted progress for a successful verification.
    When I invoke "check" with {"fixture": "ux", "case": "machine-quiet"}
    Then response "machine.exitCode" equals 2
    And response "machine.report.decision.status" equals "incomplete"
    And response "machine.stderr" equals ""
    And response "quiet.exitCode" equals 2
    And response "quiet.stdout" equals ""
    And response "quiet.hasBlocker" equals true
    And response "quiet.hasFix" equals true
    And response "quiet.hasProgress" equals false
