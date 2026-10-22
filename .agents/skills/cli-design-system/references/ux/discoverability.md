<overview>
Shell completions, contextual suggestions, onboarding flows, and command discovery mechanisms. Discoverability determines how quickly users become productive and whether they find features they don't know exist.
</overview>

<shell_completions>

**Provide completion scripts for all major shells:**
- **bash** — most ubiquitous, requires `bash-completion` package
- **zsh** — supports rich descriptions alongside completions
- **fish** — completions are declarative and auto-loaded
- **PowerShell** (if targeting Windows)

**Installation command pattern:**
```
tool completion bash > ~/.local/share/bash-completion/completions/tool
tool completion zsh > "${fpath[1]}/_tool"
tool completion fish > ~/.config/fish/completions/tool.fish

# Or eval-based (slower startup, easier setup):
eval "$(tool completion bash)"
```

**What to complete:**
- Subcommands: `tool <TAB>` → `create`, `list`, `delete`, ...
- Flags: `tool create --<TAB>` → `--name`, `--region`, `--format`, ...
- Flag values: `tool create --region <TAB>` → `us-east-1`, `eu-west-1`, ...
- Arguments: `tool delete <TAB>` → list of existing resources (dynamic)
- File paths: where file arguments are expected

**Dynamic completions:**
- For resource names, call the API/list command at completion time
- Cache aggressively — completions must be fast (< 200ms)
- Fall back to static completions if dynamic fetch fails
- Provide `--no-cache` for cases where cache is stale

**Zsh descriptions:**
```
$ tool --<TAB>
--format   -- Output format (json, yaml, table)
--region   -- Target region for the operation
--verbose  -- Increase output verbosity
--dry-run  -- Preview changes without executing
```

</shell_completions>

<contextual_suggestions>

**Suggest next steps after command completion:**

```
$ tool init
✓ Project initialized in ./my-project

Next steps:
  tool deploy          Deploy the project
  tool config set      Configure settings
  tool status          Check project status
```

**Suggest corrections on error:**

```
$ tool depoly
Error: Unknown command 'depoly'. Did you mean 'deploy'?
```

**Suggest related commands:**

```
$ tool list
NAME        STATUS
web-app     running
worker      stopped

Hint: Use 'tool show <name>' for details, or 'tool logs <name>' for logs.
```

**When to suppress hints:**
- When `--quiet` is active
- After the user has used the tool many times (detect via state file counter)
- In non-TTY mode (piping/scripting)

</contextual_suggestions>

<onboarding>

**First-run experience:**
- Detect first run via absence of config directory/file
- Offer guided setup: `It looks like this is your first time using tool. Run 'tool init' to get started.`
- Keep it brief — one message, not a tutorial

**Init command pattern:**
```
$ tool init
? Project name [my-project]: web-app
? Default region [us-east-1]: eu-west-1
? Enable telemetry? [y/N]: n

✓ Configuration saved to ~/.config/tool/config.yaml

Quick start:
  tool create <resource>    Create a resource
  tool list                 List all resources
  tool help                 Show all commands
```

**Principles:**
- Offer QuickStart (sensible defaults) vs Advanced (full control)
- Always allow non-interactive init via flags: `tool init --name web-app --region eu-west-1 --no-telemetry`
- Generate a commented config file so users can learn the options
- Don't require init — tools should work with sensible defaults even without explicit initialization

</onboarding>

<command_discovery>

**Help grouping by workflow:**
```
Getting Started:
  init        Initialize a new project
  login       Authenticate with the service

Common Commands:
  list        List all resources
  create      Create a new resource
  show        Show details of a resource

Management:
  config      Manage configuration
  completion  Generate shell completions
```

**Search in help:** For tools with many subcommands, provide `tool help --search <term>`:
```
$ tool help --search deploy
Commands matching 'deploy':
  deploy          Deploy resources to an environment
  deploy:status   Check deployment status
  deploy:rollback Rollback to previous deployment
```

**Version and update notifications:**
```
$ tool list
(results...)

Update available: 2.3.0 → 2.4.0
Run 'tool update' to upgrade, or see https://tool.dev/changelog
```
- Show update notices to TTY only, never in pipes
- Rate-limit checks (once per day, cached)
- Allow disabling: `tool config set update-check false`

</command_discovery>

<inline_documentation>

**Link to web docs from CLI:**
```
$ tool deploy --help
...
Documentation: https://tool.dev/docs/deploy
```

**Open docs in browser:**
```
$ tool docs deploy
# Opens https://tool.dev/docs/deploy in default browser
```

**Contextual doc links in errors:**
```
Error: Deployment failed — resource quota exceeded.
See: https://tool.dev/docs/quotas
```

</inline_documentation>

<anti_patterns>
- **No shell completions:** Users must type everything from memory
- **Slow completions:** Dynamic completions that take > 500ms make Tab unusable
- **No typo correction:** Unknown commands produce only "command not found"
- **Alphabetical help only:** Users must know the command name to find it
- **Mandatory onboarding:** Blocking all commands until init is complete
- **Update nags in pipes:** Printing "update available" to stdout breaks automation
- **No cross-references:** Commands don't mention related commands
- **Hidden features:** Useful capabilities that aren't mentioned in any help text
- **Stale completions after install:** Requiring shell restart without telling the user
</anti_patterns>
