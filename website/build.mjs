import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const website = dirname(fileURLToPath(import.meta.url))
const output = resolve(website, '../_site')
const site = new URL(process.env.SITE_URL?.trim() || 'https://jiggy.github.io/bonsai/')
if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password) {
  throw new Error('SITE_URL must be an HTTP(S) site URL without credentials')
}
site.search = ''
site.hash = ''
site.pathname = `${site.pathname.replace(/\/+$/, '')}/`

rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
cpSync(resolve(website, 'public'), output, { recursive: true })
const index = resolve(output, 'index.html')
const html = readFileSync(index, 'utf8')
  .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${site.href}$2`)
  .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${site.href}$2`)
  .replace(
    /(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*(")/g,
    `$1${new URL('assets/social-card.png', site).href}$2`,
  )
writeFileSync(index, html)
console.log(`Built _site for ${site.href}`)
