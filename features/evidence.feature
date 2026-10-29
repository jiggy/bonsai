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
    Application calls are held active while another required call awaits execution.
    One of the active calls then exits before returning its required response.
    When I invoke "check" with {"fixture": "verification", "case": "crash"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "application.started" equals true
    And response "application.queuedInputsStarted" equals []
    And response "application.runningPids" equals []

  Scenario: The shared feedback deadline stops all active scenarios
    Application calls remain blocked while another required call awaits execution.
    They must stop when the existing shared feedback deadline expires.
    When I invoke "check" with {"fixture": "verification", "case": "timeout"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "application.started" equals true
    And response "application.queuedInputsStarted" equals []
    And response "application.runningPids" equals []

  Scenario: Cancelling a command stops active scenarios and leaves queued work unstarted
    Application calls are held active while another required call awaits execution.
    The maintainer interrupts the command with SIGINT.
    When I invoke "check" with {"fixture": "verification", "case": "cancel"}
    Then response "exitCode" equals 130
    And response "code" equals "SIGINT"
    And response "application.started" equals true
    And response "application.queuedInputsStarted" equals []
    And response "application.runningPids" equals []

  Scenario: Changing maintained inputs invalidates otherwise passing observations
    A required action returns its expected status "ok", but also changes the maintained
    data.json from revision 1 to revision 2 during verification. Its passing observation
    cannot authorize the changed project inputs.
    When I invoke "check" with {"fixture": "verification", "case": "source-change"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "maintainedText" equals "{\"revision\":2}\n"

  Scenario Outline: Required supporting verification must finish successfully
    A readiness observation passes for both the correct and the faulty doubling
    helper. The maintainer also requires a separate supporting suite that checks
    doubling with a real assertion and emits a Vitest-compatible report. A skipped
    assertion or an old report left by a command that does no work cannot satisfy it.
    When I invoke "check" with {"fixture": "supporting-suite", "case": "<case>"}
    Then response "exitCode" equals <exit>
    And response "decision.status" equals "<status>"

    Examples:
      | case    | exit | status     |
      | passed  | 0    | pass       |
      | failed  | 1    | reject     |
      | skipped | 2    | incomplete |
      | stale   | 2    | incomplete |

  Scenario: A report path cannot overwrite an authored project input
    The maintainer accidentally names the authored project notes as a supporting
    report destination. Bonsai must reject the configuration and preserve the
    authored notes.
    When I invoke "check" with {"fixture": "supporting-suite", "case": "input-overlap"}
    Then response "exitCode" equals 2
    And response "maintainedText" equals "Authored project notes\n"
