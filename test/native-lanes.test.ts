import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { openNativeSession } from '../src/native-session.ts'

test('isolated native lanes own brokers without closing the inherited scope', async () => {
  const previous = process.env.BONSAI_NATIVE_SESSION
  const owner = await openNativeSession({ inherit: false })
  const sessions = [owner]
  const socket = (value: string) => JSON.parse(value).path as string
  try {
    process.env.BONSAI_NATIVE_SESSION = owner.value
    const borrowed = await openNativeSession()
    assert.equal(borrowed.value, owner.value)
    await borrowed.close()
    assert.equal(existsSync(socket(owner.value)), true)

    const first = await openNativeSession({ inherit: false })
    sessions.push(first)
    const second = await openNativeSession({ inherit: false })
    sessions.push(second)
    assert.equal(process.env.BONSAI_NATIVE_SESSION, owner.value)
    assert.equal(new Set(sessions.map((session) => socket(session.value))).size, 3)

    await first.close()
    assert.equal(existsSync(dirname(socket(first.value))), false)
    assert.equal(existsSync(socket(second.value)), true)
    assert.equal(existsSync(socket(owner.value)), true)
  } finally {
    if (previous === undefined) delete process.env.BONSAI_NATIVE_SESSION
    else process.env.BONSAI_NATIVE_SESSION = previous
    await Promise.all(sessions.map((session) => session.close()))
  }
  for (const session of sessions) assert.equal(existsSync(dirname(socket(session.value))), false)
})
