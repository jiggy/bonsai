Feature: Inspect a saved check without losing the gate's answer
  A developer investigating an expensive implementation needs a standalone HTML report
  to inspect after the command ends. Requesting that report must preserve the check's
  actual rejection or incomplete result and leave JSON available to automation.

  Scenario: Export a rejected mixed-file check without changing its machine-readable answer
    The order implementation file contains a specified placeOrder handler
    and an unused legacyPromotion declaration. The reviewed allowance is 100 tokens;
    the complete maintained project costs more than that allowance.
    The developer requests an HTML file while automation reads the same check as JSON.
    When I invoke "check" with {"fixture": "html-report", "case": "rejected-mixed"}
    Then response "artifacts.exists" equals true
    And response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "decision.ceiling" equals 100
    And response "htmlReport.decision.status" equals "reject"
    And response "htmlReport.decision.ceiling" equals 100

  Scenario: Export an incomplete check while an order action still has no handler binding
    The order specification invokes place-order, but the configured actions registry is empty.
    Its 10000-token allowance is ample; missing execution bindings must still prevent acceptance.
    The developer requests the HTML report to investigate, while automation reads JSON.
    When I invoke "check" with {"fixture": "html-report", "case": "missing-binding"}
    Then response "artifacts.exists" equals true
    And response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "htmlReport.decision.status" equals "incomplete"

  Scenario: A normal check saves a report without an export option
    A developer checks an order implementation whose only declaration is its specified
    placeOrder handler. All required behavior succeeds within its 10000-token allowance.
    The developer can inspect the saved report after this ordinary check finishes.
    When I invoke "check" with {"fixture": "html-report", "case": "default"}
    Then response "artifacts.exists" equals true
    And response "exitCode" equals 0

  Scenario: Opting out permits checking a read-only project without creating a report
    The order application has read-only permissions on its implementation, bindings,
    specification, package, configuration and root directory. Its pure placeOrder handler
    needs no writes to satisfy the specification.
    The developer disables the HTML report to check this application without an artifact.
    When I invoke "check" with {"fixture": "html-report", "case": "disabled-read-only"}
    Then response "artifacts.exists" equals false
    And response "exitCode" equals 0
