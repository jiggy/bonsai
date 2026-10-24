Feature: Discover and initialize Bonsai's development loop
  Scenario: Initialize configuration without inventing executable requirements
    When I invoke "init" with {}
    Then response "exitCode" equals 0
    And response "savedConfig.bindings" equals "bonsai.bindings.ts"
    And response "check.exitCode" equals 2
    And response "check.decision.status" equals "incomplete"
    And response "originalSource" equals "export function app() { return 1 }\n"

  Scenario: Discover check capabilities without loading a project
    When I invoke "help" with {"command": "check"}
    Then response "exitCode" equals 0
    And response "name" equals "bonsai"
    And response "command" equals "check"
    And response "commands.check.usage" equals "bonsai check [flags]"
    And response "flags.engine.choices[0]" equals "typescript"
    And response "flags.engine.choices[1]" equals "rust"
    And response "flags.engine.scope[0]" equals "check"
    And response "flags.engine.scope[1]" equals "explain"

  Scenario Outline: Generate completions for a supported shell
    When I invoke "completion" with {"shell": "<shell>"}
    Then response "exitCode" equals 0
    And response "shell" equals "<shell>"
    Examples:
      | shell      |
      | bash       |
      | zsh        |
      | fish       |
      | powershell |

  Scenario: Unsupported shells receive an actionable usage error
    When I invoke "completion" with {"shell": "unsupported"}
    Then response "exitCode" equals 2
    And response "code" equals "USAGE"
