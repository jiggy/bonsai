import type { Contracts, Source, Snapshot } from './model.ts'

/** Production ancestry is established before tests are admitted. Tests cannot root production. */
export function buildSnapshot(fingerprint: string, contracts: Contracts, source: Source): Snapshot {
  const ancestry: Record<string, string[]> = Object.create(null)
  const membership: Record<string, Set<string>> = Object.create(null)
  const traversed = new Map<string, Set<string>>()
  const components = new Map(source.components.map((c) => [c.id, c]))
  const outgoing = new Map<string, Source['relationships']>()
  for (const edge of source.relationships) {
    const targets = outgoing.get(edge.from)
    if (targets) targets.push(edge)
    else outgoing.set(edge.from, [edge])
  }
  const attach = (id: string, contract: string, allowProduction: boolean): void => {
    const queue: { id: string; runtime: boolean; production: boolean }[] = [
      { id, runtime: true, production: allowProduction },
    ]
    while (queue.length) {
      const next = queue.pop()!
      const target = components.get(next.id)
      if (!target || (!next.production && target.kind === 'production')) continue
      const state = contract + '\0' + next.runtime + '\0' + next.production
      let visited = traversed.get(next.id)
      if (!visited) traversed.set(next.id, (visited = new Set()))
      if (visited.has(state)) continue
      visited.add(state)
      const existing = (ancestry[next.id] ??= [])
      const seen = (membership[next.id] ??= new Set<string>())
      if (!seen.has(contract)) {
        seen.add(contract)
        existing.push(contract)
      }
      for (const edge of outgoing.get(next.id) ?? []) {
        const initialization = edge.kind === 'module-initialization'
        if ((initialization || edge.kind === 'entry-point') && !next.runtime) continue
        // Loading the registry can initialize modules, but never admits all its handlers.
        if (next.id === source.registry && !initialization) continue
        const destination = components.get(edge.to)
        queue.push({
          id: edge.to,
          runtime: next.runtime && edge.runtime !== false,
          production:
            destination?.kind !== 'test' &&
            (next.production || (next.id === source.registry && initialization)),
        })
      }
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
      } else if (kind === 'test')
        queue.push(...(outgoing.get(subject) ?? []).map((edge) => edge.to))
    }
  }
  return {
    schema: 'bonsai-snapshot-v1',
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
  const outgoing = new Map<string, Source['relationships']>()
  for (const edge of snapshot.source.relationships) {
    const targets = outgoing.get(edge.from) ?? []
    targets.push(edge)
    outgoing.set(edge.from, targets)
  }
  // Explanation routes preserve runtime and production eligibility, like ancestry.
  type Route = { id: string; runtime: boolean; production: boolean; previous?: Route }
  const routes = (start: string, descend: (id: string) => boolean, productionGraph = false) => {
    const paths = new Map<string, Route>()
    const visited = new Set<string>()
    const queue: Route[] = [
      { id: start, runtime: true, production: start !== snapshot.source.registry },
    ]
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]!
      if (
        productionGraph &&
        !current.production &&
        components.get(current.id)?.kind === 'production'
      )
        continue
      const key = current.id + '\0' + current.runtime + '\0' + current.production
      if (visited.has(key)) continue
      visited.add(key)
      if (!paths.has(current.id)) paths.set(current.id, current)
      if (!descend(current.id)) continue
      for (const edge of outgoing.get(current.id) ?? []) {
        if (!components.has(edge.to)) continue
        const initialization = edge.kind === 'module-initialization'
        if ((initialization || edge.kind === 'entry-point') && !current.runtime) continue
        if (current.id === snapshot.source.registry && !initialization) continue
        queue.push({
          id: edge.to,
          runtime: current.runtime && edge.runtime !== false,
          production:
            components.get(edge.to)?.kind !== 'test' &&
            (current.production || (current.id === snapshot.source.registry && initialization)),
          previous: current,
        })
      }
    }
    return paths
  }
  const path = (paths: Map<string, Route>, target: string) => {
    let route = paths.get(target)
    if (!route) return undefined
    const result: string[] = []
    while (route) {
      result.push(route.id)
      route = route.previous
    }
    return result.reverse()
  }
  const handlerRoutes = new Map<string, Map<string, Route>>()
  let registryRoutes: Map<string, Route> | undefined
  const productionPath = (action: string, target: string) => {
    const handler = snapshot.source.actions[action]
    if (!handler) return undefined
    let parents = handlerRoutes.get(handler)
    if (!parents) handlerRoutes.set(handler, (parents = routes(handler, () => true, true)))
    const direct = path(parents, target)
    if (direct || !snapshot.source.registry || target === snapshot.source.registry) return direct
    registryRoutes ??= routes(snapshot.source.registry, () => true, true)
    return path(registryRoutes, target)
  }
  const testRoutes = new Map<
    string,
    {
      support: Map<string, Route>
      subjects: Map<string, Route>
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
