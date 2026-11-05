Feature: Keep pull requests within their reviewed code allowance
  A repository maintainer uses jiggy/bonsai as a required GitHub Actions check.
  A complete passing check permits the PR; an over-budget or incomplete check
  must fail the action so GitHub can block merging. The base branch supplies
  the reviewed policy and inventory.

  Scenario: Only a complete candidate within the base allowance permits a pull request
    The maintainer compares three independent TypeScript application changes.
    The first returns the required status and fits its reviewed 1000-token ceiling.
    The second works but grows beyond its base branch's 1000-token ceiling;
    the candidate raises its own limit and removes the handler from its inventory.
    The third is within its token ceiling but refers to a missing value, preventing
    complete source analysis and verification of its required behavior.
    When I invoke "jiggy/bonsai" with {}
    Then response "status" equals "pass"
    And response "exitCode" equals 0
    When I invoke "jiggy/bonsai" with {"change": "grow"}
    Then response "status" equals "reject"
    And response "exitCode" equals 1
    When I invoke "jiggy/bonsai" with {"change": "incomplete"}
    Then response "status" equals "incomplete"
    And response "exitCode" equals 2
