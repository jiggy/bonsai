Feature: Retain production code only through declared product behavior
  Unit tests support contracted production subjects. They cannot create product
  scope, and a candidate cannot silently weaken reviewed base rules or inventory.

  Scenario Outline: Testing production code does not create contract ancestry
    When I invoke "check" with {"fixture": "ancestry", "case": "<case>"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "snapshot.evidence.complete" equals true
    And response "snapshot.evidence.checks[0].status" equals "passed"
    And response "snapshot.source.problems" equals []
    And response "deadHasAncestry" equals false
    Examples:
      | case                       |
      | test-only                  |
      | mixed-test                 |

  Scenario: Registration without a contract does not justify a production handler
    When I invoke "check" with {"fixture": "ancestry", "case": "uncontracted-registration"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "snapshot.evidence.complete" equals true
    And response "snapshot.evidence.checks[0].status" equals "passed"
    And response "snapshot.source.problems" equals []
    And response "deadHasAncestry" equals false

  Scenario: A shared test helper cannot lend ancestry to an unrelated subject
    When I invoke "check" with {"fixture": "ancestry", "case": "shared-helper"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "snapshot.evidence.complete" equals true
    And response "snapshot.evidence.checks[0].status" equals "passed"
    And response "sharedHelperHasAncestry" equals true
    And response "deadHasAncestry" equals false
    And response "deadTestHasAncestry" equals false

  Scenario: An imported local dependency outside the maintained inventory blocks verification
    When I invoke "check" with {"fixture": "ancestry", "case": "missing-inventory"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "verificationTiming.status" equals "skipped"

  Scenario: Raising candidate policy does not increase the base-derived allowance
    When I invoke "check" with {"fixture": "ancestry", "case": "trusted-budget"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "decision.ceiling" equals 400
    And response "decision.base.additionalCapacity" equals 0
    And response "snapshot.unrooted" equals []
    And response "snapshot.evidence.complete" equals true
    And response "handlerExecuted" equals true
    When I invoke "config-show" with {"fixture": "ancestry", "case": "trusted-budget"}
    Then response "exitCode" equals 0
    And response "origin.policy" equals "base"
    And response "config.policy.bootstrap" equals 400
    And response "handlerExecuted" equals false

  Scenario: Candidate exclusions and nested project markers cannot hide base-maintained source
    When I invoke "check" with {"fixture": "ancestry", "case": "trusted-scope"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "snapshot.source.files[6].file" equals "src/dead.ts"
    And response "snapshot.source.files[7].file" equals "src/nested/bonsai.json"
    And response "snapshot.source.files[8].file" equals "src/nested/hidden.ts"
    When I invoke "config-show" with {"fixture": "ancestry", "case": "trusted-scope"}
    Then response "exitCode" equals 0
    And response "origin.policy" equals "base"
    And response "config.maintained[0]" equals "src"
    And response "config.exclude" equals ["*.generated.ts"]
    And response "handlerExecuted" equals false

  Scenario: An explicit policy selects its rules without executing handlers during inspection
    When I invoke "check" with {"fixture": "ancestry", "case": "explicit-policy"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "decision.ceiling" equals 100000
    And response "snapshot.evidence.complete" equals true
    When I invoke "config-show" with {"fixture": "ancestry", "case": "explicit-policy"}
    Then response "exitCode" equals 0
    And response "origin.policy" equals "--policy"
    And response "config.policy.bootstrap" equals 100000
    And response "handlerExecuted" equals false

  Scenario: A literal dynamic import justifies its selected export while keeping unused siblings unrooted
    When I invoke "check" with {"fixture": "ancestry", "case": "literal-import"}
    Then response "exitCode" equals 1
    And response "decision.status" equals "reject"
    And response "snapshot.source.problems" equals []
    And response "snapshot.evidence.complete" equals true
    And response "snapshot.evidence.checks[0].status" equals "passed"
    And response "snapshot.unrooted" equals ["format.ts#unused"]
    And response "handlerExecuted" equals true

  Scenario: Unsupported maintained source remains measured and blocks application execution
    When I invoke "check" with {"fixture": "ancestry", "case": "unsupported-language"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "snapshot.source.problems" equals ["Unsupported source language: unsupported.rs"]
    And response "snapshot.source.files[5].file" equals "unsupported.rs"
    And response "snapshot.source.files[5].tokens" equals 7
    And response "verificationTiming.status" equals "skipped"
    And response "handlerExecuted" equals false

  Scenario: A native type error blocks application execution even when the contract result would match
    When I invoke "check" with {"fixture": "ancestry", "case": "type-error"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "snapshot.source.problems.length" equals 1
    And response "snapshot.analysis.backend" equals "tsrs"
    And response "verificationTiming.status" equals "skipped"
    And response "handlerExecuted" equals false

  Scenario: A known native default-library gap blocks execution for case-insensitive directives
    When I invoke "check" with {"fixture": "ancestry", "case": "default-library-directive"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "snapshot.source.problems" equals ["Rust checker unsupported: globals.d.ts disables default libraries with no-default-lib; tsrs does not preserve this directive's diagnostics"]
    And response "snapshot.source.files[3].file" equals "globals.d.ts"
    And response "snapshot.source.files[3].tokens" equals 16
    And response "snapshot.analysis.status" equals "unsupported"
    And response "verificationTiming.status" equals "skipped"
    And response "handlerExecuted" equals false

  Scenario Outline: Registrations needing an adapter cannot silently execute as supported handlers
    When I invoke "check" with {"fixture": "ancestry", "case": "<case>"}
    Then response "exitCode" equals 2
    And response "decision.status" equals "incomplete"
    And response "snapshot.source.problems[0]" equals "Each action binding must be a literal key and named handler"
    And response "verificationTiming.status" equals "skipped"
    And response "handlerExecuted" equals false
    Examples:
      | case                   |
      | computed-registration  |
      | spread-registration    |
      | inline-registration    |

  Scenario: A maintained JSON dependency supplies real handler output and consumes retained space
    When I invoke "check" with {"fixture": "ancestry", "case": "json-dependency"}
    Then response "exitCode" equals 0
    And response "decision.status" equals "pass"
    And response "snapshot.evidence.complete" equals true
    And response "snapshot.evidence.checks[0].status" equals "passed"
    And response "snapshot.source.files[5].file" equals "settings.json"
    And response "snapshot.source.files[5].tokens" equals 9
    And response "handlerExecuted" equals true
