Feature: Adopt Bonsai without changing the application's existing choices
  Scenario: Existing configuration is never overwritten or executed by initialization
    When I invoke "init" with {"fixture": "project", "case": "preserve-existing"}
    Then response "exitCode" equals 2
    And response "code" equals "CONFIG_EXISTS"
    And response "configurationText" equals "// Keep the existing policy\n{\"custom\":true}\n"
    And response "bindingText" equals "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('./must-not-run', import.meta.url), 'ran')\nexport const actions = {}\n"
    And response "featureText" equals "# Keep this existing requirement\nFeature: Existing product\n"
    And response "handlerExecuted" equals false

  Scenario: Initialization reuses existing bindings and product requirements
    When I invoke "init" with {"fixture": "project", "case": "reuse-inputs"}
    Then response "exitCode" equals 0
    And response "config.bindings" equals "bindings.ts"
    And response "bindingText" equals "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('./must-not-run', import.meta.url), 'ran')\nexport const actions = {}\n"
    And response "featureText" equals "# Keep this existing requirement\nFeature: Existing product\n"
    And response "handlerExecuted" equals false

  Scenario: Saved scope includes future authored files and keeps ignored or nested inputs outside the parent
    When I invoke "init" with {"fixture": "project", "case": "saved-scope"}
    Then response "exitCode" equals 0
    And response "inventory" equals [".gitignore", "bonsai.bindings.ts", "bonsai.json", "features/bonsai.feature", "package.json", "src/app.ts", "src/later.ts"]
    And response "nestedConfigurationText" equals "{}\n"

  Scenario: An obstructed starter path fails before initialization writes any files
    When I invoke "init" with {"fixture": "project", "case": "blocked-starter"}
    Then response "exitCode" equals 2
    And response "code" equals "INIT"
    And response "configurationExists" equals false
    And response "bindingExists" equals false
    And response "featuresText" equals "Keep the existing features file\n"

  Scenario: Explicit JSONC configuration overrides environment defaults without running handlers
    When I invoke "config-show" with {"fixture": "project", "case": "config-precedence"}
    Then response "exitCode" equals 0
    And response "origin.root" equals "--root"
    And response "origin.policy" equals "--policy"
    And response "config.policy.bootstrap" equals 777
    And response "configurationUnchanged" equals true
    And response "handlerExecuted" equals false

  Scenario: Piped JSONC policy is inspected without changing the project or running handlers
    When I invoke "config-show" with {"fixture": "project", "case": "piped-policy"}
    Then response "exitCode" equals 0
    And response "file" equals "stdin"
    And response "origin.policy" equals "--policy"
    And response "config.policy.bootstrap" equals 888
    And response "configurationUnchanged" equals true
    And response "handlerExecuted" equals false

  Scenario: Explanation exposes contract ancestry and source relationships without running the application
    When I invoke "explain" with {"fixture": "project", "case": "explain-readonly"}
    Then response "exitCode" equals 0
    And response "components[0].id" equals "handler.ts#app"
    And response "components[0].checks.length" equals 1
    And response "components[0].relationships[0].from" equals "bindings.ts#actions"
    And response "components[0].relationships[0].to" equals "handler.ts#app"
    And response "handlerExecuted" equals false

  Scenario: Piped explanation targets are normalized without running the application
    When I invoke "explain" with {"fixture": "project", "case": "piped-target"}
    Then response "exitCode" equals 0
    And response "components.length" equals 1
    And response "components[0].id" equals "handler.ts#app"
    And response "components[0].checks.length" equals 1
    And response "handlerExecuted" equals false

  Scenario: Policy and explanation targets cannot both consume the same input stream
    When I invoke "explain" with {"fixture": "project", "case": "conflicting-pipes"}
    Then response "exitCode" equals 2
    And response "code" equals "USAGE"
    And response "handlerExecuted" equals false
