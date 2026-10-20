import type { Contracts, Source, Snapshot } from './model.ts'

/** Production ancestry is established before tests are admitted. Tests cannot root production. */
export function buildSnapshot(fingerprint: string, contracts: Contracts, source: Source): Snapshot {
  const ancestry: Record<string, string[]> = Object.create(null)
  const components = new Map(source.components.map((c) => [c.id, c]))
  const outgoing = new Map<string, string[]>()
  for (const edge of source.relationships)
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to])
  const attach = (id: string, contract: string, allowProduction: boolean): void => {
    const queue = [id]
    while (queue.length) {
      const next = queue.pop()!
      const target = components.get(next)
      if (!target || (!allowProduction && target.kind === 'production')) continue
      const existing = (ancestry[next] ??= [])
      if (existing.includes(contract)) continue
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
  // Admit a test only for its already retained production subjects. Its other subjects stay unrooted.
  for (const component of source.components.filter((c) => c.kind === 'test')) {
    for (const subject of outgoing.get(component.id) ?? []) {
      if (components.get(subject)?.kind !== 'production') continue
      for (const contract of ancestry[subject] ?? []) attach(component.id, contract, false)
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
  return matches.map((component) => ({
    ...component,
    contracts: snapshot.ancestry[component.id] ?? [],
    relationships: snapshot.source.relationships.filter(
      (edge) => edge.from === component.id || edge.to === component.id,
    ),
    checks: snapshot.contracts.checks.filter((check) =>
      (snapshot.ancestry[component.id] ?? []).includes(check.id),
    ),
  }))
}
