// The real controller runs against a deliberately limited DOM stand-in.
// These are logic checks, not browser rendering, layout, or accessibility tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { reportClient } from '../src/report/client.ts'
import { buildReportData } from '../src/report/model.ts'
import { buildSnapshot } from '../src/retention.ts'
import { evaluate } from '../src/policy.ts'
import type { Config, Source } from '../src/model.ts'
import type { ReportData } from '../src/report/model.ts'

const template = readFileSync(new URL('../src/report/template.html', import.meta.url), 'utf8')
const attributes = (markup: string): Record<string, string> =>
  Object.fromEntries(
    [...markup.matchAll(/(?:\s|^)([\w:-]+)(?:="([^"]*)")?(?=\s|>|$)/g)].map((m) => [
      m[1]!,
      m[2] ?? '',
    ]),
  )
const plain = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const copyable = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(amp|lt|gt|quot|#39);/g,
      (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!,
    )

function fixture(empty = false): ReportData {
  const source: Source = {
    files: empty
      ? []
      : [
          { file: 'src/nested/orders.ts', tokens: 1000 },
          { file: 'src/shared.ts', tokens: 200 },
          { file: 'src/tiny.ts', tokens: 100 },
          { file: 'src/wholly-unlinked.ts', tokens: 900 },
          { file: 'features/orders.feature', tokens: 50 },
          { file: 'features/cancel.feature', tokens: 50 },
          { file: 'features/draft.feature', tokens: 1 },
          { file: 'bindings.ts', tokens: 40 },
          { file: 'README.md', tokens: 10 },
        ],
    components: empty
      ? []
      : [
          {
            id: 'order',
            file: 'src/nested/orders.ts',
            name: 'placeOrder',
            line: 1,
            tokens: 10,
            kind: 'production',
          },
          {
            id: 'quantity',
            file: 'src/nested/orders.ts',
            name: 'orderQuantity',
            line: 3,
            tokens: 5,
            kind: 'production',
          },
          {
            id: 'cancel',
            file: 'src/nested/orders.ts',
            name: 'cancelOrder',
            line: 5,
            tokens: 12,
            kind: 'production',
          },
          {
            id: 'legacy',
            file: 'src/nested/orders.ts',
            name: 'legacyPromotion',
            line: 7,
            tokens: 900,
            kind: 'production',
          },
          {
            id: 'shared',
            file: 'src/shared.ts',
            name: 'money',
            line: 1,
            tokens: 20,
            kind: 'production',
          },
          {
            id: 'tiny',
            file: 'src/tiny.ts',
            name: 'round',
            line: 1,
            tokens: 10,
            kind: 'production',
          },
          {
            id: 'dead',
            file: 'src/wholly-unlinked.ts',
            name: 'oldSearch',
            line: 1,
            tokens: 800,
            kind: 'production',
          },
        ],
    relationships: empty
      ? []
      : [
          ['order', 'shared'],
          ['order', 'tiny'],
          ['cancel', 'shared'],
          ['cancel', 'tiny'],
          ['cancel', 'quantity'],
        ].map(([from, to]) => ({
          from: from!,
          to: to!,
          kind: 'reference',
          origin: 'static',
          sourceRef: { file: 'src/nested/orders.ts', line: 1 },
        })),
    actions: empty
      ? {}
      : { 'place-order': 'order', 'order-quantity': 'quantity', 'cancel-order': 'cancel' },
    problems: [],
  }
  const checks = empty
    ? []
    : [
        {
          id: 'order-status',
          action: 'place-order',
          selector: 'status',
          expected: 'accepted',
          file: 'features/orders.feature',
          line: 3,
        },
        {
          id: 'order-quantity',
          action: 'order-quantity',
          selector: 'quantity',
          expected: 1,
          file: 'features/orders.feature',
          line: 5,
        },
        {
          id: 'cancel-status',
          action: 'cancel-order',
          selector: 'status',
          expected: 'cancelled',
          file: 'features/cancel.feature',
          line: 3,
        },
      ]
  const snapshot = buildSnapshot(
    'same-invocation',
    { pairs: checks.map((c) => c.action + '/' + c.selector), checks, cases: [], problems: [] },
    source,
  )
  snapshot.analysis = {
    engine: 'rust',
    backend: 'tsrs',
    status: 'complete',
    validation: 'native-diagnostics',
    version: 'fixture',
  }
  const config: Config = {
    maintained: ['src', 'features', 'bindings.ts', 'README.md'],
    bindings: 'bindings.ts',
    policy: {
      bootstrap: 100,
      bootstrapSurface: 1,
      perDoubling: 10,
      hardLimit: 200,
      maxFeedbackMs: 1500,
    },
  }
  return buildReportData(
    {
      snapshot,
      decision: evaluate(undefined, snapshot, config.policy),
      timing: { elapsedMs: 15, stages: [] },
    },
    {
      config,
      root: '/project',
      configFile: '/project/bonsai.json',
      project: 'orders',
      origin: { root: 'flag', base: 'default', policy: 'project' },
      generatedAt: '2026-10-31T12:00:00.000Z',
    },
  )
}

function harness(data: ReportData) {
  const nodes = new Map<string, Node>()
  const events = new Map<string, (event: any) => void>()
  const sections = new Map<string, string>()
  let focused: Node | undefined
  const currentSection = (id: string) =>
    id === 'file-inspector' || id === 'file-workspace'
      ? nodes.get('file-workspace')?.parentElement?.section
      : sections.get(id)
  const controls = (markup: string, owner: string) =>
    [...markup.matchAll(/<(?:button|g)\b[^>]*>/g)].map(
      (m) => new Node(owner + '/control', attributes(m[0]), currentSection(owner)),
    )
  class Node {
    innerHTML = ''
    textContent = ''
    value = ''
    open = false
    hidden = false
    disabled = false
    tabIndex = 0
    clientWidth = 720
    clientHeight = 370
    children: Node[] = []
    parentElement?: Node
    isSection = false
    isNav = false
    listeners = new Map<string, (event: any) => void>()
    dataset: Record<string, string>
    classList: {
      toggle: (name: string, force?: boolean) => void
      contains: (name: string) => boolean
    }
    constructor(
      readonly id: string,
      readonly attrs: Record<string, string> = {},
      readonly section?: string,
    ) {
      this.dataset = Object.fromEntries(
        Object.entries(attrs)
          .filter(([key]) => key.startsWith('data-'))
          .map(([key, value]) => [
            key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
            value,
          ]),
      )
      this.classList = {
        toggle: (name, force) => {
          const classes = new Set((this.attrs.class ?? '').split(/\s+/).filter(Boolean))
          const add = force ?? !classes.has(name)
          if (add) classes.add(name)
          else classes.delete(name)
          this.attrs.class = [...classes].join(' ')
        },
        contains: (name) => (this.attrs.class ?? '').split(/\s+/).includes(name),
      }
    }
    setAttribute(key: string, value: string) {
      this.attrs[key] = String(value)
    }
    getAttribute(key: string) {
      return this.attrs[key]
    }
    hasAttribute(key: string) {
      return key in this.attrs
    }
    addEventListener(name: string, handler: (event: any) => void) {
      this.listeners.set(name, handler)
    }
    appendChild(child: Node) {
      if (child.parentElement)
        child.parentElement.children = child.parentElement.children.filter((n) => n !== child)
      this.children.push(child)
      child.parentElement = this
      return child
    }
    scrollIntoView() {}
    focus() {
      focused = this
    }
    click() {
      events.get('click')!({ target: this })
    }
    matches(selector: string) {
      assert.equal(selector, '[role="button"]')
      return this.attrs.role === 'button'
    }
    closest(selector: string): Node | null {
      if (selector === 'nav a') return this.isNav ? this : null
      if (selector === 'button,[role="button"]') return this.isNav ? null : this
      assert.equal(selector, 'section')
      return this.section ? nodes.get(this.section)! : null
    }
    querySelector(selector: string): Node | null {
      if (selector === 'h3') return this.innerHTML.includes('<h3') ? new Node('heading') : null
      assert.equal(selector, '[data-workspace-observation]')
      const match = this.innerHTML.match(
        /<select\b[^>]*data-workspace-observation[^>]*>([\s\S]*?)<\/select>/,
      )
      if (!match) return null
      const select = new Node('observation', { 'data-workspace-observation': '' })
      select.innerHTML = match[1]!
      select.value =
        [...match[1]!.matchAll(/<option\b[^>]*>/g)]
          .map((m) => attributes(m[0]))
          .find((a) => 'selected' in a)?.value ?? ''
      return select
    }
    querySelectorAll(selector: string) {
      let markup = this.innerHTML
      if (this.isSection)
        markup += [...nodes.values()]
          .filter((n) => currentSection(n.id) === this.id)
          .map((n) => n.innerHTML)
          .join('')
      const items = controls(markup, this.id)
      if (selector === 'button') return items.filter((n) => n.attrs.role !== 'button')
      assert.equal(selector, '[data-file],[data-unrooted-file]')
      return items.filter(
        (n) => n.hasAttribute('data-file') || n.hasAttribute('data-unrooted-file'),
      )
    }
  }
  for (const match of template.matchAll(
    /<section\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g,
  )) {
    sections.set(match[1]!, match[1]!)
    for (const id of match[2]!.matchAll(/\bid="([^"]+)"/g)) sections.set(id[1]!, match[1]!)
  }
  for (const match of template.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const node = new Node(match[3]!, attributes(match[2]!), sections.get(match[3]!))
    node.isSection = match[1] === 'section'
    nodes.set(node.id, node)
  }
  const get = (id: string) => {
    assert(nodes.has(id), 'Absent template element: ' + id)
    return nodes.get(id)!
  }
  get('files-workspace-slot').appendChild(get('file-workspace'))
  const banner = new Node('banner'),
    blockers = new Node('blockers')
  const nav = [...template.matchAll(/<a\b[^>]*href="#[^"]+"[^>]*>/g)].map((m) => {
    const node = new Node('nav', attributes(m[0]))
    node.isNav = true
    return node
  })
  const staticControls = controls(template, 'document')
  const document = {
    documentElement: { cloneNode: () => ({ outerHTML: template }) },
    getElementById: get,
    addEventListener: (name: string, handler: (event: any) => void) => events.set(name, handler),
    querySelector: (selector: string) => {
      if (selector === '.verdict-banner') return banner
      assert.equal(selector, '.blocker-details')
      return blockers
    },
    querySelectorAll: (selector: string) => {
      if (selector === 'nav a') return nav
      assert(['[data-feature-sort]', '[data-inventory-view]'].includes(selector), selector)
      return staticControls.filter((node) => node.hasAttribute(selector.slice(1, -1)))
    },
  }
  runInNewContext(`(${reportClient.toString()})(data)`, { document, data })
  const control = (id: string, key: string, value = '') => {
    const node = controls(get(id).innerHTML, id).find((n) => n.attrs[key] === value)
    assert(node, `${id} lacks ${key}=${value}`)
    return node
  }
  return {
    get,
    control,
    text: (id: string) => plain(get(id).innerHTML || get(id).textContent),
    choose: (id: string, key: string, value = '') => control(id, key, value).click(),
    change: (id: string, value: string) => {
      const node = get(id)
      node.value = value
      node.listeners.get('change')!({ target: node })
    },
    focused: () => focused,
  }
}

test('empty and zero-cost facts remain explicit without invalid numeric chart geometry', () => {
  for (const zero of [false, true]) {
    const data = fixture(!zero)
    if (zero) {
      for (const file of data.files) file.tokens = 0
      for (const component of data.components) component.tokens = 0
      data.decision.retained = 0
    }
    const ui = harness(data)
    assert.match(ui.text('retained-number'), /0 tokens/)
    for (const id of [
      'inventory-map',
      'inventory-summary',
      'inventory-rows',
      'feature-scatter',
      'file-rows',
    ])
      assert.doesNotMatch(ui.get(id).innerHTML, /NaN|Infinity/, id)
    if (!zero) assert.match(ui.text('file-inspector'), /No indexed files/)
  }
})

test('mixed files retain full costs, local exact-observation choices, and nested origin context', () => {
  const data = fixture(),
    ui = harness(data)
  assert.equal(ui.get('file-workspace').open, false)
  ui.choose('file-rows', 'data-file', 'src/nested/orders.ts')
  assert.match(ui.text('file-inspector'), /1,000 full retained tokens/)
  assert.match(ui.text('file-inspector'), /3 linked components · 1 without links/)
  ui.choose('file-inspector', 'data-workspace-scope', 'spec:features/orders.feature')
  ui.choose('file-inspector', 'data-workspace-declaration', 'order')
  const picker = ui.get('file-inspector').querySelector('[data-workspace-observation]')!
  assert.match(picker.innerHTML, /value="order-status"/)
  assert.doesNotMatch(picker.innerHTML, /value="order-quantity"|value="cancel-status"/)
  assert.match(
    ui.get('file-inspector').innerHTML,
    /data-workspace-scope="spec:features\/orders.feature" aria-pressed="true"/,
  )
  ui.choose('inventory-map', 'data-inventory-path', 'src')
  ui.choose('inventory-map', 'data-inventory-path', 'src/nested')
  ui.choose('inventory-map', 'data-file', 'src/nested/orders.ts')
  assert.equal(ui.get('file-workspace').parentElement!.id, 'inventory-workspace-slot')
  ui.choose('file-inspector', 'data-workspace-return')
  assert.equal(ui.get('file-workspace').open, false)
  assert.match(ui.text('inventory-breadcrumb'), /All files \/ src \/ nested/)
  assert.match(ui.text('inventory-view-total'), /Global retained cost stays 2,351/)
})

test('gap rankings include mixed files and sort by token amount or lowest linked share', () => {
  const ui = harness(fixture())
  const rows = () => [
    ...ui
      .get('unrooted-ranking')
      .innerHTML.matchAll(/<button\b[^>]*data-unrooted-file="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g),
  ]
  assert.equal(rows()[0]![1], 'src/nested/orders.ts')
  assert.match(plain(rows()[0]![2]!), /Linked 27 \(2\.9%\) · Without links 900 \(97\.1%\)/)
  assert.match(plain(rows()[0]![2]!), /927 component tokens · 1,000 full file tokens/)
  ui.change('unrooted-sort', 'share')
  assert.equal(rows()[0]![1], 'src/wholly-unlinked.ts')
  assert.equal(rows()[1]![1], 'src/nested/orders.ts')
  ui.change('file-filter', 'no-components')
  assert.match(ui.text('file-rows'), /README\.md/)
  assert.doesNotMatch(ui.get('file-rows').innerHTML, /data-file="src\/nested\/orders.ts"/)
})

test('nearby specification footprints keep separate selections and exact source positions', () => {
  const ui = harness(fixture())
  const plot = ui.get('feature-scatter').innerHTML
  assert.doesNotMatch(plot, /feature-map-cluster|data-cluster-members/)
  const points = [...plot.matchAll(/<g\b[^>]*data-feature="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)]
  assert.deepEqual(
    points.map((m) => m[1]),
    ['features/orders.feature', 'features/cancel.feature'],
  )
  const measurements = points.map((m) =>
    attributes(m[2]!.match(/<circle\b[^>]*data-feature-location[^>]*>/)![0]),
  )
  assert.deepEqual(
    measurements.map((m) => Number(m['data-tokens'])),
    [45, 47],
  )
  assert(measurements.every((m) => m['data-files'] === '3'))
  assert(Number(measurements[0]!.cx) < Number(measurements[1]!.cx))
  assert.equal(measurements[0]!.cy, measurements[1]!.cy)
  const labels = points.map((m) =>
    attributes(m[2]!.match(/<circle\b[^>]*data-feature-label[^>]*>/)![0]),
  )
  assert(
    Math.abs(Number(labels[1]!.cx) - Number(labels[0]!.cx)) >= 26,
    'Numbered labels do not overlap even near the left boundary',
  )
  for (const point of points) assert.match(point[2]!, /feature-point-leader/)
  ui.choose('feature-scatter', 'data-feature', 'features/cancel.feature')
  assert.match(ui.text('feature-inspector'), /cancel\.feature/)
  assert.equal(
    ui.control('feature-map-key', 'data-feature', 'features/cancel.feature').attrs['aria-pressed'],
    'true',
  )
  ui.choose('feature-map-key', 'data-feature', 'features/orders.feature')
  assert.equal(
    ui.control('feature-scatter', 'data-feature', 'features/orders.feature').attrs['aria-pressed'],
    'true',
  )
})

test('syntax highlighting preserves copyable configuration text while keeping candidate markup inert', () => {
  const data = fixture()
  data.config.exclude = ['</span><img src=x onerror=alert(1)> & "quoted" &lt;kept&gt;']
  const ui = harness(data)
  const html = ui.get('config-code').innerHTML
  assert.match(html, /syntax-key/)
  assert.match(html, /syntax-number/)
  assert.doesNotMatch(html, /<img|<script/i)
  assert.deepEqual(JSON.parse(copyable(html)).exclude, data.config.exclude)
  assert.match(ui.get('policy-formula').innerHTML, /syntax-function/)
  assert.match(copyable(ui.get('policy-formula').innerHTML), /ceiling = floor\(min\(hardLimit,/)
})

test('an explanatory route revisits a type-only subject through a later runtime path', () => {
  const data = fixture()
  const source: Source = {
    files: [
      { file: 'source.ts', tokens: 100 },
      { file: 'features/start.feature', tokens: 10 },
    ],
    components: ['entry', 'helper', 'runtime', 'startup'].map((id, index) => ({
      id,
      file: 'source.ts',
      name: id,
      line: index + 1,
      tokens: id === 'startup' ? 0 : 10,
      kind: 'production',
    })),
    actions: { start: 'entry' },
    problems: [],
    relationships: [
      {
        from: 'entry',
        to: 'helper',
        kind: 'reference',
        runtime: false,
        origin: 'static',
        sourceRef: { file: 'source.ts', line: 1 },
      },
      {
        from: 'entry',
        to: 'runtime',
        kind: 'reference',
        origin: 'static',
        sourceRef: { file: 'source.ts', line: 1 },
      },
      {
        from: 'runtime',
        to: 'helper',
        kind: 'reference',
        origin: 'static',
        sourceRef: { file: 'source.ts', line: 3 },
      },
      {
        from: 'helper',
        to: 'startup',
        kind: 'module-initialization',
        origin: 'static',
        sourceRef: { file: 'source.ts', line: 2 },
      },
    ],
  }
  const snapshot = buildSnapshot(
    data.fingerprint,
    {
      pairs: ['start/status'],
      cases: [],
      problems: [],
      checks: [
        {
          id: 'startup-check',
          file: 'features/start.feature',
          line: 3,
          action: 'start',
          selector: 'status',
          expected: 'ready',
        },
      ],
    },
    source,
  )
  snapshot.analysis = data.analysis
  const projected = buildReportData(
    { snapshot, decision: evaluate(undefined, snapshot, data.config.policy), timing: data.timing },
    {
      config: data.config,
      root: data.provenance.root,
      configFile: data.provenance.configFile,
      origin: data.provenance.origin,
      project: data.project,
      generatedAt: data.generatedAt,
    },
  )
  const ui = harness(projected)
  ui.choose('file-rows', 'data-file', 'source.ts')
  ui.choose('file-inspector', 'data-workspace-declaration', 'startup')
  const route = ui
    .get('file-inspector')
    .innerHTML.match(/<ol class="relation-path">([\s\S]*?)<\/ol>/)?.[1]
  assert(route, 'The eligible runtime path explains the exact recorded ancestry')
  const names = [...route.matchAll(/<strong>([^<]+)<\/strong>/g)].map((m) => m[1])
  assert.deepEqual(names, ['entry', 'runtime', 'helper', 'startup'])
})
