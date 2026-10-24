import { readFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { measureSource, collectSourceGraph } from './source.ts'
import { createTsrsProgram } from './tsrs-adapter.ts'
import { Timer } from './timing.ts'

type Request = { protocol: 2; root: string; files: string[]; bindings: string; cwd: string }

const started = performance.now()
const timer = new Timer(started)
const cancellation = new AbortController()
const stop = () => cancellation.abort()
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
try {
  const request = JSON.parse(readFileSync(0, 'utf8')) as Request
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
    timer.finish(adapter.program ? 'completed' : 'interrupted')
  } finally {
    await adapter.close()
  }
  const version = createRequire(import.meta.url)('tsrs/package.json').version as string
  process.stdout.write(
    JSON.stringify({
      protocol: 2,
      source,
      diagnostics: 'run',
      diagnosticCategories: ['config', 'options', 'syntactic', 'bind', 'global', 'semantic'],
      backend: 'tsrs',
      version,
      elapsedMs: performance.now() - started,
      timing: timer.report(),
    }) + '\n',
  )
} catch (error) {
  timer.finish('interrupted')
  process.stdout.write(
    JSON.stringify({ protocol: 2, error: String(error), timing: timer.report() }) + '\n',
  )
} finally {
  process.removeListener('SIGTERM', stop)
  process.removeListener('SIGINT', stop)
}
