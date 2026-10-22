<overview>
Configuration precedence, file locations (XDG Base Directory), environment variable conventions, and config file format guidance. The configuration hierarchy determines how persistent preferences, per-project settings, and per-invocation overrides interact.
</overview>

<precedence_order>

**Highest to lowest priority:**

1. **Command-line flags** — Per-invocation, most specific. Always wins.
2. **Environment variables** — Per-session or CI context. Overrides files.
3. **Project-level config** — `.toolrc`, `tool.config.json` in project root. Per-project.
4. **User-level config** — `$XDG_CONFIG_HOME/tool/config.yaml`. Per-user.
5. **System-wide config** — `/etc/tool/config.yaml`. Per-machine.
6. **Built-in defaults** — Hardcoded sensible defaults. Always present.

**Key rule:** Every setting expressible in a config file should also be overridable via flag or environment variable. Users must be able to override any default without editing files.

**Debugging precedence:** Provide `--config-show` or equivalent to display the resolved configuration and where each value came from:
```
output.format = json     (from: flag --format=json)
output.color  = auto     (from: ~/.config/tool/config.yaml)
api.endpoint  = default  (from: built-in default)
```

</precedence_order>

<xdg_base_directory>

From freedesktop.org XDG Base Directory Specification:

| Variable | Default | Purpose | Example |
|----------|---------|---------|---------|
| `$XDG_CONFIG_HOME` | `~/.config` | User config files | `~/.config/tool/config.yaml` |
| `$XDG_DATA_HOME` | `~/.local/share` | User data (persistent) | `~/.local/share/tool/databases/` |
| `$XDG_STATE_HOME` | `~/.local/state` | User state (logs, history) | `~/.local/state/tool/history` |
| `$XDG_CACHE_HOME` | `~/.cache` | Cached data (deletable) | `~/.cache/tool/http-cache/` |
| `$XDG_RUNTIME_DIR` | (set by OS) | Runtime files (sockets, locks) | `$XDG_RUNTIME_DIR/tool.sock` |

**Follow XDG.** Do not create `~/.<toolname>` dotfiles. This is the legacy pattern that clutters home directories. Tools that follow XDG: yarn, fish, neovim, tmux, wireshark, ripgrep.

**macOS and Windows:**
- macOS: `~/Library/Application Support/tool/` is the native equivalent but XDG works too
- Windows: `%APPDATA%\tool\` for roaming, `%LOCALAPPDATA%\tool\` for local
- Cross-platform tools should check XDG first, fall back to platform-native paths

</xdg_base_directory>

<environment_variables>

**Naming conventions:**
- UPPERCASE words separated by underscores: `TOOL_API_KEY`
- Prefix with tool name to avoid collisions: `MYTOOL_`
- Common pattern: `MYTOOL_<SETTING>` maps to config file `setting`

**Standard env vars to respect:**

| Variable | Purpose |
|----------|---------|
| `NO_COLOR` | Disable color output |
| `FORCE_COLOR` | Force color output |
| `DEBUG` | Enable debug mode |
| `EDITOR` / `VISUAL` | User's preferred editor |
| `PAGER` | User's preferred pager (default: `less`) |
| `TERM` | Terminal type (`dumb` = no capabilities) |
| `COLUMNS` / `LINES` | Terminal dimensions |
| `HOME` | User home directory |
| `TMPDIR` | Temporary file directory |
| `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` | Proxy configuration |
| `LANG` / `LC_*` | Locale settings |
| `SHELL` | User's shell |

**Secrets in environment variables:**
- Common but not ideal — env vars can leak via `ps`, `docker inspect`, `/proc/*/environ`
- Acceptable for CI/CD where alternatives are impractical
- Better: file-based secrets (`--password-file`), OS keychain, secret managers
- Never log or print environment variables containing secrets

</environment_variables>

<config_file_formats>

| Format | Best for | Drawbacks |
|--------|----------|-----------|
| YAML | Human-edited config, complex structures | Indentation-sensitive, implicit typing gotchas |
| TOML | Simple to moderate config | Less common, limited nesting |
| JSON | Machine-generated config, API responses | No comments, verbose |
| INI | Very simple key-value config | No standard spec, no nesting |

**Recommendations:**
- TOML or YAML for user-edited configuration
- JSON for machine-generated or API-driven configuration
- Support comments in config files (rules out plain JSON)
- Validate config files and report errors with line numbers

</config_file_formats>

<project_level_config>

**Discovery pattern:** Walk up from current directory to find config file:
```
./tool.config.yaml          # Current directory
../tool.config.yaml         # Parent
../../tool.config.yaml      # Grandparent
... up to filesystem root or home directory
```

**Common patterns:**
- Dotfile in project root: `.toolrc`, `.tool.yaml`
- Named config file: `tool.config.js`, `tool.config.yaml`
- Section in `package.json` (for Node.js ecosystem tools)
- Dedicated directory: `.tool/config.yaml`

**Config initialization:** Provide `tool init` or `tool config init` to generate a config file with commented defaults.

</project_level_config>

<telemetry>

**Never phone home without explicit consent.**

**Preferred: opt-in.**
```
$ tool init
Would you like to send anonymous usage statistics? (y/N): n
No data will be collected. Change anytime: tool config set telemetry false
```

**Acceptable: opt-out with clear first-run notice.**
```
$ tool search "query"
Note: tool sends anonymous usage statistics to improve the product.
To disable: tool config set telemetry false
Docs: https://tool.dev/privacy
```

**Rules:**
- Opt-in is always preferred over opt-out
- If opt-out, announce clearly on first run — not buried in docs
- Disabling must be trivial: one command, one env var, or one config line
- Respect `DO_NOT_TRACK=1` env var (emerging convention)
- Never collect identifiable data (IP addresses, file contents, command arguments)
- Document exactly what is collected and where it's sent
- Telemetry must not affect command performance or add latency to the critical path

</telemetry>

<anti_patterns>
- **Dotfile in home directory:** Creating `~/.toolrc` instead of following XDG
- **No override mechanism:** Config file settings that can't be overridden by flags
- **Unclear precedence:** User can't determine which config source is winning
- **Env var without prefix:** Using `API_KEY` instead of `MYTOOL_API_KEY`
- **Commandeering standard vars:** Redefining `HOME`, `PATH`, `EDITOR` for tool-specific purposes
- **Config files without comments:** Users can't annotate or explain their settings
- **No config validation:** Silently ignoring invalid keys or values in config files
- **Hardcoded paths:** Assuming `~/.config` without checking `$XDG_CONFIG_HOME`
- **`.env` as config:** `.env` files lack types, validation, comments, and aren't versioned consistently
</anti_patterns>
