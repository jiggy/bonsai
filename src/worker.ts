import { collectEvidence } from './evidence.ts'
import type { Contracts } from './model.ts'

process.once(
  'message',
  async (message: {
    root: string
    bindings: string
    contracts: Contracts
    fingerprint: string
  }) => {
    try {
      const evidence = await collectEvidence(
        message.root,
        message.bindings,
        message.contracts,
        message.fingerprint,
      )
      process.send?.({ evidence })
    } catch (error) {
      process.send?.({ error: String(error) })
    }
  },
)
