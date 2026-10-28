import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { invoke, startCli } from './cli.ts'
import { project, write } from './project.ts'

type Input = { case: 'required-calls' | 'crash' | 'timeout' | 'cancel' | 'source-change' }
type Event = { kind: 'start' | 'finish'; id: number; pid: number }

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    if (process.platform === 'linux') {
      const state = readFileSync(`/proc/${pid}/stat`, 'utf8')
      if (state.slice(state.lastIndexOf(')') + 2).startsWith('Z ')) return false
    }
    return true
  } catch (error) {
    if (['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) return false
    throw error
  }
}

async function until(predicate: () => boolean, timeoutMs = 1500) {
  const deadline = performance.now() + timeoutMs
  while (!predicate() && performance.now() < deadline) await delay(5)
  return predicate()
}

function blockedProject(kind: Input['case']) {
  const count = kind === 'required-calls' ? 3 : availableParallelism() + 1
  const capacity = Math.min(availableParallelism(), count)
  const fixture = project(
    {
      'handler.ts': `import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const wait = new Int32Array(new SharedArrayBuffer(4))
export function run(input: { id: number }) {
  const file = (name: string) => fileURLToPath(new URL(name, import.meta.url))
  writeFileSync(file('started-' + input.id), String(process.pid))
  appendFileSync(file('events'), JSON.stringify({kind:'start', id:input.id, pid:process.pid}) + '\\n')
  ${kind === 'crash' ? `if (input.id === 0) { ${capacity > 1 ? "while (!existsSync(file('started-1'))) Atomics.wait(wait, 0, 0, 5);" : ''} process.exit(17) }` : ''}
  while (!existsSync(file('release-' + input.id))) Atomics.wait(wait, 0, 0, 5)
  appendFileSync(file('events'), JSON.stringify({kind:'finish', id:input.id, pid:process.pid}) + '\\n')
  writeFileSync(file('finished-' + input.id), 'done')
  return { id:input.id }
}
`,
      'bindings.ts': "import { run } from './handler.ts'\nexport const actions = { 'run': run }\n",
      'verification.feature':
        'Feature: Independent required calls\n' +
        Array.from(
          { length: count },
          (_, id) =>
            `Scenario: Input ${id}\n When I invoke "run" with {"id":${id}}\n Then response "id" equals ${id}\n`,
        ).join('\n'),
    },
    { maxFeedbackMs: kind === 'timeout' ? 2500 : 15000 },
  )
  return { ...fixture, count, capacity }
}

async function execution(kind: Exclude<Input['case'], 'source-change'>) {
  const fixture = blockedProject(kind)
  const child = startCli(['check', '--root', fixture.root, '--json'])
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  const closed = new Promise<number | null>((done, reject) => {
    child.once('error', reject)
    child.once('close', done)
  })
  void closed.catch(() => {})
  const forced = setTimeout(() => child.kill('SIGTERM'), 10000)
  const killed = setTimeout(() => child.kill('SIGKILL'), 10500)
  const names = () => readdirSync(fixture.root)
  const started = () => names().filter((name) => name.startsWith('started-'))
  try {
    if (kind === 'required-calls') {
      // Exact overlap, CPU-sized scheduling, and out-of-order reporting have
      // explicit-lane regressions in test/evidence-parallel.test.ts. This
      // arrangement observes actual required calls on hosts of any CPU size.
      for (let id = 0; id < fixture.count; id++) write(fixture.root, `release-${id}`, 'go')
    } else if (kind === 'cancel') {
      await until(() => started().length >= fixture.capacity, 5000)
      child.kill('SIGINT')
    }
    const status = await closed
    const report = JSON.parse(stdout || stderr)
    const events: Event[] = existsSync(join(fixture.root, 'events'))
      ? readFileSync(join(fixture.root, 'events'), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : []
    const pids = started().map((name) => Number(readFileSync(join(fixture.root, name), 'utf8')))
    await until(() => pids.every((pid) => !alive(pid)))
    return {
      exitCode: status,
      ...report,
      application: {
        startedInputs: events
          .filter((event) => event.kind === 'start')
          .map((event) => event.id)
          .sort((a, b) => a - b),
        finishedInputs: events
          .filter((event) => event.kind === 'finish')
          .map((event) => event.id)
          .sort((a, b) => a - b),
        started: pids.length > 0,
        queuedInputsStarted: started()
          .map((name) => Number(name.slice('started-'.length)))
          .filter((id) => id >= fixture.capacity)
          .sort((a, b) => a - b),
        runningPids: pids.filter(alive),
      },
    }
  } finally {
    clearTimeout(forced)
    clearTimeout(killed)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await Promise.race([closed.catch(() => {}), delay(500)])
      child.kill('SIGKILL')
    }
    for (const name of started()) {
      const pid = Number(readFileSync(join(fixture.root, name), 'utf8'))
      if (alive(pid)) {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          /* Already stopped. */
        }
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* Already stopped. */
        }
      }
    }
    fixture.dispose()
  }
}

export async function checkVerification(input: Input) {
  if (input.case !== 'source-change') return execution(input.case)
  const fixture = project({
    'data.json': '{"revision":1}\n',
    'handler.ts': `import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export function update() {
  writeFileSync(fileURLToPath(new URL('./data.json', import.meta.url)), '{"revision":2}\\n')
  return { status:'ok' }
}
`,
    'bindings.ts':
      "import { update } from './handler.ts'\nexport const actions = { 'update': update }\n",
    'verification.feature':
      'Feature: Stable inputs\nScenario: Update maintained input\n When I invoke "update" with {}\n Then response "status" equals "ok"\n',
  })
  try {
    const report = invoke(['check', '--root', fixture.root])
    return { ...report, maintainedText: readFileSync(join(fixture.root, 'data.json'), 'utf8') }
  } finally {
    fixture.dispose()
  }
}
