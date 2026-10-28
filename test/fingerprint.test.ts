import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fingerprint, inventory } from '../src/inventory.ts'
import { readConfig } from '../src/project.ts'
import { createProject } from './project.ts'

test('excluded dependency lockfiles still bind evidence identity, including presence and removal', () => {
  const fixture = createProject({ 'bindings.ts': 'export const actions = {}' })
  try {
    const config = readConfig(fixture.root)
    const files = inventory(fixture.root, config.maintained)
    const hash = () => fingerprint(fixture.root, files, config)
    const baseline = hash()
    for (const name of [
      'bun.lock',
      'bun.lockb',
      'package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'pnpm-lock.yaml',
    ]) {
      writeFileSync(join(fixture.root, name), 'first')
      const added = hash()
      assert.notEqual(added, baseline, name)
      writeFileSync(join(fixture.root, name), 'other')
      assert.notEqual(hash(), added, name)
      unlinkSync(join(fixture.root, name))
      assert.equal(hash(), baseline, name)
    }
  } finally {
    fixture.dispose()
  }
})

test('lockfile identity never follows symlinks or accepts non-file inputs', () => {
  const fixture = createProject({ 'bindings.ts': 'export const actions = {}' })
  try {
    const config = readConfig(fixture.root)
    const files = inventory(fixture.root, config.maintained)
    const lock = join(fixture.root, 'bun.lock')
    mkdirSync(lock)
    assert.throws(() => fingerprint(fixture.root, files, config), /Lockfile must be a regular file/)
    rmdirSync(lock)
    symlinkSync(join(fixture.root, 'bindings.ts'), lock)
    assert.throws(() => fingerprint(fixture.root, files, config), /Lockfile must be a regular file/)
  } finally {
    fixture.dispose()
  }
})
