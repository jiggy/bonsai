import { collectEvidence } from './evidence.ts'
import type { Config, Contracts } from './model.ts'
import { executionIdentity, sameExecutionIdentity, type ExecutionIdentity } from './identity.ts'

process.once(
  'message',
  async (message: {
    root: string
    config: Config
    contracts: Contracts
    fingerprint: string
    identity: ExecutionIdentity
  }) => {
    try {
      const identity = executionIdentity()
      if (!sameExecutionIdentity(identity, message.identity))
        throw new Error('Verification checker or toolchain identity changed')
      const evidence = await collectEvidence(
        message.root,
        message.config,
        message.contracts,
        message.fingerprint,
        identity,
      )
      process.send?.({ evidence })
    } catch (error) {
      process.send?.({ error: String(error) })
    }
  },
)
