import { relative, resolve, sep } from 'node:path'
import { sameExecutionIdentity } from '../identity.ts'
import { validEvidence } from '../policy.ts'
import { validRunnerEvidence } from '../runners.ts'
import type { Check, Component, Config, Decision, Snapshot, Timing } from '../model.ts'

export type ReportInput = { decision: Decision; snapshot: Snapshot; timing: Timing }
export type ReportContext = {
  config: Config
  root: string
  configFile: string
  origin: { root: string; base: string; policy: string }
  base?: string
  project: string
  generatedAt: string
}
export type ReportFile = Omit<Snapshot['source']['files'][number], 'file'> & {
  path: string
  components: string[]
}
export type ReportComponent = Component & {
  features: string[]
  /** Destination IDs for display. Traversal must preserve the raw relationships' states. */
  calls: string[]
}
export type ReportFeature = {
  id: string
  path: string
  name: string
  checks: Check[]
  actions: string[]
}
/** Context compatibility only. A matched record can still be incomplete or failed. */
export type ReportEvidenceState = 'unavailable' | 'matched' | 'mismatched'
export type ReportData = {
  project: string
  generatedAt: string
  fingerprint: string
  decision: Decision
  files: ReportFile[]
  components: ReportComponent[]
  features: ReportFeature[]
  /** A null handler marks an absent registration, never a literal registry value. */
  bindings: { action: string; handler: string | null }[]
  config: Config & { origin: string }
  maintainedEntries: { entry: string; files: string[] }[]
  provenance: {
    root: string
    configFile: string
    base: string | null
    origin: ReportContext['origin']
  }
  surface: number
  feedbackMs: number | null
  ancestry: Snapshot['ancestry']
  registry?: string
  relationships: Snapshot['source']['relationships']
  unrooted: string[]
  problems: { contracts: string[]; source: string[] }
  evidence?: Snapshot['evidence']
  evidenceState: ReportEvidenceState
  identity?: Snapshot['identity']
  verification?: Snapshot['verification']
  analysis?: Snapshot['analysis']
  controlDepth?: Snapshot['source']['controlDepth']
  runners?: Snapshot['runners']
  runnerEvidence?: Snapshot['runnerEvidence']
  runnerEvidenceStates: { id: string; state: ReportEvidenceState }[]
  timing: Timing
  candidateTiming?: Snapshot['timing']
}

/** Project one evaluated invocation; this layer neither collects nor decides acceptance. */
export function buildReportData(input: ReportInput, context: ReportContext): ReportData {
  const { snapshot, decision, timing } = input
  const { source, contracts } = snapshot
  const checks = new Map(contracts.checks.map((check) => [check.id, check]))
  const featureMap = new Map<string, ReportFeature>()
  const feature = (path: string) => {
    let result = featureMap.get(path)
    if (!result) {
      result = { id: path, path, name: path.split('/').at(-1)!, checks: [], actions: [] }
      featureMap.set(path, result)
    }
    return result
  }
  // An indexed specification can be empty or fail compilation. Do not hide it.
  for (const { file } of source.files) if (file.endsWith('.feature')) feature(file)
  for (const check of contracts.checks) {
    const owner = feature(check.file)
    owner.checks.push(check)
    if (!owner.actions.includes(check.action)) owner.actions.push(check.action)
  }
  const members = new Map<string, string[]>()
  for (const component of source.components) {
    const group = members.get(component.file) ?? []
    group.push(component.id)
    members.set(component.file, group)
  }
  const outgoing = new Map<string, Set<string>>()
  for (const edge of source.relationships) {
    const destinations = outgoing.get(edge.from) ?? new Set<string>()
    destinations.add(edge.to)
    outgoing.set(edge.from, destinations)
  }
  const actions = new Set([
    ...contracts.checks.map((check) => check.action),
    ...Object.keys(source.actions),
  ])
  const evidenceState: ReportEvidenceState =
    snapshot.evidence === undefined
      ? 'unavailable'
      : validEvidence(snapshot.evidence) &&
          snapshot.evidence.fingerprint === snapshot.fingerprint &&
          sameExecutionIdentity(snapshot.identity, snapshot.evidence.identity) &&
          snapshot.evidence.profile === (snapshot.verification?.profile ?? 'isolated-scenarios-v1')
        ? 'matched'
        : 'mismatched'
  const runnerIds = new Set([
    ...(context.config.runners ?? []).map((runner) => runner.id),
    ...(snapshot.runners ?? []).map((runner) => runner.id),
    ...(snapshot.runnerEvidence ?? []).map((result) => result.id),
  ])
  const runnerEvidenceStates = [...runnerIds].map((id) => {
    const requirement =
      snapshot.runners?.find((runner) => runner.id === id) ??
      context.config.runners?.find((runner) => runner.id === id)
    const results = snapshot.runnerEvidence?.filter((result) => result.id === id) ?? []
    const result = results[0]
    const state: ReportEvidenceState = !result
      ? 'unavailable'
      : results.length === 1 &&
          requirement &&
          validRunnerEvidence(result) &&
          result.adapter === requirement.adapter &&
          result.fingerprint === snapshot.fingerprint &&
          sameExecutionIdentity(snapshot.identity, result.identity)
        ? 'matched'
        : 'mismatched'
    return { id, state }
  })
  return {
    project: context.project,
    generatedAt: context.generatedAt,
    fingerprint: snapshot.fingerprint,
    decision,
    files: source.files.map(({ file, ...facts }) => ({
      ...facts,
      path: file,
      components: members.get(file) ?? [],
    })),
    components: source.components.map((component) => ({
      ...component,
      features: [
        ...new Set(
          (snapshot.ancestry[component.id] ?? [])
            .map((id) => checks.get(id)?.file)
            .filter((path): path is string => path !== undefined),
        ),
      ],
      calls: [...(outgoing.get(component.id) ?? [])],
    })),
    features: [...featureMap.values()],
    bindings: [...actions].map((action) => ({
      action,
      handler: Object.hasOwn(source.actions, action) ? source.actions[action] : null,
    })),
    config: { ...context.config, origin: context.configFile },
    maintainedEntries: context.config.maintained.map((entry) => {
      const path = relative(context.root, resolve(context.root, entry)).split(sep).join('/')
      return {
        entry,
        files: source.files
          .filter(({ file }) => file === path || file.startsWith(path + '/'))
          .map(({ file }) => file),
      }
    }),
    provenance: {
      root: context.root,
      configFile: context.configFile,
      base: context.base ?? null,
      origin: context.origin,
    },
    surface: decision.surface,
    feedbackMs: snapshot.timing?.feedback?.elapsedMs ?? snapshot.evidence?.elapsedMs ?? null,
    ancestry: snapshot.ancestry,
    ...(source.registry !== undefined && { registry: source.registry }),
    relationships: source.relationships,
    unrooted: snapshot.unrooted,
    problems: { contracts: contracts.problems, source: source.problems },
    ...(snapshot.evidence !== undefined && { evidence: snapshot.evidence }),
    evidenceState,
    ...(snapshot.identity !== undefined && { identity: snapshot.identity }),
    ...(snapshot.verification !== undefined && { verification: snapshot.verification }),
    ...(snapshot.analysis !== undefined && { analysis: snapshot.analysis }),
    ...(source.controlDepth !== undefined && { controlDepth: source.controlDepth }),
    ...(snapshot.runners !== undefined && { runners: snapshot.runners }),
    ...(snapshot.runnerEvidence !== undefined && { runnerEvidence: snapshot.runnerEvidence }),
    runnerEvidenceStates,
    timing,
    ...(snapshot.timing !== undefined && { candidateTiming: snapshot.timing }),
  }
}
