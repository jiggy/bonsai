import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { readConfig } from '../src/project.ts'
import { resolveReportDestination, writeHtmlReport } from '../src/report/output.ts'
import { createProject } from './project.ts'

test('report destinations protect effective maintained paths and the temporary sibling scope', () => {
  const fixture = createProject({ 'bindings.ts': 'export const actions = {}\n' })
  try {
    const config = readConfig(fixture.root)
    const original = readFileSync(join(fixture.root, 'bindings.ts'))
    assert.throws(() => resolveReportDestination(fixture.root, config, 'bindings.ts'))
    assert.throws(() => resolveReportDestination(fixture.root, config, 'bonsai.json'))
    mkdirSync(join(fixture.root, 'reports'))
    config.maintained.push('reports')
    assert.throws(() => resolveReportDestination(fixture.root, config, 'reports/check.html'))
    config.exclude = ['reports/check.html']
    assert.throws(
      () => resolveReportDestination(fixture.root, config, 'reports/check.html'),
      'Excluding the final filename alone must not authorize temporary maintained files',
    )
    config.exclude = ['reports/**']
    assert.equal(
      resolveReportDestination(fixture.root, config, 'reports/check.html'),
      join(fixture.root, 'reports/check.html'),
    )
    assert.equal(
      resolveReportDestination(fixture.root, config, join(fixture.root, 'reports/check.html')),
      join(fixture.root, 'reports/check.html'),
    )
    assert.throws(() => resolveReportDestination(fixture.root, config, 'reports'))
    assert.deepEqual(readFileSync(join(fixture.root, 'bindings.ts')), original)
    assert.deepEqual(readdirSync(join(fixture.root, 'reports')), [])
  } finally {
    fixture.dispose()
  }
})

test('final and parent symlinks cannot redirect report output onto authored input', () => {
  const fixture = createProject({ 'bindings.ts': 'export const actions = {}\n' })
  try {
    const source = join(fixture.root, 'bindings.ts')
    const original = readFileSync(source)
    const finalAlias = join(fixture.root, 'report.html')
    const directoryAlias = join(fixture.root, 'linked')
    symlinkSync(source, finalAlias)
    symlinkSync(fixture.root, directoryAlias, 'dir')
    const config = readConfig(fixture.root)
    for (const path of ['report.html', 'linked/bindings.ts', 'linked/new-report.html'])
      assert.throws(() => resolveReportDestination(fixture.root, config, path))
    assert.deepEqual(readFileSync(source), original)
    assert.equal(lstatSync(finalAlias).isSymbolicLink(), true)
    assert.equal(lstatSync(directoryAlias).isSymbolicLink(), true)
  } finally {
    fixture.dispose()
  }
})

test('an atomic report replacement leaves no temporary file', async () => {
  const fixture = createProject({ 'bindings.ts': 'export const actions = {}\n' })
  try {
    const destination = join(fixture.root, 'report.html')
    writeFileSync(destination, '<!doctype html><title>Previous complete report</title>')
    const before = readdirSync(fixture.root).sort()
    const html = '<!doctype html><title>New complete report</title><p>Measured facts</p>'
    await writeHtmlReport(destination, html)
    assert.equal(readFileSync(destination, 'utf8'), html)
    assert.deepEqual(readdirSync(fixture.root).sort(), before)
  } finally {
    fixture.dispose()
  }
})

test('cancellation and deadline failure preserve the previous report after the temporary write', async () => {
  for (const mode of ['aborted', 'deadline', 'cancel-during-write'] as const) {
    const fixture = createProject({ 'bindings.ts': 'export const actions = {}\n' })
    try {
      const destination = join(fixture.root, 'report.html')
      const previous = '<!doctype html><title>Previous complete report</title>'
      writeFileSync(destination, previous)
      const before = readdirSync(fixture.root).sort()
      const controller = new AbortController()
      if (mode === 'aborted') controller.abort(new Error('Report request cancelled'))
      let observedTemporary = false
      const checkDeadline = () => {
        if (
          !readdirSync(fixture.root).some(
            (name) => !before.includes(name) && lstatSync(join(fixture.root, name)).size > 0,
          )
        )
          return
        observedTemporary = true
        if (mode === 'deadline') throw new Error('Command deadline expired during report write')
        if (mode === 'cancel-during-write') controller.abort(new Error('Report request cancelled'))
      }
      await assert.rejects(
        writeHtmlReport(destination, '<!doctype html><title>Replacement</title>', {
          signal: controller.signal,
          checkDeadline,
        }),
      )
      if (mode !== 'aborted') assert.equal(observedTemporary, true)
      assert.equal(readFileSync(destination, 'utf8'), previous)
      assert.deepEqual(readdirSync(fixture.root).sort(), before)
    } finally {
      fixture.dispose()
    }
  }
})

test('queued cancellation from final validation cannot publish over the previous complete report', async () => {
  const fixture = createProject({ 'bindings.ts': 'export const actions = {}\n' })
  try {
    const destination = join(fixture.root, 'report.html')
    const previous = '<!doctype html><title>Previous complete report</title>'
    writeFileSync(destination, previous)
    const before = readdirSync(fixture.root).sort()
    const controller = new AbortController()
    const reason = new Error('Cancelled before report publication')
    let validations = 0
    await assert.rejects(
      writeHtmlReport(destination, '<!doctype html><title>Replacement</title>', {
        signal: controller.signal,
        validatePath: () => {
          if (++validations === 4) queueMicrotask(() => controller.abort(reason))
        },
      }),
      (error) => error === reason,
    )
    assert.equal(validations, 4)
    assert.equal(readFileSync(destination, 'utf8'), previous)
    assert.deepEqual(readdirSync(fixture.root).sort(), before)
  } finally {
    fixture.dispose()
  }
})
