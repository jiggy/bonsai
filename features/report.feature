Feature: Inspect a saved check without losing the gate's answer
  A developer investigating an expensive implementation needs a standalone HTML report
  to inspect after the command ends. Requesting that report must preserve the check's
  actual rejection or incomplete result and leave JSON available to automation.

  Scenario: Saved reports preserve rejected and incomplete machine-readable answers
    In the first project, the order implementation file contains a specified placeOrder handler
    and an unused legacyPromotion declaration. The reviewed allowance is 100 tokens;
    the complete maintained project costs more than that allowance.
    In a separate project, the order specification invokes place-order but the configured
    actions registry is empty. Its 10000-token allowance is ample; missing execution bindings
    must still prevent acceptance. For each check, the developer requests an HTML file
    to investigate while automation reads the same check as JSON.
    When I invoke "check" with {"fixture": "html-report", "case": "rejected-mixed"}
    Then response "artifacts.exists" equals true
    And response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "decision.ceiling" equals 100
    And response "htmlReport.decision.status" equals "reject"
    And response "htmlReport.decision.ceiling" equals 100

    When I invoke "check" with {"fixture": "html-report", "case": "missing-binding"}
    Then response "artifacts.exists" equals true
    And response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "htmlReport.decision.status" equals "incomplete"

  Scenario: Report defaults support later inspection while opting out permits read-only projects
    The developer checks independent order implementations whose only declaration is the
    specified placeOrder handler. Required behavior succeeds within a 10000-token allowance.
    The first ordinary check has no export option and saves a report for later inspection.
    The second project has read-only implementation, bindings, specification, package,
    configuration and root directory. Its pure handler needs no writes to satisfy the
    specification, so the developer disables the HTML report to check without an artifact.
    When I invoke "check" with {"fixture": "html-report", "case": "default"}
    Then response "artifacts.exists" equals true
    And response "exitCode" equals 0

    When I invoke "check" with {"fixture": "html-report", "case": "disabled-read-only"}
    Then response "artifacts.exists" equals false
    And response "exitCode" equals 0
