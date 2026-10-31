import { commands, flags } from './cli-interface.ts'

type Flag = {
  type: string
  short?: string
  description: string
  scope?: readonly string[]
  choices?: readonly string[]
  completion?: 'directory' | 'file'
}

const entries = Object.entries(flags) as [string, Flag][]
const commandNames = Object.keys(commands)
const shells = ['bash', 'zsh', 'fish', 'powershell']
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const aliases = (name: string, flag: Flag) => [
  `--${name}`,
  ...(flag.short ? [`-${flag.short}`] : []),
]
const valueKind = (name: string, flag: Flag) =>
  name === 'report' ? 'target' : (flag.completion ?? (flag.choices ? 'choices' : 'value'))
const optionWords = (command?: string) =>
  entries
    .filter(([, flag]) => !command || !flag.scope || flag.scope.includes(command))
    .flatMap(([name, flag]) => aliases(name, flag))
    .join(' ')

// Both shells support these parameter operations. Keep parsing independent of shell
// completion frameworks so options before the command and attached values agree.
function shellParser(): string {
  const valueCases = entries
    .filter(([, flag]) => flag.type === 'string')
    .map(
      ([name, flag]) =>
        `    ${aliases(name, flag).join('|')}) kind=${quote(valueKind(name, flag))}; choices=${quote(flag.choices?.join(' ') ?? '')}; value_scope=${quote(flag.scope ? ` ${flag.scope.join(' ')} ` : '')} ;;`,
    )
    .join('\n')
  const options = commandNames
    .map((name) => `    ${name}) suggestions=${quote(optionWords(name))} ;;`)
    .join('\n')
  return `_bonsai_value_flag() {
  kind='' choices='' value_scope=''
  case "$1" in
${valueCases}
  esac
}
_bonsai_options() {
  case "$command" in
${options}
    *) suggestions=${quote(optionWords())} ;;
  esac
}
_bonsai_context() {
  local token rest letter value_option
  for token in "\${prior[@]}"; do
    if [[ -n "$pending" ]]; then
      [[ "$pending" == --root || "$pending" == -r ]] && project_root="$token"
      pending=''
      continue
    fi
    if [[ "$end_options" == 0 ]]; then
      if [[ "$token" == -- ]]; then
        end_options=1
        continue
      elif [[ "$token" == --*=* ]]; then
        [[ "\${token%%=*}" == --root ]] && project_root="\${token#*=}"
        continue
      elif [[ "$token" == --* ]]; then
        _bonsai_value_flag "$token"
        [[ -n "$kind" ]] && pending="$token"
        continue
      elif [[ "$token" == -?* ]]; then
        rest="\${token#-}"
        while [[ -n "$rest" ]]; do
          letter="\${rest:0:1}"; rest="\${rest:1}"
          _bonsai_value_flag "-$letter"
          if [[ -n "$kind" ]]; then
            if [[ -z "$rest" ]]; then
              pending="-$letter"
            elif [[ "$letter" == r ]]; then
              project_root="$rest"
            fi
            break
          fi
        done
        continue
      fi
    fi
    if [[ -z "$command" ]]; then
      command="$token"
    else
      [[ "$operands" == 0 ]] && first_operand="$token"
      operands=$((operands + 1))
    fi
  done
}
_bonsai_candidates() {
  local rest letter
  kind='' choices='' prefix='' value="$current" suggestions=''
  if [[ "$end_options" == 0 && -n "$pending" ]]; then
    _bonsai_value_flag "$pending"
  elif [[ "$end_options" == 0 && "$current" == --*=* ]]; then
    _bonsai_value_flag "\${current%%=*}"
    prefix="\${current%%=*}="; value="\${current#*=}"
  elif [[ "$end_options" == 0 && "$current" == -?* && "$current" != --* ]]; then
    rest="\${current#-}"; prefix='-'
    while [[ -n "$rest" ]]; do
      letter="\${rest:0:1}"; rest="\${rest:1}"
      _bonsai_value_flag "-$letter"
      prefix="$prefix$letter"
      if [[ -n "$kind" ]]; then value="$rest"; break; fi
    done
    [[ -z "$kind" ]] && prefix=''
  fi
  if [[ -n "$kind" && -n "$command" && -n "$value_scope" && "$value_scope" != *" $command "* ]]; then
    kind='blocked'
  fi
  if [[ -n "$kind" ]]; then
    [[ "$kind" == choices ]] && suggestions="$choices"
  elif [[ "$end_options" == 0 && "$current" == -* ]]; then
    _bonsai_options
  elif [[ -z "$command" ]]; then
    suggestions=${quote(commandNames.join(' '))}
  elif [[ "$command" == config && "$operands" == 0 ]]; then
    suggestions='show'
  elif [[ "$command" == completion && "$operands" == 0 ]]; then
    suggestions=${quote(shells.join(' '))}
  elif [[ "$command" == help && "$operands" == 0 ]]; then
    suggestions=${quote(commandNames.join(' '))}
  elif [[ "$command" == help && "$first_operand" == config && "$operands" == 1 ]]; then
    suggestions='show'
  elif [[ "$command" == explain && "$operands" == 0 ]]; then
    kind='target'
  fi
}`
}

function bash(): string {
  return `${shellParser()}
_bonsai() {
  local current="\${COMP_WORDS[COMP_CWORD]}" command='' operands=0 first_operand=''
  local pending='' end_options=0 project_root='' kind='' choices='' value_scope='' prefix='' value='' suggestions=''
  local candidate token scan base='' reply_prefix='' join_next=0 count=$((COMP_CWORD - 1))
  local -a prior=()
  COMPREPLY=()
  # Bash normally splits '=' into a separate word; also accept unsplit words.
  if [[ "$current" == = && "$COMP_CWORD" -ge 2 ]]; then
    current="\${COMP_WORDS[COMP_CWORD-1]}="; count=$((count - 1))
  elif [[ "$COMP_CWORD" -ge 3 && "\${COMP_WORDS[COMP_CWORD-1]}" == = ]]; then
    current="\${COMP_WORDS[COMP_CWORD-2]}=$current"; count=$((count - 2))
  else
    reply_prefix='keep'
  fi
  if (( count > 0 )); then
    for token in "\${COMP_WORDS[@]:1:count}"; do
      if [[ "$token" == = && "\${#prior[@]}" -gt 0 ]]; then
        prior[\${#prior[@]}-1]+='='; join_next=1
      elif [[ "$join_next" == 1 ]]; then
        prior[\${#prior[@]}-1]+="$token"; join_next=0
      else
        prior+=("$token")
      fi
    done
  fi
  _bonsai_context
  _bonsai_candidates
  [[ "$reply_prefix" != keep ]] && prefix=''
  if [[ "$kind" == directory || "$kind" == file || "$kind" == target ]]; then
    if [[ "$kind" == target && -n "$project_root" && "$value" != /* ]]; then
      base="\${project_root%/}/"
    fi
    scan="$base$value"
    while IFS= read -r candidate; do
      [[ "$kind" == directory && ! -d "$candidate" ]] && continue
      [[ -d "$candidate" ]] && candidate="$candidate/"
      COMPREPLY+=("$prefix\${candidate#"$base"}")
    done < <(compgen -f -- "$scan")
    compopt -o filenames 2>/dev/null || true
  elif [[ -n "$suggestions" ]]; then
    while IFS= read -r candidate; do
      COMPREPLY+=("$prefix$candidate")
    done < <(compgen -W "$suggestions" -- "$value")
  fi
}
complete -F _bonsai bonsai`
}

function zsh(): string {
  return `#compdef bonsai
${shellParser()}
_bonsai() {
  local current="\${words[CURRENT]}" command='' operands=0 first_operand=''
  local pending='' end_options=0 project_root='' kind='' choices='' value_scope='' prefix='' value='' suggestions=''
  local -a prior candidates
  prior=("\${words[@]:1:$((CURRENT - 2))}")
  _bonsai_context
  _bonsai_candidates
  [[ -n "$prefix" ]] && compset -P "$prefix"
  if [[ "$kind" == directory ]]; then
    _path_files -/
  elif [[ "$kind" == file ]]; then
    _path_files
  elif [[ "$kind" == target ]]; then
    if [[ -n "$project_root" && "$value" != /* ]]; then
      _path_files -W "$project_root"
    else
      _path_files
    fi
  elif [[ -n "$suggestions" ]]; then
    candidates=(\${=suggestions})
    compadd -- "\${candidates[@]}"
  fi
}
compdef _bonsai bonsai`
}

function fish(): string {
  const shortBooleans = entries
    .filter(([, flag]) => flag.type === 'boolean' && flag.short)
    .map(([, flag]) => flag.short)
    .join('')
  const stringLongFlags = entries
    .filter(([, flag]) => flag.type === 'string')
    .map(([name]) => `--${name}`)
  const stringShortFlags = entries
    .filter(([, flag]) => flag.type === 'string' && flag.short)
    .map(([, flag]) => flag.short as string)
  const definitions = entries.map(([name, flag]) => {
    const scope = flag.scope ? ` -n ${quote(`__bonsai_scope ${flag.scope.join(' ')}`)}` : ''
    const values =
      name === 'report'
        ? ` -f -a ${quote('(__bonsai_target_paths report)')}`
        : flag.choices
          ? ` -a ${quote(flag.choices.join(' '))}`
          : flag.completion === 'directory'
            ? ` -a ${quote(`(__bonsai_directories ${flag.short ?? ''})`)}`
            : flag.completion === 'file'
              ? ' -F'
              : ''
    return `complete -c bonsai${scope} -l ${name}${flag.short ? ` -s ${flag.short}` : ''}${flag.type === 'string' ? ` -r${flag.completion === 'file' ? '' : ' -f'}` : ''}${values} -d ${quote(flag.description)}`
  })
  return `function __bonsai_context
  set -l tokens (commandline -opc)
  set -e tokens[1]
  set -l command __root
  set -l operands
  set -l pending ''
  set -l project_root .
  set -l end_options 0
  for token in $tokens
    if test -n "$pending"
      contains -- "$pending" --root -r; and set project_root "$token"
      set pending ''
      continue
    end
    if test $end_options -eq 0
      if test "$token" = --
        set end_options 1
        continue
      else if string match -q -- '--*=*' "$token"
        if string match -q -- '--root=*' "$token"
          set project_root (string replace -- '--root=' '' "$token")
        end
        continue
      else if contains -- "$token" ${stringLongFlags.join(' ')}
        set pending "$token"
        continue
      else if string match -q -- '-*' "$token"
        set -l rest (string sub -s 2 -- "$token")
        while test -n "$rest"
          set -l letter (string sub -l 1 -- "$rest")
          set rest (string sub -s 2 -- "$rest")
          if contains -- "$letter" ${stringShortFlags.join(' ')}
            if test -z "$rest"
              set pending "-$letter"
            else if test "$letter" = r
              set project_root "$rest"
            end
            break
          end
        end
        continue
      end
    end
    if test "$command" = __root
      set command "$token"
    else
      set -a operands "$token"
    end
  end
  if test "$argv[1]" = root
    printf '%s\\n' "$project_root"
  else
    printf '%s\\n' "$command" $operands
  end
end
function __bonsai_scope
  set -l context (__bonsai_context)
  test "$context[1]" = __root; or contains -- "$context[1]" $argv
end
function __bonsai_position
  set -l context (__bonsai_context)
  test "$context[1]" = "$argv[1]"; and test (count $context) -eq (math $argv[2] + 1)
end
function __bonsai_help_config
  set -l context (__bonsai_context)
  test (count $context) -eq 2; and test "$context[1]" = help; and test "$context[2]" = config
end
function __bonsai_target_paths
  set -l project_root (__bonsai_context root)
  set -l current (commandline -ct)
  if test "$argv[1]" = report
    set current (string replace -r -- '^--report=' '' "$current")
  end
  set -l previous (pwd)
  builtin cd -- "$project_root" 2>/dev/null; or return
  __fish_complete_path "$current"
  builtin cd -- "$previous"
end
function __bonsai_directories
  set -l current (commandline -ct | string replace -r -- '^--[^=]+=' '')
  if test -n "$argv[1]"
    set current (string replace -r -- '^-[${shortBooleans}]*'$argv[1] '' "$current")
  end
  __fish_complete_directories "$current"
end
complete -c bonsai -f
${commandNames.map((name) => `complete -c bonsai -n '__bonsai_position __root 0' -a ${name} -d ${quote(commands[name as keyof typeof commands].summary)}`).join('\n')}
complete -c bonsai -n '__bonsai_position config 0' -a show
complete -c bonsai -n '__bonsai_position completion 0' -a ${quote(shells.join(' '))}
complete -c bonsai -n '__bonsai_position help 0' -a ${quote(commandNames.join(' '))}
complete -c bonsai -n __bonsai_help_config -a show
complete -c bonsai -n '__bonsai_position explain 0' -a '(__bonsai_target_paths)'
${definitions.join('\n')}`
}

function powershell(): string {
  const psQuote = (value: string) => `'${value.replaceAll("'", "''")}'`
  const valueFlags = entries
    .filter(([, flag]) => flag.type === 'string')
    .flatMap(([name, flag]) =>
      aliases(name, flag).map(
        (alias) =>
          `    ${psQuote(alias)} = @{ Kind = ${psQuote(valueKind(name, flag))}; Choices = @(${(flag.choices ?? []).map(psQuote).join(', ')}); Scope = @(${(flag.scope ?? []).map(psQuote).join(', ')}) }`,
      ),
    )
    .join('\n')
  const options = commandNames
    .map(
      (name) =>
        `    ${psQuote(name)} { $suggestions = @(${optionWords(name).split(' ').map(psQuote).join(', ')}) }`,
    )
    .join('\n')
  return `Register-ArgumentCompleter -Native -CommandName bonsai -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $valueFlags = @{
${valueFlags}
  }
  $prior = @($commandAst.CommandElements | Select-Object -Skip 1 | Where-Object { $_.Extent.StartOffset -lt $cursorPosition })
  if ($wordToComplete -and $prior.Count -and $prior[-1].Extent.EndOffset -ge $cursorPosition) {
    $prior = @($prior | Select-Object -SkipLast 1)
  }
  $command = ''; $operands = @(); $pending = ''; $endOptions = $false; $projectRoot = ''
  foreach ($element in $prior) {
    $token = if ($element -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $element.Value } else { $element.Extent.Text }
    if ($pending) {
      if ($pending -eq '--root' -or $pending -eq '-r') { $projectRoot = $token }
      $pending = ''; continue
    }
    if (-not $endOptions) {
      if ($token -eq '--') { $endOptions = $true; continue }
      if ($token -like '--*=*') {
        if ($token -like '--root=*') { $projectRoot = $token.Substring(7) }
        continue
      }
      if ($token.StartsWith('--')) {
        if ($valueFlags.ContainsKey($token)) { $pending = $token }
        continue
      }
      if ($token.StartsWith('-') -and $token.Length -gt 1) {
        for ($i = 1; $i -lt $token.Length; $i++) {
          $option = '-' + $token[$i]
          if ($valueFlags.ContainsKey($option)) {
            if ($i -eq $token.Length - 1) { $pending = $option }
            elseif ($option -eq '-r') { $projectRoot = $token.Substring($i + 1) }
            break
          }
        }
        continue
      }
    }
    if (-not $command) { $command = $token } else { $operands += $token }
  }
  $prefix = ''; $value = [string]$wordToComplete; $kind = ''; $suggestions = @(); $valueFlag = $null
  if (-not $endOptions) {
    if ($pending) { $valueFlag = $valueFlags[$pending] }
    elseif ($wordToComplete -match '^(--[^=]+)=(.*)$' -and $valueFlags.ContainsKey($Matches[1])) {
      $prefix = $Matches[1] + '='; $value = $Matches[2]
      $valueFlag = $valueFlags[$Matches[1]]
    }
    elseif ($wordToComplete.StartsWith('-') -and -not $wordToComplete.StartsWith('--')) {
      for ($i = 1; $i -lt $wordToComplete.Length; $i++) {
        $option = '-' + $wordToComplete[$i]
        if ($valueFlags.ContainsKey($option)) {
          $prefix = $wordToComplete.Substring(0, $i + 1); $value = $wordToComplete.Substring($i + 1)
          $valueFlag = $valueFlags[$option]
          break
        }
      }
    }
  }
  if ($valueFlag) {
    $kind = $valueFlag.Kind; $suggestions = $valueFlag.Choices
    if ($command -and $valueFlag.Scope.Count -and $command -cnotin $valueFlag.Scope) { $kind = 'blocked'; $suggestions = @() }
  }
  if (-not $kind) {
    if (-not $endOptions -and $wordToComplete.StartsWith('-')) {
      switch ($command) {
${options}
        default { $suggestions = @(${optionWords().split(' ').map(psQuote).join(', ')}) }
      }
    }
    elseif (-not $command -or ($command -eq 'help' -and $operands.Count -eq 0)) { $suggestions = @(${commandNames.map(psQuote).join(', ')}) }
    elseif (($command -eq 'config' -and $operands.Count -eq 0) -or ($command -eq 'help' -and $operands.Count -eq 1 -and $operands[0] -eq 'config')) { $suggestions = @('show') }
    elseif ($command -eq 'completion' -and $operands.Count -eq 0) { $suggestions = @(${shells.map(psQuote).join(', ')}) }
    elseif ($command -eq 'explain' -and $operands.Count -eq 0) { $kind = 'target' }
  }
  if ($kind -in @('directory', 'file', 'target')) {
    $typedDirectory = [System.IO.Path]::GetDirectoryName($value)
    $leaf = [System.IO.Path]::GetFileName($value)
    $directory = if ($typedDirectory) { $typedDirectory } else { '.' }
    if ($kind -eq 'target' -and $projectRoot -and -not [System.IO.Path]::IsPathRooted($value)) { $directory = Join-Path $projectRoot $directory }
    Get-ChildItem -LiteralPath $directory -Force -ErrorAction SilentlyContinue | Where-Object {
      $_.Name.StartsWith($leaf, [System.StringComparison]::OrdinalIgnoreCase) -and ($kind -ne 'directory' -or $_.PSIsContainer)
    } | ForEach-Object {
      $path = if ($typedDirectory) { Join-Path $typedDirectory $_.Name } else { $_.Name }
      if ($_.PSIsContainer) { $path += [System.IO.Path]::DirectorySeparatorChar }
      $text = $prefix + $path
      $text = "'" + $text.Replace("'", "''") + "'"
      [System.Management.Automation.CompletionResult]::new($text, $path, 'ParameterValue', $path)
    }
  }
  else {
    $suggestions | Where-Object { $_.StartsWith($value, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($prefix + $_, $_, 'ParameterValue', $_)
    }
  }
}`
}

export function completion(shell: string): string {
  switch (shell) {
    case 'bash':
      return bash()
    case 'zsh':
      return zsh()
    case 'fish':
      return fish()
    case 'powershell':
      return powershell()
    default:
      throw new Error(`Unsupported completion shell: ${shell}`)
  }
}
