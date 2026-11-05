Feature: Learn how to use Bonsai before configuring a project
  A developer evaluating Bonsai needs local help and a version without loading an application.
  Shell completion should help them find commands they can actually run.

  Scenario: A developer can discover commands and the installed version before configuring a project
    For help and version, both the configured project and native checker are unavailable.
    For completion, the developer has installed the generated script in a clean Bash shell.
    They type bonsai ch and then bonsai e to discover the check and explain commands.
    When I invoke "help" with {"command": "check"}
    Then response "exitCode" equals 0
    And response "commands.check.usage" equals "bonsai check [flags]"
    When I invoke "completion" with {"fixture": "ux", "case": "command-completion"}
    Then response "exitCode" equals 0
    And response "checkCandidates" equals ["check"]
    And response "explainCandidates" equals ["explain"]
    When I invoke "version" with {}
    Then response "exitCode" equals 0
    And response "name" equals "bonsai"
    And response "versionPresent" equals true
