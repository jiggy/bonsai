// Explicit CI-only browser QA. Ordinary tests and the published package do not
// install Playwright or Chromium. The CI job supplies an isolated pinned tool.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runCli } from './cli.ts'

const tools = process.env.BONSAI_BROWSER_TOOLING
const artifacts = process.env.BONSAI_BROWSER_ARTIFACTS
assert(tools && artifacts, 'Run the report-browser CI job with isolated browser tooling and artifact paths')
mkdirSync(artifacts, { recursive: true })
const require = createRequire(resolve(tools, 'package.json'))
const playwright = require('playwright')
const chromium = playwright.chromium
const tooling = require('playwright/package.json') as { version: string }
assert.equal(tooling.version, '1.64.1', 'Use the same pinned package and Chromium installation as CI')
const root = mkdtempSync(join(tmpdir(), 'bonsai-report-browser-'))
const failures: string[] = []
const blockedNetwork: string[] = []
const checkpoints: string[] = []
const previews: string[] = []
let previewBytes = 0
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
let page: Awaited<ReturnType<typeof chromium.launch>> | undefined
let successful = false

function write(path: string, text: string) {
  const absolute = join(root, path)
  mkdirSync(resolve(absolute, '..'), { recursive: true })
  writeFileSync(absolute, text)
}

function generate(name: string, expectedStatus: number) {
  const result = runCli(['check', '--root', root, '--json', '--report', '.bonsai/' + name + '.html'], { timeout: 45000 })
  assert.equal(result.error, undefined, String(result.error))
  assert.equal(result.signal, null, result.stderr)
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout)
  assert.equal(result.stderr, '', result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.snapshot.analysis.status, 'complete', JSON.stringify(report.snapshot.source.problems))
  const html = readFileSync(join(root, '.bonsai', name + '.html'), 'utf8')
  writeFileSync(join(artifacts!, name + '.html'), html)
  writeFileSync(join(artifacts!, name + '.json'), result.stdout)
  return html
}

async function openDetails(selector: string) {
  if (await page.locator(selector).getAttribute('open') === null)
    await page.locator(selector + ' > summary').click()
}

async function load(html: string) {
  await page.setContent(html, { waitUntil: 'load' })
  await page.locator('#file-rows button').first().waitFor({ state: 'attached' })
  await page.evaluate(async () => { await document.fonts.ready })
}

async function screenshot(name: string) {
  await page.screenshot({ path: join(artifacts!, name + '.png'), animations: 'disabled' })
  if (process.env.BONSAI_BROWSER_PREVIEWS === '1' && ['desktop-overview', 'mobile-overview'].includes(name)) {
    const image = await page.screenshot({ type: 'jpeg', quality: 45, fullPage: false, animations: 'disabled' })
    const line = `BONSAI_REPORT_PREVIEW:${name}:${Buffer.from(image).toString('base64')}`
    const size = Buffer.byteLength(line + '\n')
    if (previewBytes + size <= 200000) {
      console.log(line)
      previewBytes += size
      previews.push(name)
    } else console.log(`BONSAI_REPORT_PREVIEW_LIMIT:${name}`)
  }
}

async function assertFocus(selector: string) {
  assert.equal(await page.locator(selector).evaluate((element: HTMLElement) => element === document.activeElement), true, selector + ' should receive focus')
}

try {
  mkdirSync(join(root, '.bonsai'))
  mkdirSync(join(root, 'empty'))
  const audit = `import { appendFileSync } from 'node:fs'
export function record(name: string) { appendFileSync(new URL('../.bonsai/calls', import.meta.url), name + '\\n') }
`
  write('src/audit.ts', audit)
  write('src/money.ts', 'export function money(value: number) { return value * 100 }\n')
  write('src/checkout.ts', `import { money } from './money.ts'
import { record } from './audit.ts'
export function placeOrder() { record('order'); return { status: 'accepted', total: money(5) } }
export function legacyCheckout() { return 'retired checkout responsibility' }
`)
  write('src/refunds.ts', `import { money } from './money.ts'
import { record } from './audit.ts'
export function refundOrder() { record('refund'); return { status: 'refunded', total: money(2) } }
`)
  write('src/receipts.ts', `import { record } from './audit.ts'
export function sendReceipt() { record('receipt'); return { status: 'sent' } }
`)
  write('test/order.test.ts', "import { placeOrder } from '../src/checkout.ts'\nexport function orderSubject() { return placeOrder() }\n")
  write('bindings.ts', `import { placeOrder, legacyCheckout } from './src/checkout.ts'
import { refundOrder } from './src/refunds.ts'
import { sendReceipt } from './src/receipts.ts'
export const actions = { 'order.place': placeOrder, 'order.refund': refundOrder, 'receipt.send': sendReceipt, 'checkout.legacy': legacyCheckout }
`)
  write('features/order.feature', 'Feature: Place an order\nScenario: Accept the order\n When I invoke "order.place" with {}\n Then response "status" equals "accepted"\n And response "total" equals 500\n')
  write('features/refunds.feature', 'Feature: Refund an order\nScenario: Refund the order\n When I invoke "order.refund" with {}\n Then response "total" equals 200\n')
  write('features/receipts.feature', 'Feature: Deliver a receipt\nScenario: Send the receipt\n When I invoke "receipt.send" with {}\n Then response "status" equals "sent"\n')
  write('README.md', '# Browser QA consumer\nThe generated report must retain this measured document.\n')
  write('bonsai.json', JSON.stringify({ maintained: ['src', 'src/money.ts', 'test', 'features', 'bindings.ts', 'README.md', 'bonsai.json', 'empty'], exclude: ['.bonsai'], bindings: 'bindings.ts', policy: { bootstrap: 10000, bootstrapSurface: 1, perDoubling: 0, hardLimit: 10000, maxFeedbackMs: 15000 } }))
  const rejected = generate('rejected', 1)
  assert.deepEqual(readFileSync(join(root, '.bonsai/calls'), 'utf8').trim().split('\n').sort(), ['order', 'receipt', 'refund'], 'Producing HTML must not replay application handlers')
  write('features/subscriptions.feature', 'Feature: Start subscriptions\nScenario: Start a subscription\n When I invoke "subscription.start" with {}\n Then response "status" equals "active"\n')
  const incomplete = generate('incomplete', 2)
  browser = await chromium.launch({ headless: true, timeout: 30000 })
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 })
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error: Error) => failures.push(error.message))
  page.on('console', (message: { type(): string; text(): string }) => { if (message.type() === 'error') failures.push(message.text()) })
  await page.route('**/*', async (route: { request(): { url(): string }; abort(): Promise<void>; continue(): Promise<void> }) => {
    const url = route.request().url()
    if (/^https?:/i.test(url)) { blockedNetwork.push(url); await route.abort() }
    else await route.continue()
  })
  await load(rejected)
  assert.equal(await page.locator('#verdict-label').innerText(), 'Rejected')
  await screenshot('desktop-overview')
  const point = page.locator('#file-scatter [data-file="src/checkout.ts"]')
  await point.focus()
  await page.keyboard.press('Enter')
  await assertFocus('#file-inspector h3')
  assert.equal(await page.locator('#file-inspector h3').innerText(), 'src/checkout.ts')
  await page.locator('[data-workspace-scope="unlinked"]').click()
  assert.match(await page.locator('#file-inspector').innerText(), /legacyCheckout/)
  await screenshot('desktop-file-workspace')
  await page.locator('[data-workspace-return]').click()
  await assertFocus('#file-scatter [data-file="src/checkout.ts"]')
  checkpoints.push('keyboard file inspection, mixed component scope and return focus')

  await page.locator('nav[aria-label="Report sections"] a[href="#features"]').click()
  await page.locator('[data-feature-sort="light"]').click()
  assert.equal(await page.locator('#feature-chart .feature-row').first().getAttribute('data-feature'), 'features/receipts.feature')
  await page.locator('#feature-chart [data-feature="features/order.feature"]').click()
  await assertFocus('#feature-inspector h3')
  await openDetails('.matrix-panel')
  await page.locator('[data-cell-file="src/money.ts"][data-cell-feature="features/order.feature"]').click()
  assert.equal(await page.locator('#file-inspector h3').innerText(), 'src/money.ts')
  assert.equal(await page.locator('#file-workspace').evaluate((element: HTMLElement) => element.parentElement?.id), 'features-workspace-slot')
  assert.equal(await page.locator('[data-workspace-scope="spec:features/order.feature"]').getAttribute('aria-pressed'), 'true')
  await screenshot('desktop-cross-reference')
  checkpoints.push('lightest feature ranking, matrix navigation and matching file scope')

  await page.locator('nav[aria-label="Report sections"] a[href="#settings"]').click()
  await page.locator('[data-entry="src/money.ts"]').click()
  assert.match(await page.locator('#entry-inspector').innerText(), /also matched by src/)
  await page.locator('[data-entry="empty"]').click()
  assert.match(await page.locator('#entry-inspector').innerText(), /Indexed files\s+0/)
  await screenshot('desktop-settings')
  await page.locator('nav[aria-label="Report sections"] a[href="#files"]').click()
  await openDetails('.file-table')
  await page.locator('#file-search').fill('no-such-file')
  assert.match(await page.locator('#file-rows').innerText(), /No maintained files match/)
  await page.locator('#file-search').fill('')
  await page.locator('#file-filter').selectOption({ label: 'No components reported' })
  assert.match(await page.locator('#file-rows').innerText(), /README\.md/)
  checkpoints.push('effective maintained overlap, empty entry and no-component inventory filter')

  await page.locator('nav[aria-label="Report sections"] a[href="#unrooted"]').click()
  await page.locator('#unrooted-ranking [data-unrooted-file="src/checkout.ts"]').click()
  assert.equal(await page.locator('[data-workspace-scope="unlinked"]').getAttribute('aria-pressed'), 'true')
  await screenshot('desktop-unlinked-components')
  await load(incomplete)
  assert.equal(await page.locator('#verdict-label').innerText(), 'Incomplete')
  await page.locator('nav[aria-label="Report sections"] a[href="#features"]').click()
  await page.locator('#feature-chart [data-feature="features/subscriptions.feature"]').click()
  assert.match(await page.locator('#feature-inspector').innerText(), /Reachable source component tokens\s+Not established/)
  await page.locator('nav[aria-label="Report sections"] a[href="#bindings"]').click()
  await page.locator('#binding-filter').selectOption('unbound')
  assert.match(await page.locator('#binding-rows').innerText(), /subscription\.start/)
  await screenshot('desktop-missing-binding')
  checkpoints.push('unlinked responsibilities and honest missing-binding footprint')

  await page.setViewportSize({ width: 390, height: 844 })
  await load(rejected)
  await screenshot('mobile-overview')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'Mobile report must not overflow the document horizontally')
  await page.locator('#mobile-file-plot [data-file="src/checkout.ts"]').click()
  await assertFocus('#file-inspector h3')
  await screenshot('mobile-file-workspace')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'Mobile file workspace must contain its tables')
  checkpoints.push('390px viewport overflow and file workspace')
  assert.deepEqual(blockedNetwork, [], 'The standalone report must make no HTTP(S) asset requests')
  assert.deepEqual(failures, [], 'Generated reports must not raise browser errors')
  successful = true
} catch (error) {
  failures.push(error instanceof Error ? error.stack || error.message : String(error))
  if (page) await screenshot('failure').catch(() => {})
  throw error
} finally {
  writeFileSync(join(artifacts, 'browser-results.json'), JSON.stringify({ successful, playwright: tooling.version, checkpoints, failures, blockedNetwork, previews, previewBytes, visualReview: 'Screenshots are real browser captures; human visual review is separate from these assertions.' }, null, 2))
  await browser?.close()
  rmSync(root, { recursive: true, force: true })
}
console.log('Generated-report Chromium QA passed; screenshots require visual review.')
