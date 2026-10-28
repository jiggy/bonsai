import { writeFileSync } from 'node:fs'
import { collectRustSource } from '../src/collector.ts'
import { openNativeSession } from '../src/native-session.ts'

const session = await openNativeSession()
writeFileSync(process.argv[4]!, session.value)
process.env.BONSAI_NATIVE_SESSION = session.value
await collectRustSource(
  process.argv[2]!,
  JSON.parse(process.argv[3]!),
  'bindings.ts',
  undefined,
  30000,
)
