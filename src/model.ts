export type Reference = { file: string; line: number }
export type Component = Reference & {
  id: string
  name: string
  kind: 'production' | 'test' | 'binding'
  tokens: number
}
export type Relationship = {
  from: string
  to: string
  kind: 'reference'
  origin: 'static'
  sourceRef: Reference
}
export type Check = Reference & {
  id: string
  action: string
  selector: string
  expected: unknown
}
export type ContractCase = { id: string; name: string; steps: Step[] }
export type Step =
  | { kind: 'action'; action: string; input: unknown }
  | { kind: 'observation'; check: Check }
export type Contracts = {
  pairs: string[]
  checks: Check[]
  cases: ContractCase[]
  problems: string[]
}
export type Source = {
  files: { file: string; tokens: number }[]
  components: Component[]
  relationships: Relationship[]
  actions: Record<string, string>
  registry?: string
  bindingImports?: (Reference & {
    from: string
    adapter: 'project-bindings-v1'
    bindings: string
  })[]
  problems: string[]
}
export type Policy = {
  bootstrap: number
  bootstrapSurface: number
  perDoubling: number
  hardLimit: number
  maxFeedbackMs: number
}
export type Config = {
  maintained: string[]
  exclude?: string[]
  bindings: string
  policy: Policy
}
export type Evidence = {
  fingerprint: string
  profile: 'in-process-v1'
  complete: boolean
  elapsedMs: number
  bindingImport?: { adapter: 'project-bindings-v1'; file: string; fingerprint: string }
  checks: { id: string; status: 'passed' | 'failed' | 'missing'; error?: string }[]
}
export type TimingStage = {
  name: string
  elapsedMs: number | null
  status: 'completed' | 'running' | 'interrupted' | 'skipped'
  stages?: TimingStage[]
}
export type Timing = { elapsedMs: number; stages: TimingStage[] }
export type CheckTiming = Timing & { feedback?: { elapsedMs: number; limitMs: number } }
export type Snapshot = {
  fingerprint: string
  contracts: Contracts
  source: Source
  ancestry: Record<string, string[]>
  unrooted: string[]
  evidence?: Evidence
  timing?: CheckTiming
}
export type Decision = {
  status: 'pass' | 'reject' | 'incomplete'
  retained: number
  ceiling: number
  requiredReduction: number
  surface: number
  violations: string[]
  base?: { retained: number; surface: number; additionalCapacity: number; retainedChange: number }
}
