import { inspect, types } from 'node:util'
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { serialize, deserialize } from 'node:v8'
import { projectBindingTarget } from './binding-target.ts'
import { isMainThread, parentPort, Worker } from 'node:worker_threads'
import type { ExecutionIdentity } from './identity.ts'
import type { Config, ActionSelection, ActionResult, ActionRequest } from './model.ts'

const clone = structuredClone
const stop = process.exit.bind(process)
const hasOwn = Object.hasOwn
const setPrototype = Object.setPrototypeOf

/** A failed observation needs its returned context, without running inspection hooks. */
function responsePreview(response: unknown): string {
  let remaining = 32
  let truncated = false
  const seen = new WeakSet<object>()
  const bounded = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') {
      if (value.length <= 256) return value
      truncated = true
      return value.slice(0, 256).replace(/[\uD800-\uDBFF]$/, '') + '…'
    }
    if (typeof value === 'function') return '[Function]'
    if (typeof value === 'symbol') return '[Symbol]'
    if (typeof value === 'bigint') return '[BigInt]'
    if (value === null || typeof value !== 'object') return value
    if (types.isProxy(value)) return '[Proxy]'
    if (types.isTypedArray(value)) return '[TypedArray]'
    if (seen.has(value)) return '[Reference]'
    if (!depth || remaining <= 0) {
      truncated = true
      return Array.isArray(value) ? '[Array]' : '[Object]'
    }
    seen.add(value)
    const array = Array.isArray(value)
    const names = array ? [] : Object.keys(value)
    if (array ? value.length > 5 : names.length > 8) truncated = true
    const keys = array
      ? Array.from({ length: Math.min(value.length, 5) }, (_, index) => String(index))
      : names.slice(0, 8)
    const entries: [string, unknown][] = []
    for (const key of keys) {
      if (remaining <= 0) {
        truncated = true
        break
      }
      remaining--
      const property = Object.getOwnPropertyDescriptor(value, key)
      if (key.length > 64) truncated = true
      const label = key.length > 64 ? key.slice(0, 64).replace(/[\uD800-\uDBFF]$/, '') + '…' : key
      entries.push([
        label,
        property && 'value' in property ? bounded(property.value, depth - 1) : '[Accessor]',
      ])
    }
    return array ? entries.map(([, item]) => item) : Object.fromEntries(entries)
  }
  try {
    const preview = bounded(response, 2)
    const text = inspect(preview, {
      customInspect: false,
      getters: false,
      colors: false,
      depth: 3,
      compact: true,
      breakLength: Infinity,
    })
    const marked = text + (truncated ? ' …' : '')
    const points = Array.from(marked)
    return points.length > 512 ? points.slice(0, 511).join('') + '…' : marked
  } catch {
    return '[Response preview unavailable]'
  }
}

async function loadActions(
  root: string,
  config: Config,
  fingerprint: string,
  compiler?: ExecutionIdentity['compiler'],
) {
  const target = projectBindingTarget(root, config, fingerprint)
  const module = (await import(target.url)) as {
    actions: Record<string, (input: unknown) => unknown>
  }
  return module.actions
}

if (isMainThread) {
  // No IPC descriptor is inherited. Close bootstrap input before starting the
  // candidate heap; the authenticated result is written only after that heap stops.
  try {
    const message = deserialize(readFileSync(0)) as {
      root: string
      config: Config
      fingerprint: string
      requests: ActionRequest[]
      compiler?: ExecutionIdentity['compiler']
      pythonSources?: Record<string, string>
      path: string
      key: Uint8Array
    }
    closeSync(0)
    // Keep standard descriptors occupied so native worker handles cannot reuse fd 0.
    if (openSync(process.platform === 'win32' ? 'NUL' : '/dev/null', 'r') !== 0) stop(1)
    const { port1, port2 } = new MessageChannel()
    let runtime: Worker | undefined
    let finishing = false
    let next = 0
    const results: ActionResult[] = []
    const finish = async (report: { results: ActionResult[] } | { error: string }) => {
      if (finishing) return
      finishing = true
      await runtime?.terminate()
      port1.close()
      const payload = serialize(report)
      const signature = createHmac('sha256', message.key)
        .update('bonsai-action-plan-v1:')
        .update(payload)
        .digest()
      writeFileSync(message.path, Buffer.concat([signature, payload]), { flag: 'wx', mode: 0o600 })
      stop(0)
    }
    if (message.config.bindings.endsWith('.py')) {
      projectBindingTarget(message.root, message.config, message.fingerprint)
      const invoke = async () => {
        const { pythonActionPlan } = await import('./python.ts')
        return pythonActionPlan(
          message.root,
          message.config,
          message.requests,
          message.compiler,
          message.pythonSources,
        )
      }
      void invoke().then(
        (results) => finish({ results }),
        (error) => finish({ error: String(error) }),
      )
    } else {
      runtime = new Worker(new URL('./worker.ts', import.meta.url))
      runtime.once('error', (error) => void finish({ error: String(error) }))
      runtime.once('exit', () => {
        if (!finishing) stop(1)
      })
      port1.onmessage = (event) => {
        const result = event.data as ActionResult | { kind: 'ready' | 'load-error'; error?: string }
        if (result.kind === 'load-error') {
          void finish({ error: result.error ?? 'Application binding failed to load' })
          return
        }
        if (result.kind === 'result') results.push(result)
        else if (result.kind !== 'ready' || next !== 0) stop(1)
        if (next < message.requests.length) port1.postMessage(message.requests[next++])
        else void finish({ results })
      }
      // Bun transfers its native port here; Node's declaration requires its richer facade.
      runtime.postMessage(
        {
          root: message.root,
          config: message.config,
          fingerprint: message.fingerprint,
          operations: message.requests.length,
          compiler: message.compiler,
          port: port2,
        },
        [port2 as unknown as import('node:worker_threads').MessagePort],
      )
    }
  } catch {
    stop(1)
  }
} else {
  parentPort!.once(
    'message',
    async (message: {
      root: string
      config: Config
      fingerprint: string
      operations: number
      compiler?: ExecutionIdentity['compiler']
      port: MessagePort
    }) => {
      // This transferred native capability is private. The public parentPort is
      // deliberately unused after bootstrap; arbitrary posts to it are ignored.
      const send = message.port.postMessage.bind(message.port)
      const listen = message.port.addEventListener.bind(message.port)
      const readMessage = Function.prototype.call.bind(
        Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data')!.get!,
      )
      try {
        // Starting a port invokes a mutable prototype method; do it before imports.
        message.port.start()
        const actions = await loadActions(
          message.root,
          message.config,
          message.fingerprint,
          message.compiler,
        )
        let next = 1
        let active = false
        listen('message', async (event: MessageEvent) => {
          const request = readMessage(event) as {
            kind: string
            id: number
            action: string
            input: unknown
            selections: ActionSelection[]
          }
          if (active || next > message.operations) stop(1)
          active = true
          const id = next++
          try {
            if (request.kind !== 'invoke' || request.id !== id) stop(1)
            const action = request.action
            const input = request.input
            const selections = request.selections
            const result: ActionResult = { kind: 'result', id, action }
            setPrototype(result, null)
            try {
              if (!hasOwn(actions, action) || typeof actions[action] !== 'function')
                throw new Error('Unbound action: ' + action)
              const response = await actions[action]!(input)
              const observations: NonNullable<ActionResult['observations']> = []
              setPrototype(observations, null)
              for (let index = 0; index < selections.length; index++) {
                const selection = selections[index]!
                try {
                  let value = response
                  for (let part = 0; part < selection.keys.length; part++) {
                    const key = selection.keys[part]!
                    if (value === null || typeof value !== 'object' || !hasOwn(value, key))
                      throw new Error('Missing response field: ' + selection.selector)
                    value = (value as Record<string, unknown>)[key]
                  }
                  observations[index] = { selector: selection.selector, value: clone(value) }
                } catch (error) {
                  observations[index] = { selector: selection.selector, error: String(error) }
                }
              }
              result.observations = observations
              result.preview = responsePreview(response)
            } catch (error) {
              result.error = String(error)
            }
            send(result)
            active = false
          } catch {
            stop(1)
          }
        })
        send({ kind: 'ready' })
      } catch (error) {
        send({ kind: 'load-error', error: String(error) })
      }
    },
  )
}
