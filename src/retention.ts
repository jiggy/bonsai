import type { Contracts, Source, Snapshot } from './model.ts'

/** Production ancestry is established before tests are admitted. Tests cannot root production. */
export function buildSnapshot(fingerprint: string, contracts: Contracts, source: Source): Snapshot {
  const ancestry: Record<string, string[]> = Object.create(null)
  const membership: Record<string, Set<string>> = Object.create(null)
  const components = new Map(source.components.map((c) => [c.id, c]))
  const outgoing = new Map<string, string[]>()
  for (const edge of source.relationships) {
    const targets = outgoing.get(edge.from)
    if (targets) targets.push(edge.to)
    else outgoing.set(edge.from, [edge.to])
  }
  const attach = (id: string, contract: string, allowProduction: boolean): void => {
    const queue = [id]
    while (queue.length) {
      const next = queue.pop()!
      const target = components.get(next)
      if (!target || (!allowProduction && target.kind === 'production')) continue
      const existing = (ancestry[next] ??= [])
      const seen = (membership[next] ??= new Set<string>())
      if (seen.has(contract)) continue
      seen.add(contract)
      existing.push(contract)
      // The registry contains other actions too; only contracted actions establish roots.
      if (next !== source.registry) queue.push(...(outgoing.get(next) ?? []))
    }
  }
  for (const check of contracts.checks) {
    const handler = source.actions[check.action]
    if (handler) attach(handler, check.id, true)
    if (source.registry) attach(source.registry, check.id, false)
  }
  // Discover subjects through test helpers, independently of ancestry granted
  // to supporting tests. Shared assertions cannot justify unrelated callers.
  for (const component of source.components.filter((c) => c.kind === 'test')) {
    const queue = [component.id]
    const visited = new Set<string>()
    while (queue.length) {
      const subject = queue.pop()!
      if (visited.has(subject)) continue
      visited.add(subject)
      const kind = components.get(subject)?.kind
      if (kind === 'production') {
        for (const contract of ancestry[subject] ?? []) attach(component.id, contract, false)
      } else if (kind === 'test') queue.push(...(outgoing.get(subject) ?? []))
    }
  }
  return {
    fingerprint,
    contracts,
    source,
    ancestry,
    unrooted: source.components.filter((c) => !ancestry[c.id]?.length).map((c) => c.id),
  }
}

export function explain(snapshot: Snapshot, query: string) {
  const matches = snapshot.source.components.filter((c) => c.id === query || c.file === query)
  const components = new Map(
    snapshot.source.components.map((component) => [component.id, component]),
  )
  const outgoing = new Map<string, string[]>()
  for (const edge of snapshot.source.relationships) {
    const targets = outgoing.get(edge.from) ?? []
    targets.push(edge.to)
    outgoing.set(edge.from, targets)
  }
  // A predecessor tree gives one concrete shortest route, without enumerating cycles.
  const routes = (start: string, descend: (id: string) => boolean) => {
    const parents = new Map<string, string | undefined>([[start, undefined]])
    const queue = [start]
    for (let index = 0; index < queue.length; index++) {
      const from = queue[index]!
      if (from === snapshot.source.registry || !descend(from)) continue
      for (const to of outgoing.get(from) ?? []) {
        if (!components.has(to) || parents.has(to)) continue
        parents.set(to, from)
        queue.push(to)
      }
    }
    return parents
  }
  const path = (parents: Map<string, string | undefined>, target: string) => {
    if (!parents.has(target)) return undefined
    const result: string[] = []
    let next: string | undefined = target
    while (next !== undefined) {
      result.push(next)
      next = parents.get(next)
    }
    return result.reverse()
  }
  const handlerRoutes = new Map<string, Map<string, string | undefined>>()
  const productionPath = (action: string, target: string) => {
    const handler = snapshot.source.actions[action]
    if (!handler) return undefined
    let parents = handlerRoutes.get(handler)
    if (!parents) handlerRoutes.set(handler, (parents = routes(handler, () => true)))
    return path(parents, target)
  }
  const testRoutes = new Map<
    string,
    {
      support: Map<string, string | undefined>
      subjects: Map<string, string | undefined>
    }
  >()
  return matches.map((component) => {
    const contracts = snapshot.ancestry[component.id] ?? []
    const checks = snapshot.contracts.checks.filter((check) => contracts.includes(check.id))
    const verificationSubjects: {
      subject: string
      test: string
      references: string[]
      support: string[]
    }[] = []
    if (
      component.kind !== 'production' &&
      checks.length &&
      component.id !== snapshot.source.registry
    ) {
      for (const test of snapshot.source.components.filter(
        (candidate) => candidate.kind === 'test',
      )) {
        let routesForTest = testRoutes.get(test.id)
        if (!routesForTest) {
          routesForTest = {
            support: routes(test.id, (id) => components.get(id)?.kind !== 'production'),
            subjects: routes(test.id, (id) => components.get(id)?.kind === 'test'),
          }
          testRoutes.set(test.id, routesForTest)
        }
        const support = path(routesForTest.support, component.id)
        if (!support) continue
        const subjectRoutes = routesForTest.subjects
        for (const subject of subjectRoutes.keys()) {
          if (
            components.get(subject)?.kind !== 'production' ||
            !checks.some((check) => (snapshot.ancestry[subject] ?? []).includes(check.id))
          )
            continue
          verificationSubjects.push({
            subject,
            test: test.id,
            references: path(subjectRoutes, subject)!,
            support,
          })
        }
      }
    }
    const contractPaths: {
      check: string
      components: string[]
      subject?: string
      registry?: true
    }[] = []
    for (const check of checks) {
      const direct = productionPath(check.action, component.id)
      if (direct) contractPaths.push({ check: check.id, components: direct })
      else if (component.id === snapshot.source.registry)
        contractPaths.push({ check: check.id, components: [component.id], registry: true })
      else {
        const subjects = new Set(verificationSubjects.map((entry) => entry.subject))
        for (const subject of subjects) {
          if (!(snapshot.ancestry[subject] ?? []).includes(check.id)) continue
          const components = productionPath(check.action, subject)
          if (components) contractPaths.push({ check: check.id, components, subject })
        }
      }
    }
    return {
      ...component,
      contracts,
      relationships: snapshot.source.relationships.filter(
        (edge) => edge.from === component.id || edge.to === component.id,
      ),
      checks,
      contractPaths,
      verificationSubjects,
    }
  })
}
