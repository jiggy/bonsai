Feature: Complete every required observation with fresh and bounded execution
  Scenarios are independent by default. Their real handler calls, ordering, and
  shutdown remain obligations when Bonsai optimizes verification.

  Scenario: Available workers make progress while an earlier scenario is held
    When I invoke "check" with {"fixture": "verification", "case": "overlap"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "snapshot.evidence.complete" equals true
    And response "execution.unoccupiedSlots" equals 0
    And response "execution.excessWorkers" equals 0
    And response "execution.missingInputs" equals []
    And response "execution.repeatedInputs" equals []
    And response "execution.unfinishedInputs" equals []
    And response "execution.reportOrderMismatches" equals 0
    And response "execution.liveWorkers" equals 0

  Scenario: A crashed scenario cancels its peers without starting queued work
    When I invoke "check" with {"fixture": "verification", "case": "crash"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "snapshot.source.problems.length" equals 1
    And response "execution.noHandlerStarted" equals false
    And response "execution.queuedStarts" equals 0
    And response "execution.liveWorkers" equals 0

  Scenario: The shared feedback deadline stops all active scenarios
    When I invoke "check" with {"fixture": "verification", "case": "timeout"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "snapshot.source.problems.length" equals 1
    And response "execution.noHandlerStarted" equals false
    And response "execution.queuedStarts" equals 0
    And response "execution.liveWorkers" equals 0

  Scenario: Cancelling a command stops active scenarios and leaves queued work unstarted
    When I invoke "check" with {"fixture": "verification", "case": "cancel"}
    Then response "exitCode" equals 130
    And response "code" equals "SIGINT"
    And response "execution.noHandlerStarted" equals false
    And response "execution.queuedStarts" equals 0
    And response "execution.liveWorkers" equals 0

  Scenario: Changing maintained inputs invalidates otherwise passing observations
    When I invoke "check" with {"fixture": "verification", "case": "source-change"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "snapshot.evidence.complete" equals true
    And response "snapshot.evidence.checks[0].status" equals "passed"
    And response "snapshot.source.problems[0]" equals "Maintained files changed during verification"
    And response "maintainedText" equals "{\"revision\":2}\n"
