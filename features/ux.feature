Feature: Recover from blocked checks and compose Bonsai with other tools
  A maintainer needs to know where a check stopped and how to retry it.
  A CI consumer needs the same incomplete verdict as clean data rather than terminal decoration.

  Scenario: Missing-source guidance supports a quoted retry and a verified repair
    The application launches missing-child.ts, so Bonsai must stop before running its handler.
    The maintainer needs the source location and missing entry to correct the project.
    A separate project path contains spaces and an apostrophe, and its local child is missing.
    Copying the suggested check command must report the same incomplete application.
    An otherwise identical independent project supplies the child and includes it in the
    reviewed maintained scope, allowing the maintainer to verify the repair.
    When I invoke "check" with {"fixture": "ux", "case": "human-blocker"}
    Then response "exitCode" equals 2
    And response "stdout" equals ""
    And response "hasSourceLocation" equals true
    And response "missingEntryVisible" equals true
    And response "hasFix" equals true
    And response "handlerExecuted" equals false

    When I invoke "check" with {"fixture": "ux", "case": "copied-retry"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "handlerExecuted" equals false
    When I invoke "check" with {"fixture": "ux", "case": "included-child"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "handlerExecuted" equals true
    And response "childExecuted" equals true

  Scenario: Output modes preserve useful blocked-check answers for people and automation
    Independent projects each lack a local child. The maintainer first requests verbose
    diagnostics and needs a displayed duration for the incomplete check.
    Next, CI requests machine-readable data even when color is forced.
    Finally, a quiet human check omits progress while preserving the blocker and repair guidance.
    When I invoke "check" with {"fixture": "ux", "case": "verbose-blocker"}
    Then response "exitCode" equals 2
    And response "hasTimings" equals true

    When I invoke "check" with {"fixture": "ux", "case": "machine"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "stderr" equals ""
    And response "hasAnsi" equals false

    When I invoke "check" with {"fixture": "ux", "case": "quiet"}
    Then response "exitCode" equals 2
    And response "stdout" equals ""
    And response "hasBlocker" equals true
    And response "hasFix" equals true
    And response "hasProgress" equals false
