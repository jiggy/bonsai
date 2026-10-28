Feature: Verify every required behavior without leaving application work running
  Independent scenarios may make progress together. A failed, cancelled, or
  expired verification cannot accept the project or leave its application work running.

  Scenario: Every required independent call runs once and finishes
    Three independent application inputs must each run exactly once, regardless
    of how many scenarios the host can execute together.
    When I invoke "check" with {"fixture": "verification", "case": "required-calls"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "application.startedInputs" equals [0, 1, 2]
    And response "application.finishedInputs" equals [0, 1, 2]
    And response "application.runningPids" equals []

  Scenario: A crashed scenario cancels its peers without starting queued work
    When I invoke "check" with {"fixture": "verification", "case": "crash"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "application.started" equals true
    And response "application.queuedInputsStarted" equals []
    And response "application.runningPids" equals []

  Scenario: The shared feedback deadline stops all active scenarios
    When I invoke "check" with {"fixture": "verification", "case": "timeout"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "application.started" equals true
    And response "application.queuedInputsStarted" equals []
    And response "application.runningPids" equals []

  Scenario: Cancelling a command stops active scenarios and leaves queued work unstarted
    When I invoke "check" with {"fixture": "verification", "case": "cancel"}
    Then response "exitCode" equals 130
    And response "code" equals "SIGINT"
    And response "application.started" equals true
    And response "application.queuedInputsStarted" equals []
    And response "application.runningPids" equals []

  Scenario: Changing maintained inputs invalidates otherwise passing observations
    When I invoke "check" with {"fixture": "verification", "case": "source-change"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "maintainedText" equals "{\"revision\":2}\n"
