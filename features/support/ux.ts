import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { environment, invoke, runCli } from './cli.ts'
import { project, write } from './project.ts'

function blockedProject() {
  const fixture = project({
    'handler.ts':
      "import { spawnSync } from 'node:child_process'\nimport { writeFileSync } from 'node:fs'\nimport { fileURLToPath } from 'node:url'\nconst entry = fileURLToPath(new URL('./missing-child.ts', import.meta.url))\nexport function app() { writeFileSync(new URL('./must-not-run', import.meta.url), 'ran'); spawnSync(process.execPath, [entry]); return { status: 'ok' } }\n",
    'bindings.ts': "import { app } from './handler.ts'\nexport const actions = { 'app': app }\n",
    'app.feature':
      'Feature: Example\nScenario: Report\n When I invoke "app" with {}\n Then response "status" equals "ok"\n',
  })
  // The actual recovery command must survive a path that needs shell quoting.
  const root = fixture.root + " project's #root"
  renameSync(fixture.root, root)
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function styledCharacters(text: string) {
  const result: { value: string; color: number | undefined; dim: boolean }[] = []
  let color: number | undefined
  let dim = false
  let cursor = 0
  for (const match of text.matchAll(/\x1b\[([\d;]*)m/g)) {
    for (const value of text.slice(cursor, match.index)) result.push({ value, color, dim })
    for (const code of (match[1] || '0').split(';').map(Number)) {
      if (code === 0) {
        color = undefined
        dim = false
      } else if (code === 2) dim = true
      else if (code === 22) dim = false
      else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) color = code
      else if (code === 39) color = undefined
    }
    cursor = match.index + match[0].length
  }
  for (const value of text.slice(cursor)) result.push({ value, color, dim })
  return result
}

export function checkUx(input: { case: string }) {
  if (input.case === 'completion' || input.case === 'command-completion') {
    const fixture = project({ 'bindings.ts': 'export const actions = {}\n' })
    try {
      const report = invoke(['completion', 'bash'])
      write(fixture.root, 'completion.bash', report.script)
      const probe = spawnSync(
        'bash',
        [
          '--noprofile',
          '--norc',
          '-c',
          `
source "$1"
type _bonsai >/dev/null || exit 9
COMP_WORDS=(${input.case === 'command-completion' ? 'bonsai ch' : 'bonsai check --ser'})
COMP_CWORD=${input.case === 'command-completion' ? 1 : 2}
_bonsai
printf '%s\\n' "\${COMPREPLY[*]}"
COMP_WORDS=(${input.case === 'command-completion' ? 'bonsai e' : 'bonsai explain --ser'})
COMP_CWORD=${input.case === 'command-completion' ? 1 : 2}
_bonsai
printf '%s\\n' "\${COMPREPLY[*]}"
`,
          'completion',
          join(fixture.root, 'completion.bash'),
        ],
        {
          cwd: fixture.root,
          encoding: 'utf8',
          timeout: 5000,
          env: environment(),
        },
      )
      const lines = probe.stdout.trimEnd().split('\n')
      return {
        ...report,
        bashExitCode: probe.status,
        checkCandidates: (lines[0] ?? '').split(' ').filter(Boolean),
        explainCandidates: (lines[1] ?? '').split(' ').filter(Boolean),
      }
    } finally {
      fixture.dispose()
    }
  }
  const fixture = blockedProject()
  const { root } = fixture
  try {
    if (input.case === 'included-child') {
      write(
        root,
        'missing-child.ts',
        "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('./child-ran', import.meta.url), 'ran')\n",
      )
      const config = JSON.parse(readFileSync(join(root, 'bonsai.json'), 'utf8'))
      config.maintained.push('missing-child.ts')
      write(root, 'bonsai.json', JSON.stringify(config))
      return {
        ...invoke(['check', '--root', root]),
        handlerExecuted: existsSync(join(root, 'must-not-run')),
        childExecuted: existsSync(join(root, 'child-ran')),
      }
    }
    if (
      input.case === 'human-blocker' ||
      input.case === 'verbose-blocker' ||
      input.case === 'copied-retry'
    ) {
      const human = runCli(
        [
          'check',
          '--root',
          root,
          '--output',
          'human',
          ...(input.case === 'human-blocker' ? [] : ['--verbose']),
        ],
        {
          NO_COLOR: '',
          BONSAI_NO_COLOR: '',
          FORCE_COLOR: '1',
          COLUMNS: '32',
          TERM: 'xterm-256color',
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8',
        },
      )
      const visible = styledCharacters(human.stderr)
      const plain = visible.map((character) => character.value).join('')
      const start = plain.indexOf("Can't trace")
      const detail = plain.slice(start).search(/\n\s+[├└|'][─-]/)
      const title = plain.slice(start, detail < 0 ? undefined : start + detail)
      const titleCharacters = visible
        .slice(start, detail < 0 ? undefined : start + detail)
        .filter((character) => character.value.trim())
      if (input.case === 'copied-retry') {
        const command = /Next (?:→|->) (.+)/.exec(plain)?.[1] ?? ''
        const entry = fileURLToPath(new URL('../../src/cli.ts', import.meta.url))
        if (!/^bonsai check(?: |$)/.test(command))
          throw new Error('The blocked check did not provide a check retry command')
        const retried = spawnSync(
          'sh',
          [
            '-c',
            command.replace(/^bonsai\b/, '"$BONSAI_SPEC_RUNTIME" "$BONSAI_SPEC_ENTRY"') +
              ' --json',
          ],
          {
            encoding: 'utf8',
            timeout: 15000,
            env: {
              ...environment(),
              BONSAI_SPEC_RUNTIME: process.execPath,
              BONSAI_SPEC_ENTRY: entry,
            },
          },
        )
        if (retried.error) throw retried.error
        return {
          ...JSON.parse(retried.stdout || retried.stderr),
          exitCode: retried.status,
          stdout: retried.stdout,
          stderr: retried.stderr,
          handlerExecuted: existsSync(join(root, 'must-not-run')),
        }
      }
      return {
        exitCode: human.status,
        stdout: human.stdout,
        stderr: human.stderr,
        title: title.replace(/\s+/g, ' ').trim(),
        titleColors: [...new Set(titleCharacters.map((character) => character.color))],
        titleDimmed: titleCharacters.some((character) => character.dim),
        titleWrapped: title.includes('\n'),
        hasSourceLocation: /handler\.ts:\d+/.test(plain),
        missingEntryVisible: plain.includes('missing-child.ts'),
        hasFix: /Fix:[^\S\r\n]*\S/.test(plain),
        hasTimings: /\b\d+(?:\.\d+)?(?:ms|s)\s+elapsed\b/.test(plain),
        handlerExecuted: existsSync(join(root, 'must-not-run')),
      }
    }
    if (input.case === 'machine') {
      const machine = runCli(['check', '--root', root, '--json'], {
        NO_COLOR: '',
        BONSAI_NO_COLOR: '',
        FORCE_COLOR: '1',
      })
      return {
        ...JSON.parse(machine.stdout),
        exitCode: machine.status,
        stdout: machine.stdout,
        stderr: machine.stderr,
        hasAnsi: /\x1b\[/.test(machine.stdout + machine.stderr),
      }
    }
    if (input.case === 'quiet') {
      const quiet = runCli(['check', '--root', root, '--quiet', '--output', 'human'])
      return {
        exitCode: quiet.status,
        stdout: quiet.stdout,
        stderr: quiet.stderr,
        hasBlocker: /Can't trace/.test(quiet.stderr),
        hasFix: /Fix:[^\S\r\n]*\S/.test(quiet.stderr),
        hasProgress: /Checking contracts/.test(quiet.stderr),
        hasMeasurements: /Inventory measurements|Retained:/.test(quiet.stderr),
      }
    }
    throw new Error(`Unknown UX fixture: ${input.case}`)
  } finally {
    fixture.dispose()
  }
}
