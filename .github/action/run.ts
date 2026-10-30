import { validSnapshot } from '../../src/snapshot-schema.ts'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const checkerRoot = fileURLToPath(new URL('../../', import.meta.url))
const output = (name: string, value: string | number) => {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is unavailable')
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}
const summary = (text: string) => {
  if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('GITHUB_STEP_SUMMARY is unavailable')
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n')
}
const html = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      (
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }) as Record<string, string>
      )[char]!,
  )
const annotation = (text: string) =>
  console.log(
    '::error title=Bonsai check::' +
      text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'),
  )
const number = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const format = (value: number) => value.toLocaleString('en-US')

let reportPath: string | undefined

try {
  output('status', 'error')
  const base = process.env.BONSAI_ACTION_BASE?.trim()
  if (!base)
    throw new Error(
      'Set base to a reviewed commit for push or manual runs. PRs and merge queues supply it automatically.',
    )
  const serial = process.env.BONSAI_ACTION_SERIAL ?? 'false'
  if (!['true', 'false'].includes(serial)) throw new Error('serial must be true or false')
  const root = resolve(
    process.env.GITHUB_WORKSPACE ?? process.cwd(),
    process.env.BONSAI_ACTION_ROOT || '.',
  )
  const directory = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'bonsai-action-'))
  const path = join(directory, 'report.json')
  reportPath = path
  output('report-path', path)
  const prefix = ['--no-env-file', '--no-install', join(checkerRoot, 'src/cli.ts')]
  const options = {
    cwd: checkerRoot,
    encoding: 'utf8' as const,
    maxBuffer: 128 * 1024 * 1024,
    env: {
      ...process.env,
      BONSAI_ROOT: undefined,
      BONSAI_BASE: undefined,
      BONSAI_POLICY: undefined,
      CI: 'true',
      NO_COLOR: '1',
    },
  }
  const repository = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
  })
  if (repository.error || repository.status !== 0)
    throw new Error(repository.error?.message || 'working-directory must be a Git repository root')
  if (realpathSync(repository.stdout.trim()) !== realpathSync(root))
    throw new Error('working-directory must be the Git repository root, not a subdirectory')
  const revision = spawnSync(
    'git',
    ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`],
    { encoding: 'utf8' },
  )
  if (revision.error || revision.status !== 0)
    throw new Error(
      revision.error?.message ||
        'Cannot resolve the reviewed base revision. Use fetch-depth: 0 and check the base input.',
    )
  const baseSha = revision.stdout.trim()
  const configuration = spawnSync('git', ['-C', root, 'show', `${baseSha}:bonsai.json`], {
    encoding: 'utf8',
    maxBuffer: options.maxBuffer,
  })
  if (configuration.error || configuration.status !== 0)
    throw new Error(
      configuration.error?.message ||
        'The reviewed base must contain bonsai.json. Commit the reviewed Bonsai configuration to the base branch first.',
    )
  const policyPath = join(directory, 'reviewed-config.json')
  writeFileSync(policyPath, configuration.stdout)
  const args = [
    ...prefix,
    'check',
    '--root',
    root,
    '--policy',
    policyPath,
    '--json',
    '--no-input',
    '--no-color',
  ]
  if (serial === 'true') args.push('--serial')
  const result = spawnSync(process.execPath, args, options)
  writeFileSync(path, result.stdout || result.stderr || '')
  writeFileSync(join(directory, 'stderr.log'), result.stderr || '')
  if (result.error) throw result.error
  if (result.status === null)
    throw new Error(`Checker stopped without a verdict (${result.signal})`)
  output('exit-code', result.status)
  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    throw new Error(
      `Checker returned no valid JSON report (exit ${result.status}). ${result.stderr || 'Inspect the saved report.'}`,
    )
  }
  const decision = report?.decision
  const exits: Record<string, number> = { pass: 0, reject: 1, incomplete: 2 }
  if (
    !decision ||
    !validSnapshot(report.snapshot) ||
    !Object.hasOwn(exits, decision.status) ||
    exits[decision.status] !== result.status ||
    !['retained', 'ceiling', 'requiredReduction', 'surface'].every((key) =>
      number(decision[key]),
    ) ||
    !Array.isArray(decision.violations) ||
    !decision.violations.every((item: unknown) => typeof item === 'string') ||
    (decision.status === 'pass' &&
      (report.snapshot.evidence?.complete !== true ||
        report.snapshot.evidence.fingerprint !== report.snapshot.fingerprint))
  ) {
    throw new Error(
      'Checker report is missing required measurements or disagrees with its exit code. Inspect the saved report.',
    )
  }
  output('status', decision.status)
  output('retained-tokens', decision.retained)
  output('allowance', decision.ceiling)
  output('required-reduction', decision.requiredReduction)
  const titles: Record<string, string> = {
    pass: 'Passed',
    reject: 'Rejected',
    incomplete: 'Incomplete',
  }
  const title = titles[decision.status]!
  const lines = [
    `## Bonsai · ${title}`,
    '',
    '| Measurement | Tokens |',
    '| --- | ---: |',
    `| Retained code | ${format(decision.retained)} |`,
    `| Allowance | ${format(decision.ceiling)} |`,
    `| Required reduction | ${format(decision.requiredReduction)} |`,
    '',
    `Contract surface: ${format(decision.surface)} action–observation pairs.`,
    `Reviewed policy and inventory: <code>${baseSha}</code>`,
    '',
  ]
  if (decision.status === 'incomplete')
    lines.push('Budget measurements are provisional until analysis and verification complete.', '')
  if (decision.violations.length) {
    lines.push(
      '### Blocking issues',
      '',
      '<ul>',
      ...decision.violations
        .slice(0, 20)
        .map((message: string) => `<li><code>${html(message)}</code></li>`),
      '</ul>',
      '',
    )
    if (decision.violations.length > 20)
      lines.push('The saved JSON report contains every finding.', '')
  }
  if (decision.requiredReduction)
    lines.push(
      'Reclaim retained tokens while preserving required behavior. Extra examples do not buy extra allowance.',
      '',
    )
  if (decision.status !== 'pass')
    lines.push('Fix the blocking issues, then rerun Bonsai locally with the same base commit.', '')
  summary(lines.join('\n'))
  console.log(
    `Bonsai: ${title} · ${format(decision.retained)} / ${format(decision.ceiling)} tokens`,
  )
  if (decision.status !== 'pass')
    annotation(
      `${title}: ${format(decision.retained)} retained tokens / ${format(decision.ceiling)} allowed. ${decision.violations[0] || 'Required verification did not pass.'} See the job summary and JSON report.`,
    )
  process.exitCode = result.status
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (reportPath && !existsSync(reportPath))
    writeFileSync(reportPath, JSON.stringify({ status: 'error', error: message }))
  output('status', 'error')
  summary(`## Bonsai · Error\n\nNo passing verdict is available.\n\n<pre>${html(message)}</pre>\n`)
  annotation(message)
  process.exitCode = 1
}
