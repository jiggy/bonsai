import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  checkerIdentity,
  executionIdentity,
  sameExecutionIdentity,
  validExecutionIdentity,
} from '../src/identity.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-identity-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'package.json'), '{"name":"@jigging/bonsai","version":"1.0.0"}')
  writeFileSync(join(root, 'src', 'handler.ts'), 'export const status = "ok"\n')
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

test('checker identity follows content through relocation and changes without a version bump', () => {
  const first = fixture()
  const second = fixture()
  try {
    const control = checkerIdentity(first.root)
    assert.deepEqual(checkerIdentity(second.root), control)
    writeFileSync(join(first.root, 'src', 'handler.ts'), 'export const status = "no"\n')
    const edited = checkerIdentity(first.root)
    assert.equal(edited.version, control.version)
    assert.notEqual(edited.digest, control.digest)
    writeFileSync(join(first.root, 'src', 'worker.ts'), 'export const worker = true\n')
    assert.notEqual(checkerIdentity(first.root).digest, edited.digest)
    unlinkSync(join(first.root, 'src', 'worker.ts'))
    assert.deepEqual(checkerIdentity(first.root), edited)
    writeFileSync(join(first.root, 'package.json'), '{"name":"@jigging/bonsai","version":"1.0.1"}')
    assert.equal(checkerIdentity(first.root).version, '1.0.1')
  } finally {
    first.dispose()
    second.dispose()
  }
})

test('native toolchain identity records bytes rather than binary location or candidate packages', () => {
  const candidate = fixture()
  const first = join(candidate.root, 'first-native')
  const second = join(candidate.root, 'second-native')
  writeFileSync(first, 'native api implementation')
  writeFileSync(second, 'native api implementation')
  const cwd = process.cwd()
  try {
    const baseline = executionIdentity(first)
    assert.equal(validExecutionIdentity(baseline), true)
    assert.deepEqual(executionIdentity(second).compiler, baseline.compiler)
    mkdirSync(join(candidate.root, 'node_modules', 'tsrs'), { recursive: true })
    writeFileSync(
      join(candidate.root, 'node_modules', 'tsrs', 'package.json'),
      '{"version":"forged"}',
    )
    process.chdir(candidate.root)
    assert.deepEqual(executionIdentity(first).compiler, baseline.compiler)
    writeFileSync(first, 'native api implementatioN')
    const edited = executionIdentity(first)
    assert.equal(edited.compiler.version, baseline.compiler.version)
    assert.notEqual(edited.compiler.digest, baseline.compiler.digest)
  } finally {
    process.chdir(cwd)
    candidate.dispose()
  }
})

test('explicit native symlinks identify their executable bytes while source symlinks are rejected', () => {
  const candidate = fixture()
  const binary = join(candidate.root, 'native')
  const alias = join(candidate.root, 'alias')
  try {
    writeFileSync(binary, 'api implementation')
    symlinkSync(binary, alias)
    assert.deepEqual(executionIdentity(alias).compiler, executionIdentity(binary).compiler)
    symlinkSync(binary, join(candidate.root, 'src', 'linked.ts'))
    assert.throws(() => checkerIdentity(candidate.root), /Identity source cannot be a symlink/)
    assert.throws(() => executionIdentity(candidate.root), /Identity input must be a regular file/)
  } finally {
    candidate.dispose()
  }
})

test('runtime identity detects preload option changes without exposing option strings', () => {
  const candidate = fixture()
  const binary = join(candidate.root, 'native')
  const original = process.env.BUN_OPTIONS
  try {
    writeFileSync(binary, 'api implementation')
    const before = executionIdentity(binary)
    process.env.BUN_OPTIONS = `${original ?? ''} --preload ./different-runtime.ts`
    const after = executionIdentity(binary)
    assert.equal(after.runtime.version, process.versions.bun)
    assert.notEqual(after.runtime.options, before.runtime.options)
    assert.doesNotMatch(JSON.stringify(after.runtime), /different-runtime/)
    assert.equal(sameExecutionIdentity(before, after), false)
  } finally {
    if (original === undefined) delete process.env.BUN_OPTIONS
    else process.env.BUN_OPTIONS = original
    candidate.dispose()
  }
})

test('identity comparison requires all supported fields and rejects malformed inputs', () => {
  const candidate = fixture()
  const binary = join(candidate.root, 'native')
  try {
    writeFileSync(binary, 'api implementation')
    const identity = executionIdentity(binary)
    assert.equal(sameExecutionIdentity(identity, structuredClone(identity)), true)
    for (const value of [
      null,
      [],
      {},
      'identity',
      { ...identity, schema: 'unknown' },
      { ...identity, compiler: { ...identity.compiler, digest: 'short' } },
      { ...identity, runtime: { ...identity.runtime, name: 'node' } },
      { ...identity, checker: { ...identity.checker, version: '' } },
    ]) {
      assert.equal(validExecutionIdentity(value), false)
      assert.equal(sameExecutionIdentity(identity, value), false)
    }
  } finally {
    candidate.dispose()
  }
})
