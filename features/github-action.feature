Feature: Keep pull requests within their reviewed code allowance
  A repository maintainer uses jiggy/bonsai as a required GitHub Actions check.
  A complete passing check permits the PR; an over-budget or incomplete check
  must fail the action so GitHub can block merging. The base branch supplies
  the reviewed policy and inventory.

  Scenario: Required behavior fits the reviewed allowance
    The TypeScript application returns the required status and fits a 1000-token ceiling.
    When I invoke "jiggy/bonsai" with {}
    Then response "status" equals "pass"
    And response "exitCode" equals 0

  Scenario: A pull request cannot buy itself permission to exceed the allowance
    A working application grows beyond its base branch's 1000-token ceiling.
    The candidate raises its own limit and removes the handler from its inventory.
    When I invoke "jiggy/bonsai" with {"change": "grow"}
    Then response "status" equals "reject"
    And response "exitCode" equals 1

  Scenario: Incomplete verification cannot permit a pull request
    The application is within its token ceiling but refers to a missing value.
    Bonsai cannot complete source analysis or verify the required behavior.
    When I invoke "jiggy/bonsai" with {"change": "incomplete"}
    Then response "status" equals "incomplete"
    And response "exitCode" equals 2
