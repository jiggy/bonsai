import type { ExecutionIdentity } from './identity.ts'
import type { RunnerRequirement, RunnerEvidence } from './runners.ts'

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
  kind: 'reference' | 'entry-point'
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
export type Verification = { profile: 'in-process-v1' | 'isolated-scenarios-v1'; workers: number }
export type Config = {
  maintained: string[]
  exclude?: string[]
  bindings: string
  policy: Policy
  runners?: RunnerRequirement[]
}
export type Evidence = {
  schema: 'bonsai-evidence-v2'
  identity: ExecutionIdentity
  fingerprint: string
  profile: Verification['profile']
  complete: boolean
  elapsedMs: number
  bindingImport?: { adapter: 'project-bindings-v1'; file: string; fingerprint: string }
  checks: {
    id: string
    status: 'passed' | 'failed' | 'missing'
    error?: string
    response?: string
  }[]
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
  schema: 'bonsai-snapshot-v1'
  fingerprint: string
  identity?: ExecutionIdentity
  contracts: Contracts
  source: Source
  ancestry: Record<string, string[]>
  unrooted: string[]
  evidence?: Evidence
  runners?: RunnerRequirement[]
  runnerEvidence?: RunnerEvidence[]
  verification?: Verification
  timing?: CheckTiming
  analysis?: {
    engine: 'rust'
    backend: 'tsrs'
    validation: 'native-diagnostics'
    status: 'complete' | 'unsupported'
    version: string
  }
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

/** Selected application facts crossing the private runtime channel. */
export type ActionSelection = { selector: string; keys: string[] }
export type ActionRequest = {
  kind: 'invoke'
  id: number
  action: string
  input: unknown
  selections: ActionSelection[]
}
export type ActionResult = {
  kind: 'result'
  id: number
  action: string
  observations?: { selector: string; value?: unknown; error?: string }[]
  preview?: string
  error?: string
}
