<overview>
Command naming, subcommand hierarchies, grammar patterns, and standard verbs. The command structure is the most visible part of the contract layer — it's what users type every day and what scripts depend on permanently.
</overview>

<naming_conventions>

**Command names:**
- Lowercase only, 2-9 characters (POSIX Guidelines 1-2)
- Use only lowercase letters and hyphens
- Short, memorable, easy to type (ergonomic on QWERTY)
- Avoid collision with common system commands (`test`, `time`, `install`, `convert`)
- Check: `which <name>`, `brew search <name>`, `apt search <name>`, `npm search <name>`

**Subcommand names:**
- Lowercase with hyphens for multi-word: `config-set`, `log-level`
- Consistent separator within a tool (hyphens, colons, or spaces — never mix)
- No abbreviations: `list` not `ls`, `delete` not `del` (unless the tool IS an abbreviation-heavy UNIX utility)

</naming_conventions>

<grammar_patterns>

<pattern name="verb-first (kubectl style)">
**Format:** `tool verb noun [flags]`
**Example:** `kubectl get pods --namespace production`
**Best for:** Tools with a small set of standard CRUD verbs applied to many resource types
**Advantage:** Verbs are predictable and finite; nouns are domain-specific and extensible
**Used by:** kubectl, terraform
</pattern>

<pattern name="noun-verb (Docker style)">
**Format:** `tool noun verb [flags]`
**Example:** `docker container create --name web nginx`
**Best for:** Tools with many resource types that each have distinct operations
**Advantage:** Tab completion on noun narrows the action space immediately
**Used by:** Docker, Azure CLI (`az vm create`), .NET CLI (`dotnet tool install`)
</pattern>

<pattern name="verb-only (Git style)">
**Format:** `tool verb [flags] [args]`
**Example:** `git commit -m "message"`
**Best for:** Tools where the "noun" is implicit (git operates on the repo)
**Advantage:** Shortest commands, lowest friction for frequent use
**Used by:** git, npm, cargo, pip
</pattern>

<pattern name="topic:command (Heroku style)">
**Format:** `tool topic:command [flags]`
**Example:** `heroku apps:create --region eu`
**Best for:** Plugin-based architectures where topics map to plugin namespaces
**Advantage:** Clear namespace boundaries, easy to extend via plugins
**Used by:** Heroku CLI, Salesforce CLI
</pattern>

<decision_tree>
- **Single implicit resource** (e.g., current project/repo): Use verb-only (git style)
- **Multiple resource types, standard CRUD**: Use verb-first (kubectl style)
- **Multiple resource types, distinct operations per type**: Use noun-verb (Docker style)
- **Plugin-based architecture**: Use topic:command (Heroku style)
</decision_tree>

</grammar_patterns>

<subcommand_hierarchies>

**Depth limits:**
- 1 level: `tool verb` — simplest, best discoverability
- 2 levels: `tool noun verb` — standard for complex tools
- 3 levels: `tool noun noun verb` — maximum recommended depth (`az vm disk attach`)
- 4+ levels: Avoid. Discoverability drops sharply, tab completion becomes tedious

**Grouping commands (namespace nodes):**
- A group command with no verb should list its children or show help
- Example: `docker container` alone shows available container subcommands
- Never make a group command do something implicit (e.g., `heroku config` lists vars, not `heroku config:list`)

**Implicit defaults:**
- Docker allows `docker build` as shorthand for `docker image build`
- This is acceptable for the most common noun but should be documented
- Only do this for ONE noun to avoid ambiguity

</subcommand_hierarchies>

<standard_verbs>

**CRUD verbs (choose one set and be consistent):**

| Operation | Standard Verb | Alternatives | Avoid |
|-----------|--------------|--------------|-------|
| Create resource | `create` | `new`, `init`, `add` | `make`, `spawn` |
| Read single | `show`, `get` | `info`, `describe` | `display`, `view` |
| Read collection | `list` | `ls` | `show-all`, `get-all` |
| Update (partial) | `update` | `edit`, `modify` | `change`, `alter` |
| Replace (full) | `set` | `replace` | `put` |
| Delete | `delete` | `remove`, `rm` | `destroy`, `nuke`, `kill` |

**Lifecycle verbs:**
- `start` / `stop` / `restart` — for services and processes
- `enable` / `disable` — for features and toggles
- `init` / `setup` — for first-time configuration
- `login` / `logout` — for authentication

**Data verbs:**
- `export` / `import` — for data transfer
- `push` / `pull` — for sync operations
- `diff` — for comparison
- `validate` / `check` / `lint` — for verification

**Rule:** All command names must contain a verb. A noun alone is either a namespace or an error.

</standard_verbs>

<anti_patterns>
- **Ambiguous verbs:** Having both `update` and `upgrade` — which modifies the resource and which modifies the tool?
- **Arbitrary abbreviations:** Allowing `tool i` for `install` permanently blocks adding `init`, `info`, or `import` — it's a breaking change to stop accepting the abbreviation. Only support explicit aliases (`tool ci` = `tool container inspect`), never automatic prefix matching
- **Catch-all commands:** A subcommand that accepts arbitrary strings permanently blocks that namespace
- **Verb-less nouns as actions:** `tool database` should not implicitly mean `tool database list`
- **Inconsistent grammar:** Mixing `tool verb noun` and `tool noun verb` within the same tool
- **Namespace collision:** Using a command name that shadows a common system utility
- **Deep nesting:** More than 3 levels of subcommands (discoverability and tab-completion suffer)
</anti_patterns>
