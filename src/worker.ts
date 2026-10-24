import { collectEvidence } from './evidence.ts'
import type { Config, Contracts } from './model.ts'

process.once(
  'message',
  async (message: {
    root: string
    config: Config
    contracts: Contracts
    fingerprint: string
    engine?: 'typescript' | 'rust'
  }) => {
    try {
      // Bonsai's own feature bindings verify the backend selected by the caller.
      process.env.BONSAI_SELF_HOST_ENGINE = message.engine ?? 'typescript'
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
