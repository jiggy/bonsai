import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../_site')
const base = new URL('https://example.invalid/bonsai/')
const errors = []
const files = []
const allowedAsset = /\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?|otf|ttf)$/i

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    const name = relative(output, path).replaceAll('\\', '/')
    if (entry.isSymbolicLink()) {
      errors.push(`Symlinks cannot be published: ${name}`)
    } else if (entry.isDirectory()) {
      if (name === 'assets' || name.startsWith('assets/')) scan(path)
      else errors.push(`Unexpected artifact directory: ${name}`)
    } else if (entry.isFile()) {
      const publicFile =
        name === 'index.html' ||
        /^[^/]+\.(?:css|js)$/.test(name) ||
        (name.startsWith('assets/') &&
          (allowedAsset.test(name) || /(?:^|\/)[^/]*license[^/]*\.txt$/i.test(name)))
      if (!publicFile) errors.push(`Unexpected artifact file: ${name}`)
      files.push(name)
    } else errors.push(`Unsupported artifact entry: ${name}`)
  }
}

if (!existsSync(resolve(output, 'index.html'))) {
  console.error(
    'Website check failed: _site/index.html is missing. Run bun run website:build first.',
  )
  process.exit(1)
}
scan(output)

const html = readFileSync(resolve(output, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const tags = [...html.matchAll(/<([a-z][\w:-]*)\b([^>]*?)>/gi)].map((match) => ({
  name: match[1].toLowerCase(),
  attributes: Object.fromEntries(
    [...match[2].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((attribute) => [
      attribute[1].toLowerCase(),
      attribute[2] ?? attribute[3],
    ]),
  ),
}))
const ids = new Set()
for (const { attributes } of tags) {
  if (!attributes.id) continue
  if (ids.has(attributes.id)) errors.push(`Duplicate HTML id: ${attributes.id}`)
  ids.add(attributes.id)
}

function checkTarget(id, context) {
  if (id && !ids.has(id)) errors.push(`${context} has no target: #${id}`)
}

let localReferences = 0
function checkReference(value, from, context, resource = false) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) {
    if (resource && !value.startsWith('data:'))
      errors.push(`${context} loads a remote resource: ${value}`)
    return
  }
  if (value.startsWith('/')) {
    errors.push(`${context} must be relative for project Pages hosting: ${value}`)
    return
  }
  let target
  try {
    target = new URL(value, new URL(from, base))
  } catch {
    errors.push(`${context} has an invalid URL: ${value}`)
    return
  }
  if (!target.pathname.startsWith(base.pathname)) {
    errors.push(`${context} escapes the deployed site: ${value}`)
    return
  }
  let name
  try {
    name = decodeURIComponent(target.pathname.slice(base.pathname.length)) || 'index.html'
  } catch {
    errors.push(`${context} has invalid URL encoding: ${value}`)
    return
  }
  const path = resolve(output, name)
  if (!path.startsWith(`${output}/`) || !existsSync(path) || !statSync(path).isFile()) {
    errors.push(`${context} references a missing artifact: ${value}`)
    return
  }
  localReferences += 1
  if (name === 'index.html' && target.hash) {
    try {
      checkTarget(decodeURIComponent(target.hash.slice(1)), context)
    } catch {
      errors.push(`${context} has invalid fragment encoding: ${value}`)
    }
  }
}

for (const { name, attributes } of tags) {
  for (const attribute of ['href', 'src', 'xlink:href']) {
    if (!(attribute in attributes)) continue
    const resource = name !== 'a' && !(name === 'link' && attributes.rel === 'canonical')
    checkReference(attributes[attribute], 'index.html', `${name}[${attribute}]`, resource)
  }
  for (const attribute of ['for', 'aria-controls', 'aria-labelledby', 'aria-describedby']) {
    for (const id of (attributes[attribute] ?? '').split(/\s+/).filter(Boolean)) {
      checkTarget(id, `${name}[${attribute}]`)
    }
  }
}

for (const file of files) {
  if (extname(file) === '.css') {
    const css = readFileSync(resolve(output, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)) {
      checkReference(match[1] ?? match[2] ?? match[3], file, `${file} url()`, true)
    }
  } else if (extname(file) === '.js') {
    const result = spawnSync('node', ['--check', resolve(output, file)], { encoding: 'utf8' })
    if (result.error) errors.push(`Cannot check ${file}: ${result.error.message}`)
    else if (result.status !== 0)
      errors.push(`Invalid JavaScript in ${file}: ${result.stderr.trim()}`)
  }
}

if (errors.length) {
  console.error(`Website check failed:\n${errors.map((error) => `- ${error}`).join('\n')}`)
  process.exitCode = 1
} else {
  console.log(
    `Website check passed: ${files.length} public files, ${ids.size} unique IDs, ${localReferences} local references.`,
  )
}
