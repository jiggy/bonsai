Feature: Adopt Bonsai while keeping the team's project choices
  A maintainer needs a safe starting point for writing product requirements.
  Initialization must preserve existing work and remember which files the team owns.

  Scenario: A maintainer can start configuring Bonsai without changing application code
    The application has source code but no Bonsai configuration or product contracts.
    Initialization prepares the project so the maintainer can write its first real requirements.
    When I invoke "init" with {}
    Then response "exitCode" equals 0
    And response "configurationExists" equals true
    And response "bindingExists" equals true
    And response "requirementsExist" equals true
    And response "sourceUnchanged" equals true

  Scenario: Running initialization again preserves the team's existing policy and requirements
    This project already has a customized policy, an action registry, and a requirement file.
    Importing the registry would execute application code, so initialization must only inspect files.
    When I invoke "init" with {"fixture": "project", "case": "preserve-existing"}
    Then response "exitCode" equals 2
    And response "configurationUnchanged" equals true
    And response "bindingsUnchanged" equals true
    And response "requirementsUnchanged" equals true
    And response "handlerExecuted" equals false

  Scenario: Adopting Bonsai reuses the registry and requirements the team already wrote
    The application has bindings.ts and an existing requirement, but no policy yet.
    When I invoke "init" with {"fixture": "project", "case": "reuse-inputs"}
    Then response "exitCode" equals 0
    And response "config.bindings" equals "bindings.ts"
    And response "bindingsUnchanged" equals true
    And response "requirementsUnchanged" equals true
    And response "handlerExecuted" equals false

  Scenario: Saved ownership includes future authored code while keeping generated and nested projects separate
    The team ignores generated TypeScript and keeps another Bonsai project under examples.
    After adoption, a new authored file must remain measured even if a later ignore rule hides it.
    When I invoke "init" with {"fixture": "project", "case": "saved-scope"}
    Then response "exitCode" equals 0
    And response "authoredFileMeasured" equals true
    And response "generatedFileMeasured" equals false
    And response "nestedProjectMeasured" equals false

  Scenario: An occupied starter location leaves the project ready for a safe retry
    An existing file occupies the features directory Bonsai would need to create.
    When I invoke "init" with {"fixture": "project", "case": "blocked-starter"}
    Then response "exitCode" equals 2
    And response "configurationExists" equals false
    And response "bindingExists" equals false
    And response "requirementsUnchanged" equals true

  Scenario: A CI job can inspect an explicit piped policy despite stale shell defaults
    The job supplies a policy with a bootstrap allowance of 888 through standard input.
    Its explicit project and policy must override stale environment variables pointing to missing paths.
    Inspecting it must leave the application's saved policy and runtime state alone.
    When I invoke "config-show" with {"fixture": "project", "case": "piped-policy"}
    Then response "exitCode" equals 0
    And response "config.policy.bootstrap" equals 888
    And response "configurationUnchanged" equals true
    And response "handlerExecuted" equals false
