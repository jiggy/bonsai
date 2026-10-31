import { readFileSync, realpathSync, rmSync, rmdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import { measureSource, collectSourceGraph } from './source.ts'
import { createTsrsProgram } from './tsrs-adapter.ts'
import { Timer } from './timing.ts'

type Request = { protocol: 2; root: string; files: string[]; bindings: string; cwd: string }

const cancellation = new AbortController()
const stop = () => cancellation.abort()
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
async function analyze(request: Request) {
  const started = performance.now()
  const timer = new Timer(started)
  try {
    if (request.protocol !== 2) throw new Error('Unsupported native semantic protocol')
    const root = realpathSync(request.root)
    timer.start('measurement')
    const source = measureSource(root, request.files)
    const adapter = await createTsrsProgram(
      root,
      request.files,
      request.cwd,
      timer,
      cancellation.signal,
    )
    try {
      source.problems.push(...adapter.problems)
      if (adapter.program)
        collectSourceGraph(root, request.files, request.bindings, source, adapter.program)
      adapter.graphTimer?.finish()
      timer.finish(adapter.program ? 'completed' : 'interrupted')
    } finally {
      await adapter.close()
    }
    const version = createRequire(import.meta.url)('tsrs/package.json').version as string
    return {
      protocol: 2,
      source,
      diagnostics: 'run',
      diagnosticCategories: ['config', 'options', 'syntactic', 'bind', 'global', 'semantic'],
      backend: 'tsrs',
      version,
      elapsedMs: performance.now() - started,
      timing: timer.report(),
    }
  } catch (error) {
    timer.finish('interrupted')
    return { protocol: 2, error: String(error), timing: timer.report() }
  }
}

try {
  if (process.argv[2] === '--session') {
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
    // The owner never ends an active session pipe during ordinary retirement.
    // EOF also covers SIGKILL, when its normal directory cleanup cannot run.
    const orphaned = () => {
      stop()
      if (process.argv[3]) {
        try {
          rmSync(join(process.argv[3], 'n.sock'), { force: true })
          rmdirSync(process.argv[3])
        } catch {
          /* The owner may already have removed this scope. */
        }
      }
    }
    process.stdin.once('end', orphaned)
    // An active readline/SDK wait must not make owner death depend on EOF delivery.
    const owner = Number(process.argv[4] ?? process.ppid)
    if (!Number.isSafeInteger(owner) || owner < 1) throw new Error('Invalid native session owner')
    const ownerWatch = setInterval(() => {
      try {
        if (process.ppid !== owner) orphaned()
        else process.kill(owner, 0)
      } catch {
        orphaned()
      }
    }, 100)
    ownerWatch.unref()
    const end = () => {
      lines.close()
      process.stdin.destroy()
    }
    cancellation.signal.addEventListener('abort', end, { once: true })
    try {
      for await (const line of lines) {
        if (cancellation.signal.aborted) break
        const envelope = JSON.parse(line) as { id: number; request: Request }
        if (!Number.isSafeInteger(envelope.id) || envelope.id < 1)
          throw new Error('Invalid native session request identity')
        const response = await analyze(envelope.request)
        process.stdout.write(JSON.stringify({ id: envelope.id, response }) + '\n')
      }
    } finally {
      lines.close()
      cancellation.signal.removeEventListener('abort', end)
      process.stdin.removeListener('end', orphaned)
      clearInterval(ownerWatch)
    }
  } else {
    const request = JSON.parse(readFileSync(0, 'utf8')) as Request
    process.stdout.write(JSON.stringify(await analyze(request)) + '\n')
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ protocol: 2, error: String(error) }) + '\n')
} finally {
  process.removeListener('SIGTERM', stop)
  process.removeListener('SIGINT', stop)
}
