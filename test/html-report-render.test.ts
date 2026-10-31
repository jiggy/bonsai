import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Script } from 'node:vm'
import { evaluate } from '../src/policy.ts'
import { buildSnapshot } from '../src/retention.ts'
import { renderHtmlReport } from '../src/report/render.ts'
import type { Config } from '../src/model.ts'

function render(project = 'orders') {
  const config: Config = {
    maintained: ['bindings.ts'],
    bindings: 'bindings.ts',
    policy: {
      bootstrap: 100,
      bootstrapSurface: 1,
      perDoubling: 10,
      hardLimit: 200,
      maxFeedbackMs: 1500,
    },
  }
  const snapshot = buildSnapshot(
    'recorded-fingerprint',
    {
      pairs: [],
      checks: [],
      cases: [],
      problems: [],
    },
    {
      files: [{ file: 'bindings.ts', tokens: 20 }],
      components: [],
      relationships: [],
      actions: {},
      problems: [],
    },
  )
  const decision = evaluate(undefined, snapshot, config.policy)
  return {
    decision,
    html: renderHtmlReport(
      { decision, snapshot, timing: { elapsedMs: 15, stages: [] } },
      {
        config,
        root: '/project',
        project,
        configFile: '/project/bonsai.json',
        origin: { root: 'flag', base: 'default', policy: 'project' },
        generatedAt: '2026-10-31T12:00:00.000Z',
      },
    ),
  }
}

const scripts = (html: string) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]

test('standalone report embeds its evaluated facts and every runtime asset', () => {
  const { html, decision } = render()
  const blocks = scripts(html)
  assert.equal(blocks.length, 3, 'Data, license, and one executable controller are embedded')
  const data = blocks.find((match) => /id="bonsai-report-data"/.test(match[1]!))!
  assert.match(data[1]!, /type="application\/json"/)
  assert.deepEqual(JSON.parse(data[2]!).decision, decision)
  assert.equal(JSON.parse(data[2]!).fingerprint, 'recorded-fingerprint')
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i)
  assert.doesNotMatch(html, /<link\b[^>]*\brel=["'](?:stylesheet|preload)/i)
  assert.doesNotMatch(html, /BONSAI_REPORT_(?:STYLE|DATA|CLIENT|FAVICON)/)
  assert.match(html, /href="data:image\/svg\+xml;base64,/)
  const style = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)![1]!
  const fonts = [...style.matchAll(/data:font\/woff2;base64,([A-Za-z0-9+/=]+)/g)]
  assert.equal(fonts.length, 3)
  for (const font of fonts)
    assert.equal(Buffer.from(font[1]!, 'base64').subarray(0, 4).toString(), 'wOF2')
  for (const url of style.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)) assert.match(url[1]!, /^data:/)
  const controller = blocks.find((match) => /id="bonsai-report-client"/.test(match[1]!))![2]!
  assert.doesNotThrow(
    () => new Script(controller),
    'Serialized TypeScript becomes valid browser JavaScript',
  )
})

test('candidate text cannot close the private data script or inject markup into the title', () => {
  const project = '</title><script id="injected">alert(1)</script>& "quoted"'
  const { html } = render(project)
  assert.equal(scripts(html).length, 3)
  assert.doesNotMatch(html, /<script id="injected">/)
  assert.match(html, /<title>&lt;\/title&gt;&lt;script/)
  const data = scripts(html).find((match) => /id="bonsai-report-data"/.test(match[1]!))![2]!
  assert.doesNotMatch(data, /</)
  assert.equal(
    JSON.parse(data).project,
    project,
    'Escaping preserves the exact original source text',
  )
})
