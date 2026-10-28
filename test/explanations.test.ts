import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Component, Contracts, Source } from '../src/model.ts'
import { buildSnapshot, explain } from '../src/retention.ts'

function fixture() {
  const components = [
    ['handler', 'production'],
    ['middle', 'production'],
    ['subject', 'production'],
    ['dead', 'production'],
    ['registry', 'binding'],
    ['test', 'test'],
    ['helper', 'test'],
    ['assertion', 'test'],
    ['unrelated', 'test'],
  ].map(([id, kind]) => ({
    id: id!,
    name: id!,
    file: id! + '.ts',
    line: 1,
    tokens: 1,
    kind: kind as Component['kind'],
  }))
  const source: Source = {
    files: [],
    components,
    actions: { order: 'handler', unused: 'dead' },
    registry: 'registry',
    problems: [],
    relationships: [
      ['handler', 'middle'],
      ['middle', 'subject'],
      ['subject', 'middle'],
      ['registry', 'handler'],
      ['registry', 'dead'],
      ['test', 'helper'],
      ['helper', 'subject'],
      ['test', 'assertion'],
      ['unrelated', 'assertion'],
      ['unrelated', 'dead'],
    ].map(([from, to]) => ({
      from: from!,
      to: to!,
      kind: 'reference',
      origin: 'static',
      sourceRef: { file: from! + '.ts', line: 1 },
    })),
  }
  const contracts: Contracts = {
    pairs: ['order/status'],
    cases: [],
    problems: [],
    checks: ['first', 'second'].map((id) => ({
      id,
      action: 'order',
      selector: 'status',
      expected: 'ok',
      file: 'orders.feature',
      line: 3,
    })),
  }
  return buildSnapshot('candidate', contracts, source)
}

test('explanations trace each obligation through real production references without looping', () => {
  const [component] = explain(fixture(), 'subject')
  assert.deepEqual(component!.contractPaths, [
    { check: 'first', components: ['handler', 'middle', 'subject'] },
    { check: 'second', components: ['handler', 'middle', 'subject'] },
  ])
  assert.deepEqual(component!.verificationSubjects, [])
})

test('explanations distinguish subject references from inherited test support', () => {
  const [component] = explain(fixture(), 'assertion')
  assert.deepEqual(component!.verificationSubjects, [
    {
      subject: 'subject',
      test: 'test',
      references: ['test', 'helper', 'subject'],
      support: ['test', 'assertion'],
    },
  ])
  assert.deepEqual(component!.contractPaths, [
    { check: 'first', components: ['handler', 'middle', 'subject'], subject: 'subject' },
    { check: 'second', components: ['handler', 'middle', 'subject'], subject: 'subject' },
  ])
})

test('explanation paths do not justify unrelated tests, dead production or registry siblings', () => {
  const snapshot = fixture()
  for (const target of ['unrelated', 'dead']) {
    const [component] = explain(snapshot, target)
    assert.deepEqual(component!.contractPaths, [])
    assert.deepEqual(component!.verificationSubjects, [])
    assert.deepEqual(component!.contracts, [])
  }
  const [registry] = explain(snapshot, 'registry')
  assert.deepEqual(registry!.contractPaths, [
    { check: 'first', components: ['registry'], registry: true },
    { check: 'second', components: ['registry'], registry: true },
  ])
  assert.deepEqual(explain(snapshot, 'absent'), [])
})
