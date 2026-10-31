import type { ReportData } from './model.ts'

/** Browser-only interaction, serialized by the renderer without a runtime build. */
export function reportClient(D: ReportData) {
  type File = ReportData['files'][number]
  type Component = ReportData['components'][number]
  type Feature = ReportData['features'][number]
  type Check = Feature['checks'][number]
  type Element = HTMLElement & { value: string; disabled: boolean; open: boolean }
  type FileView = { scope: string; declaration?: string; check?: string }
  const template = document.documentElement.cloneNode(true) as HTMLElement
  const $ = (id: string) => document.getElementById(id) as Element
  const e = (value: unknown) =>
    String(value).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
    )
  function highlight(value: unknown, language: string) {
    const source = String(value)
    const pattern =
      language === 'json'
        ? /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\],:]/g
        : /\b(?:floor|min|max|log2|tokens|pairs|[A-Za-z][A-Za-z0-9]*)\b|\d+(?:,\d{3})*(?:\.\d+)?|[=+×/(),]/g
    let output = '',
      cursor = 0
    for (const match of source.matchAll(pattern)) {
      const token = match[0],
        tail = source.slice(match.index + token.length)
      const kind =
        language === 'json'
          ? token.startsWith('"')
            ? tail.trimStart().startsWith(':')
              ? 'key'
              : 'string'
            : /^-?\d/.test(token)
              ? 'number'
              : /^(true|false|null)$/.test(token)
                ? 'keyword'
                : 'punctuation'
          : /^(floor|min|max|log2)$/.test(token)
            ? 'function'
            : /^[\d]/.test(token)
              ? 'number'
              : /^(tokens|pairs)$/.test(token)
                ? 'unit'
                : /^[A-Za-z]/.test(token)
                  ? 'key'
                  : 'operator'
      output +=
        e(source.slice(cursor, match.index)) + `<span class="syntax-${kind}">${e(token)}</span>`
      cursor = match.index + token.length
    }
    return output + e(source.slice(cursor))
  }
  const n = (value: number) => value.toLocaleString('en-US')
  function niceDomain(value: number) {
    const target = Number.isFinite(value) && value > 0 ? value : 1,
      rough = target / 4,
      power = 10 ** Math.floor(Math.log10(rough))
    const factor = [1, 2, 2.5, 5, 10].find((f) => f >= rough / power) || 10,
      step = Math.max(1, factor * power)
    const end = Math.ceil(target / step) * step
    if (!Number.isFinite(end))
      return { max: target, ticks: Array.from({ length: 5 }, (_, i) => (target / 4) * i) }
    return {
      max: end,
      ticks: Array.from({ length: Math.round(end / step) + 1 }, (_, i) => i * step),
    }
  }
  const axisNumber = (value: number) =>
    value >= 1000
      ? (value / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'k'
      : n(value)
  const share = (part: number, total: number) => {
    if (!total) return 'Unavailable'
    if (!part) return '0%'
    if (part === total) return '100%'
    const value = (100 * part) / total
    return value < 0.1 ? '<0.1%' : value > 99.9 ? '>99.9%' : value.toFixed(1) + '%'
  }
  const sum = (xs: { tokens: number }[]) => xs.reduce((a, x) => a + x.tokens, 0)
  const uniq = <T>(xs: T[]): T[] => [...new Set(xs)]
  const componentsById = new Map(D.components.map((c) => [c.id, c]))
  const componentsByFile = new Map<string, Component[]>()
  for (const c of D.components) {
    const list = componentsByFile.get(c.file) || []
    list.push(c)
    componentsByFile.set(c.file, list)
  }
  const filesByPath = new Map(D.files.map((f) => [f.path, f]))
  const featuresById = new Map(D.features.map((f) => [f.id, f]))
  const bindingsByAction = new Map(D.bindings.map((b) => [b.action, b]))
  const component = (id?: string) => (id === undefined ? undefined : componentsById.get(id))!
  const feature = (id: string) => featuresById.get(id)!
  const file = (path?: string) => (path === undefined ? undefined : filesByPath.get(path))!
  const binding = (action: string) => bindingsByAction.get(action)
  const cs = (f: File) => componentsByFile.get(f.path) || []
  const prod = (f: File) => cs(f).filter((c) => c.kind === 'production')
  const roots = (f: File) => uniq(prod(f).flatMap((c) => c.features))
  const naked = (f: File, kind: string = 'production') =>
    cs(f).filter((c) => !c.features.length && (kind === 'all' || c.kind === kind))
  const matches = (entry: string) => {
    const paths = new Set(D.maintainedEntries.find((item) => item.entry === entry)?.files ?? [])
    return D.files.filter((f) => paths.has(f.path))
  }
  const retained = D.decision.retained
  const policy = D.config.policy
  const ceiling = D.decision.ceiling
  const allChecks = D.features.flatMap((f) => f.checks)
  const resultFor = (check: Check) =>
    D.evidenceState === 'matched'
      ? D.evidence?.checks.find((result) => result.id === check.id)
      : undefined
  const statusFor = (check: Check) => resultFor(check)?.status || 'unavailable'
  const associations = (f: File) => uniq(cs(f).flatMap((c) => c.features))
  const sourceFile = (f: File) => prod(f).length > 0
  const fileStatus = (f: File) =>
    !cs(f).length
      ? 'No components reported'
      : !naked(f, 'all').length
        ? 'All components linked'
        : naked(f, 'all').length === cs(f).length
          ? 'No spec links'
          : 'Some components lack links'
  const unrooted = D.components.filter((c) => !c.features.length)
  const unresolved = (f: Feature) => f.actions.filter((a) => !binding(a)?.handler)
  const footprint = (f: Feature) => {
    const components = D.components.filter(
      (c) => c.kind === 'production' && c.features.includes(f.id),
    )
    const paths = uniq(components.map((c) => c.file))
    return {
      components,
      tokens: sum(components),
      exclusive: sum(components.filter((c) => c.features.length === 1)),
      shared: sum(components.filter((c) => c.features.length > 1)),
      files: D.files.filter((g) => paths.includes(g.path)),
      missing: unresolved(f),
    }
  }
  const initialFile =
    [...D.files].sort((a, b) => sum(naked(b)) - sum(naked(a)) || b.tokens - a.tokens)[0]?.path || ''
  const state = {
    file: initialFile,
    feature: D.features[0]?.id || '',
    query: '',
    filter: 'all',
    sort: 'tokens',
    featureSort: 'heavy',
    unrootedKind: 'production',
    unrootedSort: 'tokens',
    unrootedFile: initialFile,
    entry: D.config.maintained[0] || '',
    bindingFilter: 'all',
    inventoryPath: '',
    inventoryView: 'tree',
    workspaceOrigin: 'files',
    fileViews: new Map<string, FileView>(),
    fileHistory: [] as string[],
  }
  const tag = (text: string, type: string = '') => `<span class="tag ${type}">${e(text)}</span>`
  const fileButton = (path: string, label: string = path) =>
    `<button type="button" class="text-link path" data-file="${e(path)}">${e(label)}</button>`
  const featureButton = (id: string, label?: string) =>
    `<button type="button" class="text-link" data-feature="${e(id)}">${e(label || feature(id).name)}</button>`
  const componentButton = (c: Component | undefined) =>
    c
      ? `<button type="button" class="text-link mono" data-component="${e(c.id)}">${e(componentName(c))}</button>`
      : tag('Component unavailable', 'warn')
  const evidenceTag = (s: string) =>
    tag(
      s === 'unavailable' ? 'No result' : s[0].toUpperCase() + s.slice(1),
      s === 'passed' ? 'good' : s === 'failed' ? 'bad' : 'warn',
    )
  const stat = (label: string, value: string | number) =>
    `<div class="detail-stat"><span>${e(label)}</span><strong>${e(value)}</strong></div>`
  const sourceEdges = new Map<string, ReportData['relationships']>()
  for (const edge of D.relationships) {
    const list = sourceEdges.get(edge.from) || []
    list.push(edge)
    sourceEdges.set(edge.from, list)
  }
  function pathTo(start: string | undefined, target: string): string[] | null {
    if (!start) return null
    type Route = { id: string; runtime: boolean; production: boolean; previous?: Route }
    const queue: Route[] = [{ id: start, runtime: true, production: start !== D.registry }]
    const seen = new Set<string>()
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]!
      if (
        !component(current.id) ||
        (!current.production && component(current.id).kind === 'production')
      )
        continue
      const key = current.id + '\0' + current.runtime + '\0' + current.production
      if (seen.has(key)) continue
      seen.add(key)
      if (current.id === target) {
        const path: string[] = []
        let route: Route | undefined = current
        while (route) {
          path.push(route.id)
          route = route.previous
        }
        return path.reverse()
      }
      for (const edge of sourceEdges.get(current.id) || []) {
        const destination = component(edge.to),
          initialization = edge.kind === 'module-initialization'
        if (
          !destination ||
          ((initialization || edge.kind === 'entry-point') && !current.runtime) ||
          (current.id === D.registry && !initialization)
        )
          continue
        queue.push({
          id: edge.to,
          runtime: current.runtime && edge.runtime !== false,
          production:
            destination.kind !== 'test' &&
            (current.production || (current.id === D.registry && initialization)),
          previous: current,
        })
      }
    }
    return null
  }
  function sourcePath(action: string, target: string) {
    const direct = pathTo(binding(action)?.handler || undefined, target)
    return direct || (target !== D.registry && pathTo(D.registry, target)) || null
  }
  const componentName = (c: Component) =>
    c.name === '<resource>'
      ? 'File content'
      : c.name === '<module-initialization>'
        ? 'Module startup'
        : c.name.startsWith('<top-level:')
          ? 'Top-level statement'
          : c.name
  const featureReason = (f: Feature) =>
    !f.checks.length
      ? 'No observations compiled'
      : unresolved(f).length
        ? 'Missing action handlers'
        : D.problems.contracts.length
          ? 'Contract compilation is incomplete'
          : D.problems.source.length || D.analysis?.status !== 'complete'
            ? 'Source facts are incomplete'
            : null
  const originLabel = (id: string) =>
    (
      ({
        files: 'file cost & reach',
        inventory: 'the token map',
        unrooted: 'components without links',
        features: 'specification footprints',
        settings: 'scope & settings',
        bindings: 'bindings',
      }) as Record<string, string>
    )[id] || 'file cost & reach'
  function viewFor(f: File): FileView {
    let view = state.fileViews.get(f.path)
    if (!view) {
      view = { scope: 'all', declaration: [...cs(f)].sort((a, b) => b.tokens - a.tokens)[0]?.id }
      state.fileViews.set(f.path, view)
    }
    return view
  }
  function renderBudgetCurve() {
    const w = Math.max(280, $('budget-curve').clientWidth || 560),
      h = 260,
      left = 48,
      right = 16,
      top = 20,
      bottom = 54
    const xDomain = niceDomain(Math.max(policy.bootstrapSurface * 4, D.surface * 2)),
      yDomain = niceDomain(Math.max(retained, policy.hardLimit, ceiling))
    const maxX = xDomain.max,
      maxY = yDomain.max
    const x = (value: number) => left + ((w - left - right) * value) / maxX,
      y = (value: number) => h - bottom - ((h - top - bottom) * value) / maxY
    const allowance = (value: number) =>
      Math.floor(
        Math.min(
          policy.hardLimit,
          policy.bootstrap +
            policy.perDoubling * Math.log2(Math.max(1, value / policy.bootstrapSurface)),
        ),
      )
    const curve = Array.from(
      { length: 161 },
      (_, i) =>
        `${i ? 'L' : 'M'}${x((maxX * i) / 160).toFixed(2)} ${y(allowance((maxX * i) / 160)).toFixed(2)}`,
    ).join(' ')
    const yy = yDomain.ticks
    $('budget-curve').innerHTML =
      `<svg viewBox="0 0 ${w} ${h}" data-domain-x="${maxX}" data-domain-y="${maxY}" role="img" aria-label="Allowance policy, not history. At ${D.surface} unique action–observation pairs, the ceiling is ${n(ceiling)} tokens and retained cost is ${n(retained)}. The maximum possible allowance is ${n(policy.hardLimit)} tokens."><g class="curve-grid">${yy.map((v) => `<line x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${axisNumber(v)}</text>`).join('')}</g><line class="hard-cap-line" x1="${left}" x2="${w - right}" y1="${y(policy.hardLimit)}" y2="${y(policy.hardLimit)}"/><text class="cap-label" x="${w - right}" y="${y(policy.hardLimit) - 7}" text-anchor="end">Maximum allowance ${n(policy.hardLimit)}</text><line class="retained-line" x1="${left}" x2="${w - right}" y1="${y(retained)}" y2="${y(retained)}"/><path class="allowance-line" d="${curve}"/><line class="current-guide" x1="${x(D.surface)}" x2="${x(D.surface)}" y1="${top}" y2="${h - bottom}"/><line class="gap-line" x1="${x(D.surface)}" x2="${x(D.surface)}" y1="${y(retained)}" y2="${y(ceiling)}"/><circle class="retained-dot" cx="${x(D.surface)}" cy="${y(retained)}" r="5"/><circle class="allowance-dot" cx="${x(D.surface)}" cy="${y(ceiling)}" r="5"/><text class="retained-label" x="${x(D.surface) + 10}" y="${y(retained) - 8}">Retained ${n(retained)}</text><text class="allowance-label" x="${x(D.surface) + 10}" y="${y(ceiling) + 19}">Ceiling ${n(ceiling)}</text>${uniq(
        [0, D.surface, maxX],
      )
        .map(
          (v) =>
            `<text x="${x(v)}" y="${h - bottom + 23}" text-anchor="${v === 0 ? 'start' : v === maxX ? 'end' : 'middle'}">${v}${v === D.surface ? ' · current' : ''}</text>`,
        )
        .join(
          '',
        )}<text class="axis-title" x="${(w + left - right) / 2}" y="${h - 7}" text-anchor="middle">Unique action–observation pairs</text></svg>`
  }
  function inventoryChildren(path: string) {
    const prefix = path ? path + '/' : ''
    const files = D.files.filter((f) => f.path.startsWith(prefix))
    const groups = new Map()
    for (const f of files) {
      const rest = f.path.slice(prefix.length),
        parts = rest.split('/'),
        folder = parts.length > 1,
        key = prefix + parts[0]
      if (!groups.has(key))
        groups.set(key, { path: key, name: parts[0], folder, tokens: 0, files: [] })
      const g = groups.get(key)
      g.tokens += f.tokens
      g.files.push(f)
    }
    return [...groups.values()].sort((a, b) => b.tokens - a.tokens || a.path.localeCompare(b.path))
  }
  function tileRects(
    items: { path: string; name: string; folder: boolean; tokens: number; files: File[] }[],
    x: number,
    y: number,
    w: number,
    h: number,
  ): {
    item: { path: string; name: string; folder: boolean; tokens: number; files: File[] }
    x: number
    y: number
    w: number
    h: number
  }[] {
    if (!items.length || sum(items) <= 0) return []
    if (items.length === 1) return [{ item: items[0], x, y, w, h }]
    const total = sum(items)
    let cut = 1,
      best = Infinity,
      cursor = 0
    for (let i = 1; i < items.length; i++) {
      cursor += items[i - 1].tokens
      const delta = Math.abs(total / 2 - cursor)
      if (delta < best) {
        best = delta
        cut = i
      }
    }
    const first = items.slice(0, cut),
      second = items.slice(cut),
      fraction = sum(first) / total
    return w >= h
      ? [
          ...tileRects(first, x, y, w * fraction, h),
          ...tileRects(second, x + w * fraction, y, w * (1 - fraction), h),
        ]
      : [
          ...tileRects(first, x, y, w, h * fraction),
          ...tileRects(second, x, y + h * fraction, w, h * (1 - fraction)),
        ]
  }
  function renderInventory() {
    const items = inventoryChildren(state.inventoryPath),
      prefix = state.inventoryPath ? state.inventoryPath + '/' : ''
    const files = D.files.filter((f) => f.path.startsWith(prefix)),
      amount = sum(files)
    const crumbs = [{ label: 'All files', path: '' }]
    let cursor = ''
    for (const part of state.inventoryPath.split('/').filter(Boolean)) {
      cursor += (cursor ? '/' : '') + part
      crumbs.push({ label: part, path: cursor })
    }
    $('inventory-breadcrumb').innerHTML = crumbs
      .map(
        (c, i) =>
          `<button type="button" class="text-link" data-inventory-path="${e(c.path)}" ${i === crumbs.length - 1 ? 'aria-current="location"' : ''}>${e(c.label)}</button>`,
      )
      .join('<span aria-hidden="true"> / </span>')
    $('inventory-up').disabled = !state.inventoryPath
    const width = $('inventory-map').clientWidth || 700,
      height = $('inventory-map').clientHeight || 370
    const colors = ['#a89cde', '#b9afe7', '#c7bfea', '#d6d0ee', '#e2ddf2', '#eae6f6', '#f0edf9']
    $('inventory-map').innerHTML =
      amount > 0
        ? tileRects(items, 0, 0, width, height)
            .map((r, i) => {
              const g = r.item,
                gaps = !g.folder && naked(file(g.path), 'all').length
              return `<button type="button" class="inventory-tile ${g.folder ? 'is-folder' : ''} ${gaps ? 'has-gaps' : ''}" ${g.folder ? 'data-inventory-path' : 'data-file'}="${e(g.path)}" aria-label="${e(g.path)}${g.folder ? '/' : ''}, ${n(g.tokens)} full retained tokens, ${g.files.length} file${g.files.length === 1 ? '' : 's'}. ${g.folder ? 'Open folder' : 'Inspect file'}." aria-pressed="${!g.folder && state.file === g.path}" style="left:${(100 * r.x) / width}%;top:${(100 * r.y) / height}%;width:${(100 * r.w) / width}%;height:${(100 * r.h) / height}%;background:${colors[i % colors.length]}"><span class="tile-name">${e(g.name)}${g.folder ? '/' : ''}</span>${r.w > 75 && r.h > 70 ? `<span class="tile-value">${n(g.tokens)}</span>` : ''}${r.w > 110 && r.h > 105 ? `<span class="tile-meta">${e(share(g.tokens, retained))} of global · ${g.files.length} file${g.files.length === 1 ? '' : 's'}</span>` : ''}</button>`
            })
            .join('')
        : '<p class="empty-state">No positive retained-token area is available. Inspect the exact file list for zero-cost or empty inventory.</p>'
    $('inventory-ranked').innerHTML = items
      .map(
        (g) =>
          `<button type="button" class="inventory-ranked-row" ${g.folder ? 'data-inventory-path' : 'data-file'}="${e(g.path)}"><span class="path">${e(g.name)}${g.folder ? '/' : ''}</span><strong>${n(g.tokens)}</strong><span class="rank-track"><i style="width:${(100 * g.tokens) / (items[0]?.tokens || 1)}%"></i></span><small>${g.files.length} file${g.files.length === 1 ? '' : 's'}</small></button>`,
      )
      .join('')
    $('inventory-map').hidden = state.inventoryView !== 'tree'
    $('inventory-ranked').hidden = state.inventoryView !== 'rank'
    document
      .querySelectorAll<HTMLElement>('[data-inventory-view]')
      .forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.inventoryView === state.inventoryView)),
      )
    $('inventory-view-total').textContent =
      `${files.length} files · ${n(amount)} tokens in ${state.inventoryPath || 'the complete inventory'}. Global retained cost stays ${n(retained)}; ceiling stays ${n(ceiling)}.`
    const largest = [...files].sort((a, b) => b.tokens - a.tokens)[0]
    $('inventory-summary').innerHTML =
      `<p class="eyebrow">CURRENT FOLDER</p><h3 class="path">${e(state.inventoryPath ? state.inventoryPath + '/' : 'All maintained files')}</h3>${stat('Retained cost', n(amount) + ' tokens')}${stat('Unique files', files.length)}${stat('Share of global inventory', share(amount, retained))}<p class="caption">Whole files, counted once. Documentation, tests, specifications, settings, and files without declarations remain included.</p>${largest ? `<h4>Largest file here</h4>${fileButton(largest.path)}<p class="caption">${n(largest.tokens)} full retained tokens</p>` : ''}`
    $('inventory-rows').innerHTML = [...files]
      .sort((a, b) => b.tokens - a.tokens)
      .map(
        (f) =>
          `<tr><td>${fileButton(f.path)}</td><td class="num">${n(f.tokens)}</td><td class="num">${e(share(f.tokens, retained))}</td></tr>`,
      )
      .join('')
  }
  function renderOverview() {
    $('project-name').textContent = D.project
    $('run-date').textContent = 'Generated ' + D.generatedAt
    $('run-fingerprint').textContent = 'Snapshot ' + D.fingerprint
    $('retained-number').innerHTML = n(retained) + ' <span>tokens</span>'
    $('retained-number').classList.toggle('is-over-budget', retained > ceiling)
    $('budget-state').textContent =
      ceiling > 0
        ? ((100 * retained) / ceiling).toFixed(0) + '% of allowance'
        : retained
          ? 'No token allowance'
          : 'No retained tokens'
    $('budget-ceiling').textContent = 'Current ceiling ' + n(ceiling) + ' tokens'
    renderBudgetCurve()
    $('reduction').innerHTML =
      retained > ceiling
        ? '<strong>' +
          n(retained - ceiling) +
          ' tokens above the ceiling.</strong><br><span class="caption">An arithmetic gap, not verified removable code.</span>'
        : '<strong>' +
          n(Math.max(0, ceiling - retained)) +
          ' tokens of headroom.</strong><br><span class="caption">All other requirements remain separate.</span>'
    const status = D.decision.status
    const banner = document.querySelector<HTMLElement>('.verdict-banner')!
    $('verdict-icon').textContent = status === 'pass' ? '✓' : status === 'reject' ? '×' : '△'
    banner.classList.toggle('is-pass', status === 'pass')
    banner.classList.toggle('is-reject', status === 'reject')
    $('verdict-label').textContent =
      status === 'pass' ? 'Pass' : status === 'reject' ? 'Rejected' : 'Incomplete'
    $('verdict-explanation').textContent =
      status === 'pass'
        ? 'The evaluated candidate satisfies the reported requirements.'
        : status === 'reject'
          ? 'The evaluated candidate has recorded requirement violations.'
          : 'Acceptance is not established. Resolve the recorded blockers and inspect provisional findings.'
    const findings = [
      ...D.problems.contracts.map((message) => ({ kind: 'Specification', message })),
      ...D.problems.source.map((message) => ({ kind: 'Source analysis', message })),
      ...D.decision.violations.map((message) => ({ kind: 'Gate requirement', message })),
    ]
    if (D.evidenceState === 'mismatched')
      findings.push({
        kind: 'Evidence context',
        message:
          'Recorded evidence does not match this invocation. Observation outcomes are unavailable in the views below.',
      })
    $('blocker-count').textContent = findings.length + ' recorded findings'
    $('blocker-list').innerHTML = findings.length
      ? findings
          .map(
            (f) =>
              '<div class="blocker-item"><strong>' +
              e(f.kind) +
              '</strong><span>' +
              e(f.message) +
              '</span></div>',
          )
          .join('')
      : '<p class="caption">No recorded gate findings. The decision above remains authoritative.</p>'
    const passed = allChecks.filter((check) => statusFor(check) === 'passed').length
    const percent = (value: number, max: number) =>
      Math.max(0, Math.min(100, (100 * value) / Math.max(1, max)))
    const current = (value: number, max: number) =>
      '<i class="indicator-current" style="left:' +
      percent(value, max) +
      '%" aria-hidden="true"></i>'
    const track = (value: number, max: number, limit: number, label: string, fill = '') =>
      '<div class="indicator-track" role="img" aria-label="' +
      e(label) +
      '"><span class="indicator-fill ' +
      fill +
      '" style="width:' +
      percent(value, max) +
      '%"></span>' +
      current(value, max) +
      (value > limit
        ? '<i class="indicator-limit" style="left:' +
          percent(limit, max) +
          '%" aria-hidden="true"></i>'
        : '') +
      '</div>'
    const indicator = (name: string, value: string, visual: string, labels: string, note: string) =>
      '<div class="gate-indicator"><div class="indicator-heading"><h3>' +
      name +
      '</h3><strong>' +
      value +
      '</strong></div>' +
      visual +
      '<div class="indicator-labels">' +
      labels +
      '</div><p class="indicator-note">' +
      note +
      '</p></div>'
    const linked = D.components.length - unrooted.length
    const linkTrack = D.components.length
      ? '<div class="indicator-track" role="img" aria-label="' +
        linked +
        ' of ' +
        D.components.length +
        ' components have specification links"><span class="indicator-segment good" style="width:' +
        percent(linked, D.components.length) +
        '%"></span><span class="indicator-segment failed" style="width:' +
        percent(unrooted.length, D.components.length) +
        '%"></span>' +
        current(linked, D.components.length) +
        '</div>'
      : tag('No components recorded', 'muted')
    const statuses = ['passed', 'failed', 'missing', 'unavailable']
    const resultTrack = allChecks.length
      ? '<div class="indicator-track" role="img" aria-label="' +
        e(
          statuses
            .map((status) => allChecks.filter((c) => statusFor(c) === status).length + ' ' + status)
            .join(', '),
        ) +
        '">' +
        statuses
          .map(
            (status) =>
              '<span class="indicator-segment ' +
              (status === 'passed' ? 'good' : status === 'unavailable' ? 'not-run' : status) +
              '" style="width:' +
              percent(allChecks.filter((c) => statusFor(c) === status).length, allChecks.length) +
              '%"></span>',
          )
          .join('') +
        current(passed, allChecks.length) +
        '</div>'
      : tag('No observations compiled', 'muted')
    const elapsed = D.feedbackMs,
      timeMax = Math.max(policy.maxFeedbackMs, elapsed ?? 0, 1)
    $('acceptance-indicators').innerHTML =
      indicator(
        'Components with spec links',
        linked + ' / ' + D.components.length,
        linkTrack,
        '0<span>Required: all ' + D.components.length + '</span>',
        '<a class="text-link" href="#unrooted">Inspect ' +
          unrooted.length +
          ' components without links →</a>',
      ) +
      indicator(
        'Recorded observations passed',
        passed + ' / ' + allChecks.length,
        resultTrack,
        '0<span>Required: all ' + allChecks.length + '</span>',
        statuses
          .map((status) => allChecks.filter((c) => statusFor(c) === status).length + ' ' + status)
          .join(' · ') +
          (D.evidenceState !== 'matched'
            ? ' · Current evidence unavailable'
            : D.evidence?.complete
              ? ' · Evidence marked complete'
              : ' · Partial evidence'),
      ) +
      indicator(
        'Feedback time',
        elapsed === null
          ? 'Unavailable'
          : (elapsed / 1000).toFixed(2) + 's / ' + (policy.maxFeedbackMs / 1000).toFixed(2) + 's',
        elapsed === null
          ? ''
          : track(
              elapsed,
              timeMax,
              policy.maxFeedbackMs,
              'Candidate feedback time versus saved deadline',
              elapsed <= policy.maxFeedbackMs ? 'good' : 'failed',
            ),
        '0<span>' + n(timeMax) + 'ms scale</span>',
        elapsed === null
          ? 'No recorded feedback measurement.'
          : 'Solid tick: ' +
              n(elapsed) +
              'ms current. ' +
              (elapsed > policy.maxFeedbackMs ? 'Dashed tick: ' : 'Endpoint: ') +
              n(policy.maxFeedbackMs) +
              'ms configured deadline. Timing remains separate from accepted evidence.',
      )
    const structural = D.config.policy.structural
    if (structural) {
      const facts = D.controlDepth,
        maximum = facts?.regions.length
          ? Math.max(...facts.regions.map((region) => region.depth))
          : null
      $('acceptance-indicators').innerHTML +=
        '<div class="gate-indicator supporting-summary"><div class="indicator-heading"><h3>Configured structural measurement</h3>' +
        tag(
          facts ? (facts.complete ? 'Reported complete' : 'Partial measurement') : 'Unavailable',
          facts?.complete ? 'muted' : 'warn',
        ) +
        '</div><p class="indicator-note">' +
        (maximum === null
          ? 'No maximum depth recorded.'
          : 'Maximum recorded depth <strong>' +
            n(maximum) +
            '</strong>; configured limit <strong>' +
            n(structural.maxDepth) +
            '</strong>.') +
        '</p><p class="indicator-note">' +
        e(structural.metric) +
        ' · ' +
        (facts ? facts.regions.length + ' recorded regions' : 'No structural facts') +
        '. Gate findings above retain the requirement’s verdict.</p></div>'
    }
    const requiredRunners = [
      ...new Map(
        [...(D.runners || []), ...(D.config.runners || [])].map((requirement) => [
          requirement.id,
          requirement,
        ]),
      ).values(),
    ]
    if (requiredRunners.length) {
      const matching = requiredRunners.filter(
        (requirement) =>
          D.runnerEvidenceStates.find((item) => item.id === requirement.id)?.state === 'matched',
      ).length
      $('acceptance-indicators').innerHTML +=
        '<div class="gate-indicator supporting-summary"><div class="indicator-heading"><h3>Configured supporting runners</h3><strong>' +
        matching +
        ' / ' +
        requiredRunners.length +
        ' current results</strong></div><div class="supporting-runner-list">' +
        requiredRunners
          .map((requirement) => {
            const state =
              D.runnerEvidenceStates.find((item) => item.id === requirement.id)?.state ||
              'unavailable'
            const record =
              state === 'matched'
                ? D.runnerEvidence?.find((item) => item.id === requirement.id)
                : undefined
            const label = record
              ? 'Recorded ' + record.status
              : state === 'mismatched'
                ? 'Incompatible result'
                : 'Unavailable'
            return (
              '<div class="supporting-runner"><div><strong>' +
              e(requirement.id) +
              '</strong>' +
              tag(
                label,
                record?.status === 'passed' ? 'good' : record?.status === 'failed' ? 'bad' : 'warn',
              ) +
              '</div><p>' +
              e(requirement.adapter) +
              (record
                ? ' · ' +
                  record.passed +
                  '/' +
                  record.total +
                  ' supporting checks passed · ' +
                  record.failed +
                  ' failed · ' +
                  record.skipped +
                  ' skipped' +
                  (!record.complete ? ' · partial' : '')
                : ' · No compatible result for this invocation') +
              '</p></div>'
            )
          })
          .join('') +
        '</div><p class="indicator-note">Supporting results stay separate from product observations and never earn allowance.</p></div>'
    }
    const worst = [...D.files].sort((a, b) => sum(naked(b)) - sum(naked(a)))[0],
      shared = [...D.files].sort((a, b) => roots(b).length - roots(a).length)[0],
      missing = D.bindings.filter(
        (b) => !b.handler && D.features.some((f) => f.actions.includes(b.action)),
      )
    $('insights').innerHTML =
      (worst
        ? '<button type="button" class="insight" data-unrooted-file="' +
          e(worst.path) +
          '" data-unrooted-kind="production"><strong>' +
          naked(worst).length +
          ' source components without links ↗</strong><span>' +
          e(worst.path) +
          ' · ' +
          n(sum(naked(worst))) +
          ' recorded component tokens</span></button>'
        : '') +
      (shared
        ? '<button type="button" class="insight" data-file="' +
          e(shared.path) +
          '"><strong>' +
          roots(shared).length +
          ' specification files ↗</strong><span>' +
          e(shared.path) +
          ' · ' +
          n(shared.tokens) +
          ' full retained tokens</span></button>'
        : '') +
      '<button type="button" class="insight" data-binding-gaps><strong>' +
      missing.length +
      ' actions without handlers ↗</strong><span>Inspect registrations and current recorded observations.</span></button>'
  }
  function renderScatter() {
    const files = D.files.filter(sourceFile)
    if (!files.length) {
      $('file-scatter').innerHTML =
        '<p class="empty-state">No source-role components were recorded.</p>'
      $('mobile-file-plot').innerHTML = ''
      return
    }
    const w = 720,
      h = 345,
      left = 58,
      right = 25,
      top = 52,
      bottom = 66,
      xDomain = niceDomain(Math.max(...files.map((f) => f.tokens))),
      yDomain = niceDomain(Math.max(...files.map((f) => roots(f).length))),
      maxX = xDomain.max,
      maxY = yDomain.max
    const x = (v: number) => left + ((w - left - right) * v) / maxX
    const y = (v: number) => h - bottom - ((h - top - bottom) * v) / maxY
    const ticksX = xDomain.ticks
    const ticksY = yDomain.ticks
    $('file-scatter').innerHTML =
      `<svg viewBox="0 0 ${w} ${h}" data-domain-x="${maxX}" data-domain-y="${maxY}" role="group" aria-label="Full file tokens by linked specification files. Files containing collected non-test, non-binding declarations; exact values in the table below."><text x="${left}" y="15" class="axis-title">Specification files with links</text>${ticksY.map((v) => `<line x1="${left}" x2="${w - right}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/><text x="${left - 15}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}${ticksX.map((v) => `<text x="${x(v)}" y="${h - bottom + 26}" text-anchor="middle">${axisNumber(v)}</text>`).join('')}<text x="${(w + left - right) / 2}" y="${h - 8}" text-anchor="middle" class="axis-title">Whole-file retained tokens</text>${files
        .map((f) => {
          const xx = x(f.tokens),
            yy = y(roots(f).length),
            bad = naked(f).length
          const label = f.path.split('/').pop()
          return `<g role="button" tabindex="0" data-file="${e(f.path)}" aria-label="${e(f.path)}, ${n(f.tokens)} full tokens, ${roots(f).length} specifications, ${n(sum(naked(f)))} tokens in components without links" aria-pressed="${state.file === f.path}" class="scatter-point ${bad ? 'has-unrooted' : ''} ${state.file === f.path ? 'is-selected' : ''}"><circle cx="${xx}" cy="${yy}" r="9"/><circle class="selection-ring" cx="${xx}" cy="${yy}" r="15"/>${
            [...files]
              .sort((a, b) => b.tokens - a.tokens)
              .slice(0, 4)
              .some((g) => g.path === f.path)
              ? `<text x="${xx + (xx > w - 150 ? -14 : 14)}" y="${yy - 14}" text-anchor="${xx > w - 150 ? 'end' : 'start'}">${e(label)}</text>`
              : ''
          }<title>${e(f.path)}</title></g>`
        })
        .join('')}</svg>`
    $('mobile-file-plot').innerHTML = [...files]
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5)
      .map(
        (f) =>
          `<button type="button" class="root-row" data-file="${e(f.path)}" aria-pressed="${state.file === f.path}"><span class="path">${e(f.path)}</span><strong>${n(f.tokens)}</strong><span class="caption">${roots(f).length} specifications · ${n(sum(naked(f)))} tokens without spec links</span></button>`,
      )
      .join('')
  }
  function renderFileInspector() {
    if (!D.files.length) {
      $('file-inspector').innerHTML = '<p class="empty-state">No indexed files were recorded.</p>'
      return
    }
    const f = file(state.file),
      all = cs(f),
      view = viewFor(f),
      linked = all.filter((c) => c.features.length),
      without = naked(f, 'all'),
      fileSpecs = associations(f)
    const visible = all
      .filter(
        (c) =>
          view.scope === 'all' ||
          (view.scope === 'unlinked' && !c.features.length) ||
          (view.scope.startsWith('spec:') && c.features.includes(view.scope.slice(5))),
      )
      .sort((a, b) => b.tokens - a.tokens)
    if (!visible.some((c) => c.id === view.declaration)) view.declaration = visible[0]?.id
    const selected = component(view.declaration)
    const scopeLabel =
      view.scope === 'all'
        ? 'All components'
        : view.scope === 'unlinked'
          ? 'Without specification links'
          : feature(view.scope.slice(5)).path
    $('workspace-summary').textContent =
      `${f.path} · ${n(f.tokens)} full tokens · ${all.length ? linked.length + '/' + all.length + ' components linked' : 'no components reported'}`
    let detail = all.length
      ? '<div class="empty-state">No components match this scope. Choose All or another specification.</div>'
      : '<div class="empty-state">No components are reported for this file. This does not mean analysis failed or the file is unused. Its whole-file cost remains charged.</div>'
    if (selected) {
      const related = D.features.filter((g) => selected.features.includes(g.id))
      const exact = new Set(D.ancestry[selected.id] || [])
      const choices = related.flatMap((g) => g.checks).filter((c) => exact.has(c.id))
      const local = view.scope.startsWith('spec:')
        ? choices.filter((c) => c.file === feature(view.scope.slice(5)).path)
        : choices
      const observation = local.find((c) => c.id === view.check) || local[0]
      view.check = observation?.id
      const route =
        observation && selected.id !== D.registry
          ? sourcePath(observation.action, selected.id)
          : null
      const outgoing = uniq(selected.calls).map(component).filter(Boolean)
      const incoming = D.components.filter((c) => c.calls.includes(selected.id))
      detail = `<div class="workspace-selection"><p class="eyebrow">SELECTED COMPONENT</p><h4>${e(componentName(selected))}</h4><p class="caption">${e(selected.file)}:${selected.line} · ${n(selected.tokens)} component tokens</p>${tag(selected.features.length ? 'Has specification links' : 'No specification link', selected.features.length ? '' : 'warn')}</div>`
      if (!selected.features.length)
        detail +=
          '<p class="declaration-question">No specification link is reported for this component.</p><p class="caption">Investigate whether it supports a real product promise missing from the specifications, is obsolete, or can be simplified. Its size is not a verified deletion saving.</p>'
      else
        detail += `<p class="caption">Choose one observation to explain this link. The file stays in view.</p><label class="observation-picker">Observation explaining this link<select data-workspace-observation aria-label="Observation explaining this component's specification link">${local.map((c) => `<option value="${e(c.id)}" ${observation?.id === c.id ? 'selected' : ''}>${e(c.file)}:${c.line} · ${e(c.action)} → ${e(c.selector)}</option>`).join('')}</select></label>${observation ? `<div class="selected-observation"><p class="eyebrow">ONE SELECTED OBSERVATION</p><p class="path">${e(observation.file)}:${observation.line}</p><p><code>${e(observation.action)}</code> expects <code>${e(observation.selector)}</code> = <code>${e(JSON.stringify(observation.expected))}</code></p><p>Recorded result: ${evidenceTag(statusFor(observation))}</p>${resultFor(observation)?.error ? `<p class="caption">${e(resultFor(observation)?.error)}</p>` : ''}</div>` : ''}`
      if (route) {
        const startsAtRegistry = route[0] === D.registry
        detail += `<details class="static-path"><summary>Show this static reference path · ${route.length} component${route.length === 1 ? '' : 's'}</summary><p class="caption">${startsAtRegistry ? 'This path starts at the configured registry through module initialization.' : 'This path starts at the action’s registered handler.'} These references are static, not a runtime call trace.</p><ol class="relation-path">${route
          .map((id, i) => {
            const c = component(id)
            return `<li class="path-node"><strong>${e(componentName(c))}</strong><span class="caption">${e(c.file)}:${c.line}${i === 0 ? (startsAtRegistry ? ' · registry initialization' : ' · action handler') : i === route.length - 1 ? ' · selected component' : ''}</span></li>`
          })
          .join('')}</ol></details>`
      } else if (selected.id === D.registry && selected.features.length)
        detail +=
          '<p class="caption">The action registry is explicitly associated with required observations. That attachment does not link every registered handler.</p>'
      else if (selected.kind === 'test' && selected.features.length)
        detail +=
          '<p class="caption">This test-role component has an inherited specification association. No forward handler path or test execution is implied.</p>'
      else if (selected.features.length)
        detail +=
          '<p class="caption">An exact specification association is recorded, but no eligible forward path is available in these facts. The recorded association and observation remain visible.</p>'
      if (outgoing.length || incoming.length) {
        const group = (title: string, direction: string, items: Component[]) =>
          `<div class="reference-group" data-reference-direction="${direction}"><h5>${title} · ${items.length}</h5><div class="related">${items.length ? items.map((c) => `<button type="button" class="text-link" data-workspace-dependency="${e(c.id)}"><strong>${e(componentName(c))}</strong><span>${e(c.file)}:${c.line} · ${n(c.tokens)} component tokens</span></button>`).join('') : '<p class="caption">None reported.</p>'}</div></div>`
        detail += `<details class="related-code"><summary>Explore connected components · ${uniq([...outgoing, ...incoming].map((c) => c.id)).length}</summary><p class="caption">Trace what this component depends on and what references it before changing it. These are recorded source references, not a runtime trace or proof that code can be removed.</p>${group('This declaration references', 'outgoing', outgoing)}${group('Referenced by', 'incoming', incoming)}</details>`
      }
    }
    $('file-inspector').innerHTML =
      `<div class="workspace-header"><div><p class="eyebrow">FILE WORKSPACE</p><h3 class="path">${e(f.path)}</h3>${state.fileHistory.length ? `<button type="button" class="text-link" data-workspace-back>← Back to ${e(state.fileHistory[state.fileHistory.length - 1])}</button>` : ''}</div><div class="workspace-totals"><strong>${n(f.tokens)} full retained tokens</strong><span>${linked.length} linked components · ${without.length} without links</span></div></div><div class="workspace-toolbar"><div class="workspace-scope" aria-label="Component scope"><button type="button" data-workspace-scope="all" aria-pressed="${view.scope === 'all'}">All (${all.length})</button><button type="button" data-workspace-scope="unlinked" aria-pressed="${view.scope === 'unlinked'}">Without links (${without.length})</button></div><fieldset class="workspace-specs"><legend>Linked to specification</legend><div class="workspace-spec-buttons">${fileSpecs.map((id) => `<button type="button" data-workspace-scope="spec:${e(id)}" aria-pressed="${view.scope === 'spec:' + id}">${e(feature(id).name)} (${all.filter((c) => c.features.includes(id)).length})</button>`).join('') || '<span class="caption">No specification links reported</span>'}</div></fieldset><p class="caption">Showing: ${e(scopeLabel)} · component costs omit file overhead; they do not partition the full ${n(f.tokens)} tokens.</p></div><div class="workspace-grid"><div class="declaration-list"><table><thead><tr><th>Component</th><th class="num">Tokens</th><th class="num">Specs</th></tr></thead><tbody>${visible.map((c) => `<tr class="${selected?.id === c.id ? 'selected' : ''}"><td><button type="button" class="declaration-row" data-workspace-declaration="${e(c.id)}" aria-pressed="${selected?.id === c.id}">${e(componentName(c))}<small>Line ${c.line}${!c.features.length ? ' · no spec link' : ''}</small></button></td><td class="num">${n(c.tokens)}</td><td class="num">${c.features.length}</td></tr>`).join('') || '<tr><td colspan="3" class="empty-state">No components in this scope.</td></tr>'}</tbody></table></div><div class="declaration-detail">${detail}</div></div><div class="workspace-return"><button type="button" class="text-link" data-workspace-return>← Return to ${e(originLabel(state.workspaceOrigin))}</button>${selected?.features.length ? selected.features.map((id) => `<button type="button" class="text-link" data-feature="${e(id)}">Open ${e(feature(id).name)} overview ↗</button>`).join('') : ''}</div>`
  }

  function renderFileTable() {
    let files = D.files.filter(
      (f) =>
        f.path.toLowerCase().includes(state.query.toLowerCase()) &&
        (state.filter === 'all' ||
          (state.filter === 'production' && sourceFile(f)) ||
          (state.filter === 'unrooted' && naked(f).length) ||
          (state.filter === 'shared' && roots(f).length > 1) ||
          (state.filter === 'no-components' && !cs(f).length)),
    )
    files.sort(
      state.sort === 'path'
        ? (a, b) => a.path.localeCompare(b.path)
        : state.sort === 'unrooted'
          ? (a, b) => sum(naked(b, 'all')) - sum(naked(a, 'all'))
          : state.sort === 'breadth'
            ? (a, b) => associations(b).length - associations(a).length
            : (a, b) => b.tokens - a.tokens,
    )
    $('file-rows').innerHTML = files.length
      ? files
          .map(
            (f) =>
              `<tr class="${state.file === f.path ? 'selected' : ''}"><td>${fileButton(f.path)}</td><td class="num">${n(f.tokens)}</td><td class="num">${cs(f).length ? associations(f).length : '—'}</td><td class="num">${cs(f).length ? n(sum(naked(f, 'all'))) : '—'}</td><td>${tag(fileStatus(f), naked(f, 'all').length ? 'warn' : '')}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="5" class="empty-state">No maintained files match. Clear the search or choose another filter.</td></tr>'
    $('file-subtotal').textContent =
      `${files.length} of ${D.files.length} files · ${n(sum(files))} tokens in view. Global retained cost stays ${n(retained)} / ${n(ceiling)} ceiling. Link counts include inherited test links; these cannot root unrelated source components.`
  }

  function renderFeatures() {
    const resolved = D.features
      .filter((f) => !featureReason(f))
      .sort((a, b) =>
        state.featureSort === 'light'
          ? footprint(a).tokens - footprint(b).tokens
          : footprint(b).tokens - footprint(a).tokens,
      )
    const incomplete = D.features.filter((f) => featureReason(f))
    const max = Math.max(1, ...D.features.map((f) => footprint(f).tokens))
    const row = (f: Feature, partial: boolean) => {
      const s = footprint(f)
      return `<button type="button" class="feature-row ${partial ? 'partial' : ''}" data-feature="${e(f.id)}" aria-pressed="${state.feature === f.id}"><span class="feature-label"><strong>${e(f.name)}</strong><small class="path">${e(f.path)}</small></span><span class="stack-track" aria-hidden="true"><span class="exclusive" style="width:${(100 * s.exclusive) / max}%"></span><span class="shared" style="width:${(100 * s.shared) / max}%"></span></span><span class="feature-value">${partial ? (s.components.length ? n(s.tokens) + ' known' : 'Not established') : n(s.tokens)}<small>${partial ? e(featureReason(f) || 'Partial source facts') : n(s.exclusive) + ' exclusive · ' + n(s.shared) + ' shared'}</small></span></button>`
    }
    $('feature-chart').innerHTML =
      resolved.map((f) => row(f, false)).join('') +
      `<p class="ranking-divider">Partial footprints · known portions are not complete rankings</p>` +
      incomplete.map((f) => row(f, true)).join('')
    document
      .querySelectorAll<HTMLElement>('[data-feature-sort]')
      .forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.featureSort === state.featureSort)),
      )
    $('feature-section-summary').textContent =
      D.features.length + ' specification files · size, sharing and exact links'
    renderFeatureInspector()
    renderFeatureMap()
  }

  function renderFeatureMap() {
    const complete = D.features.filter((f) => !featureReason(f))
    const w = 720,
      left = 58,
      right = 30,
      bottom = 64
    let h = 330,
      top = 90
    const xDomain = niceDomain(Math.max(0, ...complete.map((f) => footprint(f).tokens))),
      yDomain = niceDomain(Math.max(0, ...complete.map((f) => footprint(f).files.length)))
    const maxX = xDomain.max,
      maxY = yDomain.max
    const x = (value: number) => left + ((w - left - right) * value) / maxX,
      y = (value: number) => h - bottom - ((h - top - bottom) * value) / maxY
    const points = complete.map((f, i) => {
      const st = footprint(f)
      return { f, st, index: i + 1, x: x(st.tokens), y: y(st.files.length) }
    })
    const groups = [],
      proximity = (64 * w) / ($('feature-scatter').clientWidth || w)
    for (const point of [...points].sort(
      (a, b) => a.st.files.length - b.st.files.length || a.x - b.x,
    )) {
      const group = groups[groups.length - 1],
        last = group?.[group.length - 1]
      if (last && last.st.files.length === point.st.files.length && point.x - last.x < proximity)
        group.push(point)
      else groups.push([point])
    }
    const capacity = Math.max(1, Math.floor((w - left - right - 32) / 48) + 1),
      lanes = Math.max(1, ...groups.map((group) => Math.ceil(group.length / capacity)))
    const headroom = (lanes - 1) * 36
    h += headroom
    top += headroom
    for (const point of points) point.y = y(point.st.files.length)
    const plot = groups
      .flatMap((group) =>
        group.map(({ f, st, index, x: xx, y: yy }, i) => {
          const offset = group.length > 1,
            midpoint = (group[0].x + group[group.length - 1].x) / 2
          const lane = Math.floor(i / capacity),
            laneStart = lane * capacity,
            laneCount = Math.min(capacity, group.length - laneStart),
            span = (laneCount - 1) * 48
          const start = Math.max(left + 16, Math.min(w - right - 16 - span, midpoint - span / 2))
          const labelX = offset ? start + (i - laneStart) * 48 : xx
          const labelY = offset ? yy - 32 - lane * 36 : yy
          return `<g class="feature-map-point scatter-point ${state.feature === f.id ? 'is-selected' : ''}" role="button" tabindex="0" data-feature="${e(f.id)}" aria-pressed="${state.feature === f.id}" aria-label="${index}. ${e(f.path)}: ${n(st.tokens)} source component tokens, ${st.files.length} distinct files">${offset ? `<polyline class="feature-point-leader" points="${xx},${yy} ${labelX},${labelY + 13}"/>` : ''}<circle class="feature-source-dot" data-feature-location="${e(f.id)}" data-tokens="${st.tokens}" data-files="${st.files.length}" cx="${xx}" cy="${yy}" r="3"/><circle class="feature-point-badge" data-feature-label="${e(f.id)}" cx="${labelX}" cy="${labelY}" r="13"/><circle class="selection-ring" cx="${labelX}" cy="${labelY}" r="19"/><text class="feature-marker-number" x="${labelX}" y="${labelY}">${index}</text></g>`
        }),
      )
      .join('')
    $('feature-scatter').innerHTML =
      `<svg viewBox="0 0 ${w} ${h}" data-domain-x="${maxX}" data-domain-y="${maxY}" role="group" aria-label="Specification implementation size versus distinct files touched. Each numbered label selects one specification. Small dots preserve exact positions; nearby labels move for readability. Missing-handler footprints are not plotted."><text x="${left}" y="18" class="axis-title">Distinct files touched</text>${yDomain.ticks.map((i) => `<line x1="${left}" x2="${w - right}" y1="${y(i)}" y2="${y(i)}" class="grid-line"/><text x="${left - 14}" y="${y(i) + 4}" text-anchor="end">${i}</text>`).join('')}${xDomain.ticks.map((v) => `<text x="${x(v)}" y="${h - bottom + 25}" text-anchor="middle">${axisNumber(v)}</text>`).join('')}<text x="${(w + left - right) / 2}" y="${h - 8}" text-anchor="middle" class="axis-title">Reachable source component tokens</text>${plot}</svg>`
    $('feature-map-key').innerHTML = points
      .map(
        ({ f, st, index }) =>
          `<button type="button" class="feature-key-row" data-feature="${e(f.id)}" aria-pressed="${state.feature === f.id}"><span class="feature-key-number" aria-hidden="true">${index}</span><span><strong>${e(f.name)}</strong><span class="caption">${n(st.tokens)} component tokens · ${st.files.length} files touched</span></span></button>`,
      )
      .join('')
    $('feature-map-mobile').innerHTML =
      `<table><caption class="sr-only">Complete specification footprints</caption><thead><tr><th>Specification</th><th>Declaration tokens</th><th>Files touched</th></tr></thead><tbody>${complete.map((f) => `<tr><td>${featureButton(f.id, f.name)}</td><td>${n(footprint(f).tokens)}</td><td>${footprint(f).files.length}</td></tr>`).join('')}</tbody></table>`
    $('feature-map-incomplete').innerHTML =
      `<strong>Partial or unspecified footprints are not plotted as complete.</strong><div class="related">${D.features
        .filter((f) => featureReason(f))
        .map((f) =>
          featureButton(
            f.id,
            `${f.name} · ${footprint(f).tokens ? n(footprint(f).tokens) + ' component tokens known' : 'no complete measurement'} · ${e(featureReason(f) || 'Partial footprint')}`,
          ),
        )
        .join('')}</div>`
  }
  function renderFeatureInspector() {
    if (!D.features.length) {
      $('feature-inspector').innerHTML =
        '<p class="empty-state">No indexed specifications were recorded.</p>'
      return
    }
    const f = feature(state.feature),
      s = footprint(f)
    const partial = featureReason(f)
    $('feature-inspector').innerHTML =
      `<p class="eyebrow">SELECTED SPECIFICATION</p><h3 class="detail-title">${e(f.name)}</h3><p class="path caption">${e(f.path)}</p>${tag(partial ? partial : 'Structural footprint resolved', partial ? 'warn' : 'good')}${stat('Reachable source component tokens', partial ? (s.components.length ? n(s.tokens) + ' known' : 'Not established') : n(s.tokens))}${stat(partial ? 'Known exclusive / shared tokens' : 'Exclusive / shared tokens', partial && !s.components.length ? 'Not established' : n(s.exclusive) + ' / ' + n(s.shared))}${stat(partial ? 'Known full cost of files touched' : 'Full cost of files touched', partial && !s.files.length ? 'Not established' : n(sum(s.files)) + ' tokens')}${stat('Actions bound', f.actions.length - s.missing.length + ' / ' + f.actions.length)}<p class="chart-note">Touched-file cost includes unrelated declarations and overhead. Component costs remain separate from complete file accounting. Neither is a verified savings estimate.</p><h4>Actions &amp; bindings</h4>${f.actions
        .map((a) => {
          const b = binding(a)
          return `<div class="binding-detail"><span class="mono">${e(a)}</span>${b?.handler ? componentButton(component(b.handler)) : tag('Missing binding', 'warn')}</div>`
        })
        .join(
          '',
        )}<h4>Files reached</h4><div class="related">${s.files.length ? s.files.map((g) => fileButton(g.path, `${g.path} · ${n(sum(s.components.filter((c) => c.file === g.path)))} component tokens`)).join('') : '<p class="caption">No complete implementation footprint is established. Inspect bindings, compiled observations and analysis findings.</p>'}</div><h4>Required observations</h4>${f.checks.map((c) => `<div class="observation"><span class="mono">${e(c.selector)}</span>${evidenceTag(statusFor(c))}<small class="caption">${e(c.action)} · line ${c.line}${resultFor(c)?.error ? ' · ' + e(resultFor(c)?.error) : ''}</small></div>`).join('')}<p class="caption">A specification link is a static connection; the observed response result is shown separately.</p>`
  }
  function renderMatrix() {
    const files = D.files.filter(sourceFile)
    $('feature-matrix').innerHTML =
      `<table><caption class="sr-only">Source component tokens reached by specification and file</caption><thead><tr><th>File with source components</th><th class="num">Full file cost</th>${D.features.map((f) => `<th>${featureButton(f.id, f.id)}</th>`).join('')}</tr></thead><tbody>${files
        .map(
          (g) =>
            `<tr><td>${fileButton(g.path)}</td><td class="num">${n(g.tokens)}</td>${D.features
              .map((f) => {
                const linked = prod(g).filter((c) => c.features.includes(f.id)),
                  v = sum(linked)
                return `<td class="cell">${linked.length ? `<button type="button" data-cell-file="${e(g.path)}" data-cell-feature="${e(f.id)}" style="--cell-strength:${Math.min(0.65, 0.12 + v / 4000)}" aria-label="${e(f.name)} reaches ${n(v)} component tokens in ${e(g.path)}">${n(v)}</button>` : featureReason(f) ? '<span title="The implementation footprint is not completely established">?</span>' : '<span aria-label="No linked source components">—</span>'}</td>`
              })
              .join('')}</tr>`,
        )
        .join('')}</tbody></table>`
  }
  function renderUnrooted() {
    const costs = (f: File) => {
      const declarations = cs(f).filter(
        (c) => state.unrootedKind === 'all' || c.kind === state.unrootedKind,
      )
      return {
        declarations,
        linked: sum(declarations.filter((c) => c.features.length)),
        without: sum(declarations.filter((c) => !c.features.length)),
        total: sum(declarations),
      }
    }
    const files = D.files
      .filter((f) => naked(f, state.unrootedKind).length > 0)
      .sort((a, b) => {
        const x = costs(a),
          y = costs(b)
        return (
          (state.unrootedSort === 'share'
            ? (x.total ? x.linked / x.total : Infinity) - (y.total ? y.linked / y.total : Infinity)
            : 0) ||
          y.without - x.without ||
          a.path.localeCompare(b.path)
        )
      })
    const total = files.reduce((a, f) => a + costs(f).without, 0),
      count = files.reduce((a, f) => a + naked(f, state.unrootedKind).length, 0)
    $('unrooted-total').textContent =
      `${n(total)} tokens without links · ${count} components across ${files.length} files`
    if (!files.some((f) => f.path === state.unrootedFile)) state.unrootedFile = files[0]?.path || ''
    $('unrooted-ranking').innerHTML = files.length
      ? files
          .map((f, i) => {
            const c = costs(f),
              missing = naked(f, state.unrootedKind).length
            return `<button type="button" class="root-row unlinked-file-row" data-unrooted-file="${e(f.path)}" aria-pressed="${state.unrootedFile === f.path}"><span class="rank-index">${String(i + 1).padStart(2, '0')}</span><span class="path">${e(f.path)}</span><strong>${n(c.without)}<small>without links</small></strong><span class="declaration-link-track" role="img" aria-label="${e(f.path)}: ${n(c.linked)} linked and ${n(c.without)} without links, out of ${n(c.total)} recorded component tokens in the selected role."><i class="linked" style="width:${c.total ? (100 * c.linked) / c.total : 0}%"></i><i class="unlinked" style="width:${c.total ? (100 * c.without) / c.total : 0}%"></i></span><span class="unlinked-row-meta"><span>Linked ${n(c.linked)} (${e(share(c.linked, c.total))}) · Without links ${n(c.without)} (${e(share(c.without, c.total))})</span><span>${missing} of ${c.declarations.length} components lack links · ${n(c.total)} component tokens · ${n(f.tokens)} full file tokens</span></span></button>`
          })
          .join('')
      : '<div class="empty-state">No components in this role have measured tokens without specification links. Files without reported components have no link ratio; their full cost remains charged.</div>'
    const f = file(state.unrootedFile)
    $('unrooted-inspector').textContent = f
      ? `${f.path}: ${naked(f, state.unrootedKind).length} components without links · ${n(costs(f).without)} component tokens. Select a row to review those components; this file can also contain linked components.`
      : 'No recorded component gaps in this role.'
  }
  function renderSettings() {
    $('config-origin').textContent = 'Effective project settings'
    $('scope-summary').textContent =
      D.files.length +
      ' unique files · ' +
      D.config.maintained.length +
      ' maintained entries · expand to inspect'
    $('maintained-entries').innerHTML = D.config.maintained
      .map((entry) => {
        const fs = matches(entry),
          overlap = fs.filter(
            (f) =>
              D.config.maintained.filter((other) => matches(other).some((g) => g.path === f.path))
                .length > 1,
          )
        return `<button type="button" class="entry-row" data-entry="${e(entry)}" aria-pressed="${state.entry === entry}"><span class="mono">${e(entry)}</span><strong>${fs.length} files</strong><span>${n(sum(fs))} tokens</span>${overlap.length ? tag(overlap.length + ' overlapping', 'warn') : !fs.length ? tag('Empty entry', 'muted') : ''}</button>`
      })
      .join('')
    const rawCount = D.config.maintained.reduce((a, p) => a + matches(p).length, 0)
    $('inventory-union').innerHTML =
      `<strong>${D.files.length} unique files · ${n(retained)} tokens</strong><span class="caption">${rawCount} entry matches → ${rawCount - D.files.length} duplicate match removed from global accounting</span>`
    const fs = matches(state.entry)
    $('entry-inspector').innerHTML =
      `<p class="eyebrow">INDEXED BY THIS ENTRY</p><h3 class="detail-title mono">${e(state.entry)}</h3>${stat('Indexed files', fs.length)}${stat('Matched retained cost', n(sum(fs)) + ' tokens')}<div class="match-list">${
        fs.length
          ? fs
              .map((f) => {
                const others = D.config.maintained.filter(
                  (p) => p !== state.entry && matches(p).some((g) => g.path === f.path),
                )
                return `<div>${fileButton(f.path)}<span class="caption">${n(f.tokens)} tokens${others.length ? ' · also matched by ' + others.map(e).join(', ') : ''}</span></div>`
              })
              .join('')
          : '<p class="empty-state">No retained files in this snapshot match this entry. A failed inventory collection is a separate error, not a measured zero.</p>'
      }</div>`
    $('config-code').innerHTML = highlight(
      JSON.stringify(
        {
          maintained: D.config.maintained,
          exclude: D.config.exclude,
          bindings: D.config.bindings,
          policy: D.config.policy,
          runners: D.config.runners,
        },
        null,
        2,
      ),
      'json',
    )
    $('config-source').textContent =
      'Source: ' +
      D.config.origin +
      ' · effective policy: ' +
      D.provenance.origin.policy +
      ' · base: ' +
      (D.provenance.base || 'none')
    $('exclusion-rules').innerHTML = (D.config.exclude ?? [])
      .map((rule) => `<div class="excluded-row"><code>${e(rule)}</code></div>`)
      .join('')
    $('policy-formula').innerHTML = highlight(
      `ceiling = floor(min(hardLimit,\n  bootstrap + perDoubling ×\n  log2(max(1, surface / bootstrapSurface))))\n\nbootstrap       ${n(policy.bootstrap)}\nbootstrapSurface  ${policy.bootstrapSurface}\nperDoubling      ${n(policy.perDoubling)}\nhardLimit       ${n(policy.hardLimit)}\nsurface          ${D.surface} pairs\n\nceiling         ${n(ceiling)} tokens`,
      'policy',
    )
  }
  function renderBindings() {
    const required = uniq(D.features.flatMap((f) => f.actions)),
      all = uniq([...required, ...D.bindings.map((b) => b.action)])
    let actions = all.filter(
      (a) =>
        state.bindingFilter === 'all' ||
        (state.bindingFilter === 'unbound' && !binding(a)?.handler) ||
        (state.bindingFilter === 'unused' && !required.includes(a)) ||
        (state.bindingFilter === 'issues' &&
          allChecks.some((c) => c.action === a && statusFor(c) !== 'passed')),
    )
    $('binding-path').textContent = D.config.bindings
    $('bindings-section-summary').textContent =
      required.filter((a) => !binding(a)?.handler).length + ' required actions without handlers'
    $('binding-summary').textContent =
      `${required.filter((a) => binding(a)?.handler).length}/${required.length} required actions bound · ${all.filter((a) => !required.includes(a)).length} unused registration`
    $('binding-rows').innerHTML = actions.length
      ? actions
          .map((a) => {
            const b = binding(a),
              fs = D.features.filter((f) => f.actions.includes(a)),
              checks = allChecks.filter((c) => c.action === a)
            return `<tr><td class="mono">${e(a)}</td><td>${b?.handler ? componentButton(component(b.handler)) : '<span class="muted">No handler registered</span>'}</td><td><div class="related">${fs.length ? fs.map((f) => featureButton(f.id, f.id)).join('') : '<span class="caption">No specification uses this action</span>'}</div></td><td>${!b?.handler ? tag('Missing', 'warn') : !fs.length ? tag('Unused', 'muted') : tag('Bound', 'good')}</td><td>${
              checks.length
                ? uniq(checks.map(statusFor))
                    .map(
                      (s) =>
                        `<span class="evidence-count">${evidenceTag(s)} ${checks.filter((c) => statusFor(c) === s).length}</span>`,
                    )
                    .join('')
                : '<span class="caption">No observations compiled</span>'
            }${
              checks.some((c) => resultFor(c)?.error)
                ? `<details class="result-errors"><summary>Result details</summary>${checks
                    .filter((c) => resultFor(c)?.error)
                    .map(
                      (c) =>
                        `<p class="caption"><code>${e(c.selector)}</code> · ${e(resultFor(c)?.error)}</p>`,
                    )
                    .join('')}</details>`
                : ''
            }</td></tr>`
          })
          .join('')
      : '<tr><td colspan="5" class="empty-state">No actions match this filter.</td></tr>'
    $('binding-result').textContent =
      `${actions.length} of ${all.length} actions shown. An unused action registration does not give its handler a specification link.`
  }
  function announce(message: string) {
    $('announcement').textContent = message
  }

  function focusAttr(container: string, attribute: string, value: string) {
    const target = Array.from($(container).querySelectorAll<HTMLElement>('button')).find(
      (b) => b.getAttribute(attribute) === value,
    )
    if (target) target.focus({ preventScroll: true })
  }
  function showFile(
    path: string,
    componentId?: string | null,
    origin: string = 'files',
    intent?: string,
  ) {
    if (!file(path)) {
      announce('This file was not indexed in the snapshot.')
      return
    }
    state.file = path
    state.workspaceOrigin = $(origin + '-workspace-slot') ? origin : 'files'
    const view = viewFor(file(path))
    if (intent) view.scope = intent
    if (componentId) {
      view.declaration = componentId
      if (!intent) view.scope = 'all'
    }
    $('file-workspace').open = true
    $(`${state.workspaceOrigin}-workspace-slot`).appendChild($('file-workspace'))
    renderFileInspector()
    renderScatter()
    renderFileTable()
    renderInventory()
    focusInspector('file-inspector')
    announce('Inspecting ' + path + ' in the ' + originLabel(state.workspaceOrigin) + ' workspace')
  }
  function returnToChart() {
    $('file-workspace').open = false
    const origin = state.workspaceOrigin
    navigate(origin)
    const candidates = Array.from(
      $(origin).querySelectorAll<HTMLElement>('[data-file],[data-unrooted-file]'),
    )
    const target = candidates.find(
      (b) => b.dataset.file === state.file || b.dataset.unrootedFile === state.file,
    )
    if (target) target.focus({ preventScroll: true })
    else {
      $(origin).tabIndex = -1
      $(origin).focus({ preventScroll: true })
    }
    announce('Returned to ' + originLabel(origin))
  }
  function focusInspector(id: string) {
    const heading = $(id).querySelector('h3')
    if (heading) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
      heading.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    }
  }
  function navigate(id: string) {
    const disclosure = {
      features: 'feature-disclosure',
      settings: 'settings-disclosure',
      bindings: 'bindings-disclosure',
    }[id]
    if (disclosure) $(disclosure).open = true
    $(id).scrollIntoView({ block: 'start', behavior: 'auto' })
    document
      .querySelectorAll<HTMLElement>('nav a')
      .forEach((a) =>
        a.setAttribute('aria-current', a.getAttribute('href') === '#' + id ? 'location' : 'false'),
      )
  }
  document.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null
    if (!target) return
    const nav = target.closest('nav a')
    if (nav) {
      const target = (nav.getAttribute('href') || '').slice(1)
      if ($(target)) navigate(target)
      return
    }
    const b = target.closest('button,[role="button"]') as HTMLElement | null
    if (!b) return
    const origin = b.closest('section')?.id || state.workspaceOrigin || 'files'
    if (b.hasAttribute('data-inventory-path')) {
      state.inventoryPath = b.dataset.inventoryPath || ''
      renderInventory()
      focusAttr('inventory-breadcrumb', 'data-inventory-path', state.inventoryPath)
      return
    }
    if (b.hasAttribute('data-inventory-up')) {
      state.inventoryPath = state.inventoryPath.split('/').slice(0, -1).join('/')
      renderInventory()
      focusAttr('inventory-breadcrumb', 'data-inventory-path', state.inventoryPath)
      return
    }
    if (b.dataset.inventoryView) {
      state.inventoryView = b.dataset.inventoryView
      renderInventory()
      return
    }
    if (b.dataset.workspaceScope) {
      viewFor(file(state.file)).scope = b.dataset.workspaceScope
      renderFileInspector()
      focusAttr('file-inspector', 'data-workspace-scope', b.dataset.workspaceScope)
      return
    }
    if (b.dataset.workspaceDeclaration) {
      viewFor(file(state.file)).declaration = b.dataset.workspaceDeclaration
      renderFileInspector()
      focusAttr('file-inspector', 'data-workspace-declaration', b.dataset.workspaceDeclaration)
      return
    }
    if (b.hasAttribute('data-workspace-return')) {
      returnToChart()
      return
    }
    if (b.hasAttribute('data-workspace-back')) {
      const previous = state.fileHistory.pop()
      if (previous) showFile(previous, null, state.workspaceOrigin)
      return
    }
    if (b.dataset.workspaceDependency) {
      const c = component(b.dataset.workspaceDependency)
      if (c.file !== state.file) state.fileHistory.push(state.file)
      showFile(c.file, c.id, state.workspaceOrigin)
      return
    }
    if (b.dataset.file) {
      state.fileHistory = []
      showFile(b.dataset.file, null, origin)
      return
    }
    if (b.dataset.component) {
      const c = component(b.dataset.component)
      state.fileHistory = []
      showFile(c.file, c.id, origin)
      return
    }
    if (b.dataset.feature) {
      state.feature = b.dataset.feature
      renderFeatures()
      navigate('features')
      focusInspector('feature-inspector')
      announce('Inspecting ' + feature(state.feature).name)
      return
    }
    if (b.dataset.cellFile) {
      state.feature = b.dataset.cellFeature || state.feature
      state.fileHistory = []
      renderFeatures()
      showFile(b.dataset.cellFile, null, origin, 'spec:' + b.dataset.cellFeature)
      announce(feature(state.feature).name + ' in ' + state.file)
      return
    }
    if (b.dataset.featureSort) {
      state.featureSort = b.dataset.featureSort
      renderFeatures()
      announce(
        'Feature footprints sorted ' +
          (state.featureSort === 'heavy' ? 'heaviest' : 'lightest') +
          ' first; unresolved features separate.',
      )
      return
    }
    if (b.dataset.unrootedFile) {
      if (b.dataset.unrootedKind) {
        state.unrootedKind = b.dataset.unrootedKind
        $('unrooted-filter').value = state.unrootedKind
      }
      state.unrootedFile = b.dataset.unrootedFile
      renderUnrooted()
      showFile(
        b.dataset.unrootedFile,
        null,
        origin === 'overview' ? 'unrooted' : origin,
        'unlinked',
      )
      return
    }
    if (b.dataset.entry) {
      state.entry = b.dataset.entry
      renderSettings()
      focusInspector('entry-inspector')
      return
    }
    if (b.hasAttribute('data-show-blockers')) {
      const details = document.querySelector<HTMLDetailsElement>('.blocker-details')!
      details.open = true
      details.scrollIntoView({ block: 'nearest' })
      return
    }
    if (b.hasAttribute('data-binding-gaps')) {
      state.bindingFilter = 'unbound'
      $('binding-filter').value = 'unbound'
      renderBindings()
      navigate('bindings')
    }
  })
  document.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement | null
    if (target && target.matches('[role="button"]') && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault()
      target.click()
    }
  })
  document.addEventListener('change', (ev) => {
    const control = ev.target as HTMLSelectElement | null
    if (!control || !control.hasAttribute('data-workspace-observation')) return
    const view = viewFor(file(state.file))
    view.check = control.value
    renderFileInspector()
    const replacement = $('file-inspector').querySelector<HTMLSelectElement>(
      '[data-workspace-observation]',
    )
    if (replacement) replacement.focus({ preventScroll: true })
    announce('Selected observation ' + control.value + '; file context preserved.')
  })
  $('file-search').addEventListener('input', (ev) => {
    state.query = (ev.target as HTMLInputElement).value
    renderFileTable()
  })
  $('file-filter').addEventListener('change', (ev) => {
    state.filter = (ev.target as HTMLInputElement).value
    renderFileTable()
  })
  $('file-sort').addEventListener('change', (ev) => {
    state.sort = (ev.target as HTMLInputElement).value
    renderFileTable()
  })
  $('unrooted-filter').addEventListener('change', (ev) => {
    state.unrootedKind = (ev.target as HTMLInputElement).value
    renderUnrooted()
  })
  $('unrooted-sort').addEventListener('change', (ev) => {
    state.unrootedSort = (ev.target as HTMLInputElement).value
    renderUnrooted()
  })
  $('binding-filter').addEventListener('change', (ev) => {
    state.bindingFilter = (ev.target as HTMLInputElement).value
    renderBindings()
  })
  function downloadReport() {
    const url = URL.createObjectURL(
      new Blob(['<!doctype html>\n' + template.outerHTML], { type: 'text/html;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'bonsai-check-report.html'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    announce('Offline report downloaded.')
  }
  $('download').addEventListener('click', downloadReport)
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      renderBudgetCurve()
      renderInventory()
      renderFeatureMap()
    })
    observer.observe($('budget-curve'))
    observer.observe($('inventory-map'))
    observer.observe($('feature-scatter'))
  }
  $('verification-facts').innerHTML = highlight(
    JSON.stringify(
      {
        analysis: D.analysis,
        verification: D.verification,
        evidenceState: D.evidenceState,
        evidenceContext: D.evidence
          ? {
              schema: D.evidence.schema,
              complete: D.evidence.complete,
              fingerprint: D.evidence.fingerprint,
              profile: D.evidence.profile,
              identity: D.evidence.identity,
            }
          : null,
        structuralPolicy: D.config.policy.structural,
        controlDepth: D.controlDepth,
        runners: D.runners,
        runnerEvidence: D.runnerEvidence,
        runnerEvidenceStates: D.runnerEvidenceStates,
        commandTiming: D.timing,
        candidateTiming: D.candidateTiming,
        provenance: D.provenance,
      },
      null,
      2,
    ),
    'json',
  )
  renderOverview()
  renderScatter()
  renderFileInspector()
  renderFileTable()
  renderInventory()
  renderFeatures()
  renderMatrix()
  renderUnrooted()
  renderSettings()
  renderBindings()
}
