import { collectEvidence } from './evidence.ts'
import type { Config, Contracts } from './model.ts'

process.once(
  'message',
  async (message: { root: string; config: Config; contracts: Contracts; fingerprint: string }) => {
    try {
      const evidence = await collectEvidence(
        message.root,
        message.config,
        message.contracts,
        message.fingerprint,
      )
      process.send?.({ evidence })
    } catch (error) {
      process.send?.({ error: String(error) })
    }
  },
)
