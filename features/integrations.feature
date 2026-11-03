Feature: Keep requirements connected across domain language and command routes
  Publishers need to describe the work they commission in their own language.
  Maintainers need to follow those requirements into the application selected by a reviewed command route.

  Scenario Outline: Publisher wording preserves context and every required commission
    The publisher's Given selects "daily practice" as the reader problem, the When commissions a pilot,
    and the Then requires both a sample and practice materials from the real application.
    Repeating that requirement must execute every commission without buying more product allowance.
    When I invoke "check" with {"fixture": "integrations", "case": "publisher", "examples": <examples>}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.surface" equals 2
    And response "invocationCount" equals <examples>
    And response "inputValues" equals <problems>

    Examples:
      | examples | problems                             |
      | 1        | ["daily practice"]                   |
      | 2        | ["daily practice", "daily practice"] |

  Scenario Outline: Delivering only part of a publisher's request cannot pass
    A single publisher-facing Then requires a sample and its practice materials independently.
    The application receives the chosen reader problem but omits one of those deliverables.
    When I invoke "check" with {"fixture": "integrations", "case": "publisher", "missing": "<missing>"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "invocationCount" equals 1
    And response "inputValues" equals ["daily practice"]

    Examples:
      | missing   |
      | sample    |
      | materials |

  Scenario Outline: A maintainer follows the selected command route without running the application
    The contracted pilot wrapper invokes Jig's binding:pilot route in its explicit project directory.
    The reviewed binding selects a pilot flow whose method creates practice materials through a helper.
    A separate flow is maintained but never selected; sharing the project cannot justify its method.
    Loading or invoking application code records a side effect that an explanation must leave absent.
    When I invoke "explain" with {"fixture": "integrations", "target": "<target>"}
    Then response "exitCode" equals 0
    And response "components.length" equals 1
    And response "components[0].id" equals "<target>"
    And response "requirements" equals <requirements>
    And response "applicationLoaded" equals false
    And response "handlerExecuted" equals false

    Examples:
      | target                                 | requirements                                              |
      | flows/pilot/method.ts#execute            | [{"action":"pilot","selector":"status","expected":"ready"}] |
      | flows/pilot/materials.ts#createMaterials | [{"action":"pilot","selector":"status","expected":"ready"}] |
      | flows/unrelated/method.ts#execute        | []                                                        |
