# CLI reference

Bonsai 0.0.0-alpha.1. Generated with `bonsai help --markdown`.

## init

```text
Initialize local configuration and starter contracts

USAGE
  bonsai init [flags]

Creates bonsai.json and missing starter bindings and a feature without overwriting files or running handlers. Replace the starter behavior with contracts for real handlers.

EXAMPLES
  $ bonsai init
  $ bonsai init --root packages/checkout
  $ bonsai init --root packages/checkout --json

OPTIONS
  -r, --root string         project directory (default current directory)
      --timeout string      command deadline in seconds (default none)
  -j, --json                write JSON data and JSON errors
      --plain               write headerless tab-separated records
  -o, --output string       output: auto, human, plain, json (default auto)
      --pretty              indent JSON (default only on a terminal)
  -q, --quiet               suppress human results and progress
  -v, --verbose             show detailed results and check timings, overrides --quiet
  -d, --debug               show error traces on stderr
      --no-color            disable ANSI color and styling
      --no-input            disable prompts, including at a terminal
  -i, --interactive         enable prompts when stdin and stderr are terminals
  -h, --help                show help (-h concise, --help complete)
  -V, --version             show the installed version

EXIT CODES
  0    success or gate pass
  1    gate rejection or runtime failure
  2    incomplete gate, invalid input, or usage error
  3    permission denied
  4    component or file not found by explain
  130  interrupted by SIGINT
  143  stopped by SIGTERM

ENVIRONMENT
  --root overrides BONSAI_ROOT

See also: bonsai help check, bonsai help explain
Docs: https://github.com/jiggy/bonsai/blob/main/docs/cli.md#init
```

## check

```text
Check behavior, ancestry, and the retained-code budget

USAGE
  bonsai check [flags]

Runs independent scenarios concurrently in fresh workers, using available CPU capacity and at most one worker per scenario. Use --serial for ordered scenarios sharing application state. Checks source with the native Rust TypeScript checker. Rejected or incomplete gates block acceptance. Add --report PATH for a self-contained offline HTML report without changing console output. Phase timings appear in --verbose and --json.

EXAMPLES
  $ bonsai check
  $ bonsai check --root examples/checkout --serial
  $ bonsai check --root examples/checkout --report .bonsai/report.html --json

OPTIONS
  -r, --root string         project directory (default current directory)
      --base string         Git base revision supplying trusted rules
      --policy string       explicit policy file, or - for piped JSON
      --engine string       compatibility option: rust (always used by default)
      --serial              run scenarios in order with shared application state
      --report string       write an offline HTML report (path relative to --root)
      --timeout string      command deadline in seconds (default none)
      --limit string        maximum human results (default 20, 0 shows all)
  -j, --json                write JSON data and JSON errors
      --plain               write headerless tab-separated records
  -o, --output string       output: auto, human, plain, json (default auto)
      --pretty              indent JSON (default only on a terminal)
  -q, --quiet               suppress human results and progress
  -v, --verbose             show detailed results and check timings, overrides --quiet
  -d, --debug               show error traces on stderr
      --no-color            disable ANSI color and styling
      --no-input            disable prompts, including at a terminal
  -i, --interactive         enable prompts when stdin and stderr are terminals
  -h, --help                show help (-h concise, --help complete)
  -V, --version             show the installed version

EXIT CODES
  0    success or gate pass
  1    gate rejection or runtime failure
  2    incomplete gate, invalid input, or usage error
  3    permission denied
  4    component or file not found by explain
  130  interrupted by SIGINT
  143  stopped by SIGTERM

ENVIRONMENT
  Flags override BONSAI_ROOT, BONSAI_BASE, and BONSAI_POLICY
  --base supplies project policy unless --policy is explicit

See also: bonsai help check, bonsai help explain
Docs: https://github.com/jiggy/bonsai/blob/main/docs/cli.md#check
```

## explain

```text
Show why a file or component is retained

USAGE
  bonsai explain <file-or-component> [flags]

Inspects ancestry and relationships with the native Rust TypeScript checker without running handlers. Use - to read one target per line from stdin.

EXAMPLES
  $ bonsai explain src/checkout.ts --root examples/checkout
  $ bonsai explain 'src/checkout.ts#placeOrder' --root examples/checkout --json
  $ printf 'src/checkout.ts\n' | bonsai explain - --root examples/checkout --plain

OPTIONS
  -r, --root string         project directory (default current directory)
      --base string         Git base revision supplying trusted rules
      --policy string       explicit policy file, or - for piped JSON
      --engine string       compatibility option: rust (always used by default)
      --timeout string      command deadline in seconds (default none)
      --limit string        maximum human results (default 20, 0 shows all)
  -j, --json                write JSON data and JSON errors
      --plain               write headerless tab-separated records
  -o, --output string       output: auto, human, plain, json (default auto)
      --pretty              indent JSON (default only on a terminal)
  -q, --quiet               suppress human results and progress
  -v, --verbose             show detailed results and check timings, overrides --quiet
  -d, --debug               show error traces on stderr
      --no-color            disable ANSI color and styling
      --no-input            disable prompts, including at a terminal
  -i, --interactive         enable prompts when stdin and stderr are terminals
  -h, --help                show help (-h concise, --help complete)
  -V, --version             show the installed version

EXIT CODES
  0    success or gate pass
  1    gate rejection or runtime failure
  2    incomplete gate, invalid input, or usage error
  3    permission denied
  4    component or file not found by explain
  130  interrupted by SIGINT
  143  stopped by SIGTERM

ENVIRONMENT
  Flags override BONSAI_ROOT, BONSAI_BASE, and BONSAI_POLICY
  --base supplies project policy unless --policy is explicit

See also: bonsai help check, bonsai help explain
Docs: https://github.com/jiggy/bonsai/blob/main/docs/cli.md#explain
```

## config

```text
Show the effective project configuration and its origin

USAGE
  bonsai config show [flags]

Reads the same policy and inventory as check, including trusted base rules. Never runs handlers or changes configuration.

EXAMPLES
  $ bonsai config show --root examples/checkout
  $ bonsai config show --base origin/main --json

OPTIONS
  -r, --root string         project directory (default current directory)
      --base string         Git base revision supplying trusted rules
      --policy string       explicit policy file, or - for piped JSON
      --timeout string      command deadline in seconds (default none)
  -j, --json                write JSON data and JSON errors
      --plain               write headerless tab-separated records
  -o, --output string       output: auto, human, plain, json (default auto)
      --pretty              indent JSON (default only on a terminal)
  -q, --quiet               suppress human results and progress
  -v, --verbose             show detailed results and check timings, overrides --quiet
  -d, --debug               show error traces on stderr
      --no-color            disable ANSI color and styling
      --no-input            disable prompts, including at a terminal
  -i, --interactive         enable prompts when stdin and stderr are terminals
  -h, --help                show help (-h concise, --help complete)
  -V, --version             show the installed version

EXIT CODES
  0    success or gate pass
  1    gate rejection or runtime failure
  2    incomplete gate, invalid input, or usage error
  3    permission denied
  4    component or file not found by explain
  130  interrupted by SIGINT
  143  stopped by SIGTERM

ENVIRONMENT
  Flags override BONSAI_ROOT, BONSAI_BASE, and BONSAI_POLICY
  --base supplies project policy unless --policy is explicit

See also: bonsai help check, bonsai help explain
Docs: https://github.com/jiggy/bonsai/blob/main/docs/cli.md#config
```

## completion

```text
Generate shell completions

USAGE
  bonsai completion <bash|zsh|fish|powershell> [flags]

Writes a completion script to stdout. Review and install it in your shell’s completion directory.

EXAMPLES
  $ bonsai completion bash > bonsai.bash
  $ bonsai completion fish > bonsai.fish

OPTIONS
  -j, --json                write JSON data and JSON errors
      --plain               write headerless tab-separated records
  -o, --output string       output: auto, human, plain, json (default auto)
      --pretty              indent JSON (default only on a terminal)
  -q, --quiet               suppress human results and progress
  -v, --verbose             show detailed results and check timings, overrides --quiet
  -d, --debug               show error traces on stderr
      --no-color            disable ANSI color and styling
      --no-input            disable prompts, including at a terminal
  -i, --interactive         enable prompts when stdin and stderr are terminals
  -h, --help                show help (-h concise, --help complete)
  -V, --version             show the installed version

EXIT CODES
  0    success or gate pass
  1    gate rejection or runtime failure
  2    incomplete gate, invalid input, or usage error
  3    permission denied
  4    component or file not found by explain
  130  interrupted by SIGINT
  143  stopped by SIGTERM

See also: bonsai help check, bonsai help explain
Docs: https://github.com/jiggy/bonsai/blob/main/docs/cli.md#completion
```

## help

```text
Show command help and machine-readable capabilities

USAGE
  bonsai help [command] [flags]

Shows command-specific help without reading project files. JSON describes commands, options, examples, and exit codes.

EXAMPLES
  $ bonsai help check
  $ bonsai help explain --json
  $ bonsai help --markdown > docs/cli.md

OPTIONS
  -j, --json                write JSON data and JSON errors
      --plain               write headerless tab-separated records
  -o, --output string       output: auto, human, plain, json (default auto)
      --pretty              indent JSON (default only on a terminal)
  -q, --quiet               suppress human results and progress
  -v, --verbose             show detailed results and check timings, overrides --quiet
  -d, --debug               show error traces on stderr
      --no-color            disable ANSI color and styling
      --no-input            disable prompts, including at a terminal
  -i, --interactive         enable prompts when stdin and stderr are terminals
      --markdown            generate the CLI reference
  -h, --help                show help (-h concise, --help complete)
  -V, --version             show the installed version

EXIT CODES
  0    success or gate pass
  1    gate rejection or runtime failure
  2    incomplete gate, invalid input, or usage error
  3    permission denied
  4    component or file not found by explain
  130  interrupted by SIGINT
  143  stopped by SIGTERM

See also: bonsai help check, bonsai help explain
Docs: https://github.com/jiggy/bonsai/blob/main/docs/cli.md#help
```

## version

```text
Show the installed version

USAGE
  bonsai version [flags]

Reads the packaged version without loading a project or contacting the network.

EXAMPLES
  $ bonsai version
  $ bonsai version --json

OPTIONS
  -j, --json                write JSON data and JSON errors
      --plain               write headerless tab-separated records
  -o, --output string       output: auto, human, plain, json (default auto)
      --pretty              indent JSON (default only on a terminal)
  -q, --quiet               suppress human results and progress
  -v, --verbose             show detailed results and check timings, overrides --quiet
  -d, --debug               show error traces on stderr
      --no-color            disable ANSI color and styling
      --no-input            disable prompts, including at a terminal
  -i, --interactive         enable prompts when stdin and stderr are terminals
  -h, --help                show help (-h concise, --help complete)
  -V, --version             show the installed version

EXIT CODES
  0    success or gate pass
  1    gate rejection or runtime failure
  2    incomplete gate, invalid input, or usage error
  3    permission denied
  4    component or file not found by explain
  130  interrupted by SIGINT
  143  stopped by SIGTERM

See also: bonsai help check, bonsai help explain
Docs: https://github.com/jiggy/bonsai/blob/main/docs/cli.md#version
```
