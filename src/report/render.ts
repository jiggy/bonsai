import { readFileSync } from 'node:fs'
import { reportClient } from './client.ts'
import { buildReportData, type ReportContext, type ReportInput } from './model.ts'

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
const scriptText = (value: string) => value.replace(/<\/script/gi, '<\\/script')

/** An offline projection of the already evaluated check, with no additional collection. */
export function renderHtmlReport(input: ReportInput, context: ReportContext): string {
  const data = buildReportData(input, context)
  const template = readFileSync(new URL('./template.html', import.meta.url), 'utf8')
  let style = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
  const regular = readFileSync(
    new URL('./assets/fonts/OpenRunde-Regular.woff2.base64.txt', import.meta.url),
    'utf8',
  )
  const medium = readFileSync(
    new URL('./assets/fonts/OpenRunde-Medium.woff2.base64.txt', import.meta.url),
    'utf8',
  )
  const semibold = readFileSync(
    new URL('./assets/fonts/OpenRunde-Semibold.woff2.base64.txt', import.meta.url),
    'utf8',
  )
  for (const [weight, font] of [
    ['Regular', regular],
    ['Medium', medium],
    ['Semibold', semibold],
  ])
    style = style.replaceAll(
      `./assets/fonts/OpenRunde-${weight}.woff2`,
      `data:font/woff2;base64,${font!.trim()}`,
    )
  const favicon = readFileSync(new URL('./assets/favicon.svg', import.meta.url), 'utf8')
  const license = readFileSync(
    new URL('./assets/fonts/OpenRunde-LICENSE.txt', import.meta.url),
    'utf8',
  )
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const client = `(${reportClient.toString()})(JSON.parse(document.getElementById('bonsai-report-data').textContent));`
  const replace = (html: string, marker: string, value: string) => {
    if (html.split(marker).length !== 2) throw new Error(`HTML report template needs one ${marker}`)
    return html.replace(marker, () => value)
  }
  let html = replace(
    template,
    'BONSAI_REPORT_FAVICON',
    `data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}`,
  )
  html = replace(
    html,
    '<!--BONSAI_REPORT_STYLE-->',
    `<style id="bonsai-report-style">${style}</style>`,
  )
  html = replace(
    html,
    '<!--BONSAI_REPORT_DATA-->',
    `<script type="application/json" id="bonsai-report-data">${json}</script><script type="text/plain" id="font-license">${scriptText(license)}</script>`,
  )
  html = replace(
    html,
    '<!--BONSAI_REPORT_CLIENT-->',
    `<script id="bonsai-report-client">${scriptText(client)}</script>`,
  )
  return html.replace(
    /<title>[^<]*<\/title>/,
    () => `<title>${escapeHtml(context.project)} · Bonsai check</title>`,
  )
}
