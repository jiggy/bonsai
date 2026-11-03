import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSnapshot } from '../src/retention.ts'
import type { Component, Contracts, Relationship, Source } from '../src/model.ts'

test('retention keeps observation membership separate from runtime and production traversal states', () => {
  const component = (name: string, kind: Component['kind'] = 'production'): Component => ({
    id: name, name, kind, file: `${kind}.ts`, line: 1, tokens: 1,
  })
  const edge = (
    from: string, to: string, kind: Relationship['kind'] = 'reference', runtime = true,
  ): Relationship => ({
    from, to, kind, origin: 'static', sourceRef: { file: 'production.ts', line: 1 },
    ...(runtime ? {} : { runtime: false }),
  })
  const contracts: Contracts = {
    checks: [
      { id: 'a1', action: 'active', selector: 'first' },
      { id: 'a2', action: 'active', selector: 'second' },
      { id: 'b1', action: 'typed', selector: 'first' },
    ].map((check, index) => ({ ...check, file: 'probe.feature', line: index + 1, expected: true })),
    pairs: ['active:first', 'active:second', 'typed:first'], cases: [], problems: [],
  }
  const source: Source = {
    files: ['production', 'binding', 'test'].map((kind) => ({ file: `${kind}.ts`, tokens: 5 })),
    components: [
      ...['active', 'typed', 'live', 'typeAction', 'unused', 'child', 'childInit', 'typeStartup', 'startup'].map((name) => component(name)),
      component('metadata', 'binding'), component('actions', 'binding'),
      component('supportA', 'test'), component('supportB', 'test'), component('helper', 'test'),
    ],
    relationships: [
      edge('active', 'live'), edge('active', 'typed', 'reference', false),
      edge('active', 'supportB'), edge('active', 'supportA', 'reference', false),
      edge('live', 'metadata'), edge('typed', 'metadata'),
      edge('supportA', 'metadata'), edge('supportB', 'metadata'),
      edge('metadata', 'child', 'entry-point'), edge('metadata', 'childInit', 'module-initialization'),
      edge('typed', 'typeStartup', 'module-initialization'),
      edge('typeAction', 'typed', 'reference', false), edge('typeAction', 'supportB'),
      edge('actions', 'startup', 'module-initialization'), edge('actions', 'unused'),
      edge('supportA', 'helper'), edge('helper', 'unused'), edge('helper', 'typeAction'),
      edge('helper', 'live'), edge('helper', 'supportA'), edge('helper', 'active'),
    ],
    actions: { active: 'active', typed: 'typeAction' }, registry: 'actions', problems: [],
  }
  const before = buildSnapshot('first', contracts, source)
  for (const name of ['active', 'live', 'child', 'childInit'])
    assert.deepEqual(before.ancestry[name], ['a1', 'a2'], name)
  assert.deepEqual(before.ancestry.typeAction, ['b1'])
  for (const name of ['typed', 'metadata', 'actions', 'startup', 'supportA', 'supportB', 'helper'])
    assert.deepEqual(before.ancestry[name], ['a1', 'a2', 'b1'], name)
  assert.deepEqual(before.unrooted, ['unused', 'typeStartup'])
  assert.equal(before.contracts.checks.length, 3)

  // A new snapshot must use the changed runtime path, even with identical IDs.
  const launch = source.relationships[0]!
  launch.runtime = false
  const changed = buildSnapshot('changed', contracts, source)
  assert.equal(changed.ancestry.child, undefined)
  assert.equal(changed.ancestry.childInit, undefined)
  assert.deepEqual(changed.ancestry.metadata, ['a1', 'a2', 'b1'])
  delete launch.runtime
  assert.deepEqual(buildSnapshot('restored', contracts, source).ancestry, before.ancestry)
})
