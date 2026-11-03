Feature: Keep requirements connected across domain language and command routes
  Publishers need to describe the work they commission in their own language.
  Maintainers need to follow those requirements into the application selected by a reviewed command route.

  Scenario: Publisher wording preserves context when a commission requirement is repeated
    The publisher's Given selects "daily practice" as the reader problem, the When commissions a pilot,
    and the Then requires both a sample and practice materials from the real application.
    Repeating that requirement must execute every commission without buying more product allowance.
    When I invoke "check" with {"fixture": "integrations", "case": "publisher", "examples": 1}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 2
    And response "invocationCount" equals 1
    And response "inputValues" equals ["daily practice"]
    When I invoke "check" with {"fixture": "integrations", "case": "publisher", "examples": 2}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 2
    And response "invocationCount" equals 2
    And response "inputValues" equals ["daily practice", "daily practice"]

  Scenario: Each missing deliverable prevents the publisher's request from passing
    A single publisher-facing Then requires a sample and its practice materials independently.
    The application receives the chosen reader problem but omits one of those deliverables.
    When I invoke "check" with {"fixture": "integrations", "case": "publisher", "missing": "sample"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "invocationCount" equals 1
    And response "inputValues" equals ["daily practice"]
    When I invoke "check" with {"fixture": "integrations", "case": "publisher", "missing": "materials"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "invocationCount" equals 1
    And response "inputValues" equals ["daily practice"]

  Scenario: A maintainer distinguishes selected and unrelated code without running the application
    The contracted pilot wrapper invokes Jig's binding:pilot route in its explicit project directory.
    The reviewed binding selects a pilot flow whose method creates practice materials through a helper.
    A separate flow is maintained but never selected; sharing the project cannot justify its method.
    Loading or invoking application code records a side effect that an explanation must leave absent.
    When I invoke "explain" with {"fixture": "integrations", "target": "flows/pilot/method.ts#execute"}
    Then response "exitCode" equals 0
    And response "components.length" equals 1
    And response "components[0].id" equals "flows/pilot/method.ts#execute"
    And response "requirements" equals [{"action":"pilot","selector":"status","expected":"ready"}]
    And response "applicationLoaded" equals false
    And response "handlerExecuted" equals false
    When I invoke "explain" with {"fixture": "integrations", "target": "flows/pilot/materials.ts#createMaterials"}
    Then response "exitCode" equals 0
    And response "components.length" equals 1
    And response "components[0].id" equals "flows/pilot/materials.ts#createMaterials"
    And response "requirements" equals [{"action":"pilot","selector":"status","expected":"ready"}]
    And response "applicationLoaded" equals false
    And response "handlerExecuted" equals false
    When I invoke "explain" with {"fixture": "integrations", "target": "flows/unrelated/method.ts#execute"}
    Then response "exitCode" equals 0
    And response "components.length" equals 1
    And response "components[0].id" equals "flows/unrelated/method.ts#execute"
    And response "requirements" equals []
    And response "applicationLoaded" equals false
    And response "handlerExecuted" equals false
