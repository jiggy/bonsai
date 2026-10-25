import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import type { Timing, TimingStage } from '../src/model.ts'
import { Timer } from '../src/timing.ts'
import { cliEnvironment, executable, runCli } from './cli.ts'
import { createProject } from './project.ts'

const environment = cliEnvironment()

function fixture(options: { delayMs?: number; feedbackMs?: number; dynamic?: boolean } = {}) {
  return createProject(
    {
      'package.json': '{"type":"module"}',
      'handler.ts': `export async function sample() {
  ${options.dynamic ? "const modulePath = './handler.ts'; await import(modulePath)" : ''}
  await new Promise<void>((done) => setTimeout(done, ${options.delayMs ?? 0}))
  return { status: 'ok' }
}
`,
      'bindings.ts':
        "import { sample } from './handler.ts'\nexport const actions = { 'sample': sample }\n",
      'sample.feature':
        'Feature: Timing\nScenario: Sample\n When I invoke "sample" with {}\n Then response "status" equals "ok"\n',
    },
    { maxFeedbackMs: options.feedbackMs ?? 15000 },
    'bonsai-timing-',
  )
}

function run(root: string, args: string[] = []) {
  const started = performance.now()
  const result = runCli(['check', '--root', root, ...args], {
    timeout: 20000,
    env: environment,
  })
  assert.equal(result.error, undefined, String(result.error))
  return { ...result, wallMs: performance.now() - started }
}

function stage(profile: Timing, name: string): TimingStage {
  const result = profile.stages.find((entry) => entry.name === name)
  assert.ok(result, `${name} missing from ${JSON.stringify(profile)}`)
  return result
}

function measured(profile: Timing) {
  assert.ok(Number.isFinite(profile.elapsedMs) && profile.elapsedMs >= 0)
  for (const entry of profile.stages) {
    if (entry.status === 'skipped') assert.equal(entry.elapsedMs, null)
    else {
      assert.equal(typeof entry.elapsedMs, 'number')
      assert.ok(Number.isFinite(entry.elapsedMs) && entry.elapsedMs! >= 0)
      assert.ok(entry.elapsedMs! <= profile.elapsedMs + 1)
      assert.notEqual(entry.status, 'running', 'A finished command cannot leave a stage running')
    }
    if (entry.stages) {
      assert.notEqual(entry.elapsedMs, null)
      measured({ elapsedMs: entry.elapsedMs!, stages: entry.stages })
      const childrenMs = entry.stages.reduce((sum, child) => sum + (child.elapsedMs ?? 0), 0)
      assert.ok(childrenMs <= entry.elapsedMs! + 1, 'Nested phases exceed their parent duration')
    }
  }
}

function sourceStages(profile: Timing) {
  const source = stage(profile, 'source')
  assert.ok(source.stages, 'Source collection must expose its measured work')
  assert.deepEqual(
    source.stages.map((entry) => entry.name),
    ['measurement', 'program', 'diagnostics', 'graph'],
  )
  assert.ok(source.stages.every((entry) => entry.status === 'completed'))
}

test('interrupted source timing keeps completed work and independent report snapshots', () => {
  const parent = new Timer()
  const child = new Timer()
  parent.start('source', child)
  child.start('program')
  child.start('diagnostics')

  const interrupted = parent.report(true)
  const source = stage(interrupted, 'source')
  assert.equal(source.status, 'interrupted')
  assert.deepEqual(
    source.stages?.map((entry) => [entry.name, entry.status]),
    [
      ['program', 'completed'],
      ['diagnostics', 'interrupted'],
    ],
  )
  parent.finish('interrupted')
  const recorded = parent.report()
  measured(recorded)
  const savedStages = structuredClone(stage(recorded, 'source').stages)

  source.stages!.splice(0)
  stage(recorded, 'source').stages![0]!.status = 'skipped'
  assert.deepEqual(stage(parent.report(), 'source').stages, savedStages)
})

test('check timing includes source collection and actual handler delay in separate measurements', () => {
  const { root, dispose } = fixture({ delayMs: 400 })
  try {
    const result = run(root, ['--json'])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    measured(report.timing)
    measured(report.snapshot.timing)
    sourceStages(report.snapshot.timing)
    sourceStages({
      elapsedMs: stage(report.timing, 'candidate').elapsedMs!,
      stages: stage(report.timing, 'candidate').stages!,
    })
    assert.equal(report.snapshot.evidence.checks[0].status, 'passed')
    assert.equal(stage(report.snapshot.timing, 'verification').status, 'completed')
    assert.ok(stage(report.snapshot.timing, 'verification').elapsedMs! >= 350)
    assert.ok(report.timing.elapsedMs >= report.snapshot.timing.elapsedMs)
    assert.ok(report.timing.elapsedMs <= result.wallMs + 100)
    assert.ok(report.timing.feedback.elapsedMs >= 350)
    assert.equal(report.timing.feedback.limitMs, 15000)
    assert.equal(stage(report.timing, 'candidate').status, 'completed')
    assert.doesNotMatch(result.stdout, /\x1b\[/)
  } finally {
    dispose()
  }
})

test('feedback timeout retains measured stages when no complete evidence exists', () => {
  const { root, dispose } = fixture({ delayMs: 10000, feedbackMs: 5000 })
  try {
    const result = run(root, ['--json'])
    assert.equal(result.status, 2, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.decision.status, 'incomplete')
    assert.equal(report.snapshot.evidence, undefined)
    assert.match(report.snapshot.source.problems.join('\n'), /feedback deadline expired/)
    measured(report.timing)
    measured(report.snapshot.timing)
    sourceStages(report.snapshot.timing)
    const verification = stage(report.snapshot.timing, 'verification')
    assert.equal(verification.status, 'interrupted')
    assert.ok(verification.elapsedMs! > 100)
    assert.ok(report.timing.feedback.elapsedMs >= 4500)
    assert.equal(report.timing.feedback.limitMs, 5000)
    assert.ok(report.timing.elapsedMs <= result.wallMs + 100)
  } finally {
    dispose()
  }
})

test('base analysis is measured separately from the candidate feedback window', () => {
  const { root, dispose } = fixture()
  try {
    execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' })
    execFileSync('git', ['-C', root, 'add', '.'])
    execFileSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'user.name=Bonsai Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '-m',
        'Base',
      ],
      { stdio: 'ignore' },
    )
    const result = run(root, ['--json', '--base', 'HEAD'])
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    const base = stage(report.timing, 'base')
    assert.equal(base.status, 'completed')
    assert.ok(base.elapsedMs! > 0)
    assert.ok(
      base.stages?.some((entry) => entry.name === 'verification' && entry.status === 'skipped'),
    )
    measured(report.timing)
    sourceStages({ elapsedMs: base.elapsedMs!, stages: base.stages! })
    sourceStages(report.snapshot.timing)
    assert.ok(report.timing.elapsedMs >= base.elapsedMs! + report.timing.feedback.elapsedMs)
    assert.equal(report.timing.feedback.limitMs, 15000)
  } finally {
    dispose()
  }
})

test('unsupported source marks verification not run instead of assigning a measured zero', () => {
  const { root, dispose } = fixture({ dynamic: true })
  try {
    const result = run(root, ['--json'])
    assert.equal(result.status, 2, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.snapshot.evidence, undefined)
    assert.equal(stage(report.snapshot.timing, 'verification').status, 'skipped')
    assert.equal(stage(report.snapshot.timing, 'verification').elapsedMs, null)
    measured(report.timing)
    measured(report.snapshot.timing)
    sourceStages(report.snapshot.timing)
    const human = run(root, ['--verbose', '--output', 'human'])
    assert.equal(human.status, 2, human.stderr)
    assert.match(human.stderr, /Timing/)
    assert.match(human.stderr, /Compiler setup[^\n]*\d+(?:\.\d+)?(?:ms|s)/)
    assert.match(human.stderr, /Type checking[^\n]*\d+(?:\.\d+)?(?:ms|s)/)
    assert.match(human.stderr, /Verification[^\n]*not run/i)
    assert.match(human.stderr, /[\d.]+\s*(?:ms|s) elapsed/)
  } finally {
    dispose()
  }
})

test('command timeout reports partial timing on stderr while waiting for policy input', async () => {
  const { root, dispose } = fixture()
  const child = spawn(
    process.execPath,
    [executable, 'check', '--root', root, '--policy', '-', '--json', '--timeout', '0.25'],
    { env: environment, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 5000)
  try {
    const code = await new Promise<number | null>((done, reject) => {
      child.once('error', reject)
      child.once('close', done)
    })
    assert.equal(code, 1, stderr)
    assert.equal(stdout, '')
    const error = JSON.parse(stderr)
    assert.equal(error.code, 'TIMEOUT')
    measured(error.timing)
    assert.ok(error.timing.elapsedMs >= 200)
    assert.ok(error.timing.stages.some((entry: TimingStage) => entry.status === 'interrupted'))
  } finally {
    clearTimeout(watchdog)
    child.stdin.destroy()
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    dispose()
  }
})

test('normal human output includes elapsed time while quiet and plain keep their contracts', () => {
  const { root, dispose } = fixture()
  try {
    const human = run(root, ['--output', 'human'])
    assert.equal(human.status, 0, human.stderr)
    assert.match(human.stdout, /1 checks? passed[^\n]*[\d.]+\s*(?:ms|s) elapsed/)
    assert.doesNotMatch(human.stdout, /\nTiming\n/)
    const quiet = run(root, ['--quiet', '--output', 'human'])
    assert.equal(quiet.status, 0, quiet.stderr)
    assert.equal(quiet.stdout, '')
    assert.equal(quiet.stderr, '')
    const plain = run(root, ['--plain', '--verbose'])
    assert.equal(plain.status, 0, plain.stderr)
    assert.equal(plain.stdout.trimEnd().split('\t').length, 8)
    assert.doesNotMatch(plain.stdout, /Timing|elapsed/)
    const quietJson = run(root, ['--quiet', '--json'])
    assert.equal(quietJson.status, 0, quietJson.stderr)
    measured(JSON.parse(quietJson.stdout).timing)
  } finally {
    dispose()
  }
})
