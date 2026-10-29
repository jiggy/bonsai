Feature: Recover from blocked checks and compose Bonsai with other tools
  A maintainer needs to know where a check stopped and how to retry it.
  A CI consumer needs the same incomplete verdict as clean data rather than terminal decoration.

  Scenario: A blocked human check identifies the missing source and offers a repair
    The application launches missing-child.ts, so Bonsai must stop before running its handler.
    The maintainer needs the source location and missing entry to correct the project.
    When I invoke "check" with {"fixture": "ux", "case": "human-blocker"}
    Then response "exitCode" equals 2
    And response "stdout" equals ""
    And response "hasSourceLocation" equals true
    And response "missingEntryVisible" equals true
    And response "hasFix" equals true
    And response "handlerExecuted" equals false

  Scenario: A copied retry preserves the quoted project path until the missing entry is supplied
    The project path contains spaces and an apostrophe, and its local child is missing.
    Copying the suggested check command must report the same incomplete application.
    Compare otherwise identical project copies: one lacks the child; the other supplies it
    and includes it in the reviewed maintained scope.
    When I invoke "check" with {"fixture": "ux", "case": "copied-retry"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "handlerExecuted" equals false
    When I invoke "check" with {"fixture": "ux", "case": "included-child"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "handlerExecuted" equals true
    And response "childExecuted" equals true

  Scenario: Verbose diagnostics report elapsed time even when checking is blocked
    The maintainer requests verbose output for an application with a missing local child.
    They need a displayed duration to understand how long the incomplete check took.
    When I invoke "check" with {"fixture": "ux", "case": "verbose-blocker"}
    Then response "exitCode" equals 2
    And response "hasTimings" equals true

  Scenario: CI receives an incomplete report without terminal decoration
    A missing local child blocks a machine-readable check, even when color is forced.
    When I invoke "check" with {"fixture": "ux", "case": "machine"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "stderr" equals ""
    And response "hasAnsi" equals false

  Scenario: A quiet terminal failure still explains its repair
    A missing local child blocks a quiet human check.
    Omitting progress must preserve the blocker and repair guidance.
    When I invoke "check" with {"fixture": "ux", "case": "quiet"}
    Then response "exitCode" equals 2
    And response "stdout" equals ""
    And response "hasBlocker" equals true
    And response "hasFix" equals true
    And response "hasProgress" equals false
