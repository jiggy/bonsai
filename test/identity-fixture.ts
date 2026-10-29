import type { ExecutionIdentity } from '../src/identity.ts'

// Assumed identities are pure evaluator inputs, never runtime evidence or attestation.
export const assumedIdentity: ExecutionIdentity = {
  schema: 'bonsai-execution-v1',
  checker: { name: 'bonsai-test-fixture', version: 'test-only', digest: '0'.repeat(64) },
  runtime: { name: 'bun', version: 'test-only', options: '0'.repeat(64) },
  compiler: { name: 'tsrs', version: 'test-only', digest: '0'.repeat(64) },
}
