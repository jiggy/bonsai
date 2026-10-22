import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executable = resolve('src/cli.ts')
const payload = 'x'.repeat(2 * 1024 * 1024)
const environment = {
  ...process.env,
  BONSAI_ROOT: undefined,
  BONSAI_BASE: undefined,
  BONSAI_POLICY: undefined,
  FORCE_COLOR: undefined,
  NO_COLOR: '1',
  CI: '1',
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bonsai output's root #"))
  writeFileSync(join(root, 'bindings.ts'), 'export const actions = {}\n')
  writeFileSync(
    join(root, 'bonsai.json'),
    JSON.stringify({
      maintained: ['bindings.ts', 'bonsai.json'],
      bindings: 'bindings.ts',
      policy: {
        bootstrap: 20000,
        bootstrapSurface: 20,
        perDoubling: 2000,
        hardLimit: 30000,
        maxFeedbackMs: 15000,
        padding: payload,
      },
    }),
  )
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function report(root: string, timeout = '2') {
  const started = Date.now()
  const child = spawn(
    process.execPath,
    [executable, 'config', 'show', '--root', root, '--json', '--timeout', timeout],
    { env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stderr = ''
  const stdout: Buffer[] = []
  let consuming = false
  let watchdogExpired = false
  child.stderr.on('data', (data) => {
    stderr += data
  })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (done, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => done({ code, signal }))
    },
  )
  const closed = new Promise<void>((done) => child.once('close', () => done()))
  const watchdog = setTimeout(() => {
    watchdogExpired = true
    child.kill('SIGKILL')
    child.stdout.destroy()
  }, 8000)
  child.once('exit', () => clearTimeout(watchdog))
  const consume = () => {
    if (consuming || child.stdout.destroyed) return
    consuming = true
    child.stdout.on('data', (data) => stdout.push(Buffer.from(data)))
    child.stdout.resume()
  }
  return {
    child,
    exited,
    consume,
    async buffered() {
      if (child.stdout.readableLength) return
      let readable: () => void = () => {}
      try {
        await Promise.race([
          new Promise<void>((done) => {
            readable = done
            child.stdout.once('readable', readable)
          }),
          exited.then((result) => {
            throw new Error(
              `Command exited before filling stdout: ${JSON.stringify(result)} ${stderr}`,
            )
          }),
        ])
        assert.ok(child.stdout.readableLength > 0, 'stdout closed before producing data')
      } finally {
        child.stdout.removeListener('readable', readable)
      }
    },
    async finish() {
      const result = await exited
      consume()
      await closed
      return {
        ...result,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr,
        elapsed: Date.now() - started,
        watchdogExpired,
      }
    },
    async dispose() {
      clearTimeout(watchdog)
      child.stdout.destroy()
      child.stderr.destroy()
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exited.catch(() => {})
      await closed
    },
  }
}

test('an unread report remains subject to its command deadline', async () => {
  const { root, dispose } = fixture()
  const running = report(root)
  let diagnostic = ''
  let closedOnTimeout = false
  let closedBeforeExit = false
  running.child.stderr.on('data', (data) => {
    diagnostic += data
    if (!closedOnTimeout && /"code"\s*:\s*"TIMEOUT"/.test(diagnostic)) {
      closedOnTimeout = true
      closedBeforeExit = running.child.exitCode === null && running.child.signalCode === null
      running.child.stdout.destroy()
    }
  })
  try {
    await running.buffered()
    const result = await running.finish()
    assert.equal(result.watchdogExpired, false, 'command outlived the test watchdog')
    assert.equal(closedOnTimeout, true, 'stdout stayed open after the timeout diagnostic')
    assert.equal(closedBeforeExit, true, 'stdout closed after the child had already exited')
    assert.equal(result.code, 1, result.stderr)
    assert.equal(result.signal, null)
    assert.equal(JSON.parse(result.stderr).code, 'TIMEOUT')
    assert.ok(result.elapsed < 4500, 'stdout backpressure prevented the deadline')
  } finally {
    await running.dispose()
    dispose()
  }
})

test('a throttled reader cannot turn an expired report into a late success', async () => {
  const { root, dispose } = fixture()
  const running = report(root)
  let reading: ReturnType<typeof setInterval> | undefined
  let received = 0
  try {
    await running.buffered()
    reading = setInterval(() => {
      const chunk = running.child.stdout.read(1024)
      if (chunk) received += chunk.length
    }, 20)
    await running.exited
    clearInterval(reading)
    const result = await running.finish()
    assert.equal(result.watchdogExpired, false, 'command outlived the test watchdog')
    assert.equal(result.code, 1, result.stderr)
    assert.equal(result.signal, null)
    assert.equal(JSON.parse(result.stderr).code, 'TIMEOUT')
    assert.ok(received > 0 && received < payload.length, 'reader did not keep stdout blocked')
    assert.ok(result.elapsed < 4500, 'slow stdout consumption prevented the deadline')
  } finally {
    clearInterval(reading)
    await running.dispose()
    dispose()
  }
})

test('SIGINT interrupts a report whose stdout reader is blocked', async () => {
  const { root, dispose } = fixture()
  const running = report(root, '5')
  try {
    await running.buffered()
    const interrupted = Date.now()
    running.child.kill('SIGINT')
    const result = await running.finish()
    assert.equal(result.watchdogExpired, false, 'command outlived the test watchdog')
    assert.equal(result.code, 130, result.stderr)
    assert.equal(result.signal, null)
    assert.equal(JSON.parse(result.stderr).code, 'SIGINT')
    assert.ok(Date.now() - interrupted < 3000, 'stdout backpressure prevented interruption')
  } finally {
    await running.dispose()
    dispose()
  }
})

test('a normal reader receives the entire report before a successful exit', async () => {
  const { root, dispose } = fixture()
  const running = report(root, '5')
  try {
    running.consume()
    const result = await running.finish()
    assert.equal(result.watchdogExpired, false, 'command outlived the test watchdog')
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.signal, null)
    assert.equal(result.stderr, '')
    const output = JSON.parse(result.stdout)
    assert.equal(output.root, root)
    assert.equal(output.config.policy.padding, payload)
    assert.ok(result.stdout.endsWith('\n'))
  } finally {
    await running.dispose()
    dispose()
  }
})

test('closing a report pipe remains quiet and exits successfully', async () => {
  const { root, dispose } = fixture()
  const running = report(root, '5')
  try {
    await running.buffered()
    running.child.stdout.destroy()
    const result = await running.finish()
    assert.equal(result.watchdogExpired, false, 'command outlived the test watchdog')
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.signal, null)
    assert.equal(result.stderr, '')
  } finally {
    await running.dispose()
    dispose()
  }
})
