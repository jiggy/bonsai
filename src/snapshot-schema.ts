import { validControlDepth } from './control-depth.ts'
import type { Snapshot } from './model.ts'
import { validExecutionIdentity, type ExecutionIdentity } from './identity.ts'
import { validEvidence, validateVerification } from './policy.ts'
import { validRunnerEvidence, validateRunnerRequirements } from './runners.ts'

export const SNAPSHOT_SCHEMA = 'bonsai-snapshot-v1'
export type SerializedSnapshot = Snapshot & {
  schema: typeof SNAPSHOT_SCHEMA
  identity?: ExecutionIdentity
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const integer = (value: unknown, minimum = 0) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
const elapsed = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
const array = (value: unknown, valid: (entry: unknown) => boolean): boolean =>
  Array.isArray(value) && [...value].every(valid)
const strings = (value: unknown) => array(value, (entry) => typeof entry === 'string')
const reference = (value: unknown) => object(value) && text(value.file) && integer(value.line, 1)

function check(value: unknown): boolean {
  return (
    object(value) &&
    reference(value) &&
    text(value.id) &&
    text(value.action) &&
    text(value.selector) &&
    Object.hasOwn(value, 'expected')
  )
}

function contracts(value: unknown): boolean {
  return (
    object(value) &&
    strings(value.pairs) &&
    strings(value.problems) &&
    array(value.checks, check) &&
    array(
      value.cases,
      (scenario) =>
        object(scenario) &&
        text(scenario.id) &&
        typeof scenario.name === 'string' &&
        array(
          scenario.steps,
          (step) =>
            object(step) &&
            (step.kind === 'action'
              ? text(step.action) && Object.hasOwn(step, 'input')
              : step.kind === 'observation' && check(step.check)),
        ),
    )
  )
}

function source(value: unknown): boolean {
  return (
    object(value) &&
    strings(value.problems) &&
    array(
      value.files,
      (file) =>
        object(file) &&
        text(file.file) &&
        integer(file.tokens) &&
        (file.executable === undefined || typeof file.executable === 'boolean') &&
        (file.kind === undefined ||
          (typeof file.kind === 'string' && ['production', 'test', 'binding'].includes(file.kind))),
    ) &&
    (value.controlDepth === undefined ||
      validControlDepth(value.controlDepth, value.files as { file: string }[])) &&
    array(
      value.components,
      (component) =>
        object(component) &&
        reference(component) &&
        text(component.id) &&
        typeof component.name === 'string' &&
        integer(component.tokens) &&
        typeof component.kind === 'string' &&
        ['production', 'binding', 'test'].includes(component.kind),
    ) &&
    array(
      value.relationships,
      (edge) =>
        object(edge) &&
        text(edge.from) &&
        text(edge.to) &&
        edge.origin === 'static' &&
        ['reference', 'entry-point', 'module-initialization'].includes(String(edge.kind)) &&
        (edge.runtime === undefined || (edge.kind === 'reference' && edge.runtime === false)) &&
        reference(edge.sourceRef),
    ) &&
    object(value.actions) &&
    Object.values(value.actions).every(text) &&
    (value.registry === undefined || text(value.registry)) &&
    (value.bindingImports === undefined ||
      array(
        value.bindingImports,
        (boundary) =>
          object(boundary) &&
          reference(boundary) &&
          text(boundary.from) &&
          boundary.adapter === 'project-bindings-v1' &&
          text(boundary.bindings),
      ))
  )
}

function timing(value: unknown): boolean {
  const stage = (entry: unknown, depth = 0): boolean =>
    depth < 64 &&
    object(entry) &&
    text(entry.name) &&
    typeof entry.status === 'string' &&
    ['completed', 'running', 'interrupted', 'skipped'].includes(entry.status) &&
    (entry.status === 'skipped' ? entry.elapsedMs === null : elapsed(entry.elapsedMs)) &&
    (entry.stages === undefined || array(entry.stages, (child) => stage(child, depth + 1)))
  return (
    object(value) &&
    elapsed(value.elapsedMs) &&
    array(value.stages, (entry) => stage(entry)) &&
    (value.feedback === undefined ||
      (object(value.feedback) &&
        elapsed(value.feedback.elapsedMs) &&
        elapsed(value.feedback.limitMs) &&
        value.feedback.limitMs > 0))
  )
}

/** Validate serialized fact shapes; policy still decides completeness and acceptance. */
export function validSnapshot(value: unknown): value is SerializedSnapshot {
  if (
    !object(value) ||
    value.schema !== SNAPSHOT_SCHEMA ||
    !text(value.fingerprint) ||
    !contracts(value.contracts) ||
    !source(value.source) ||
    !object(value.ancestry) ||
    !Object.values(value.ancestry).every(strings) ||
    !strings(value.unrooted) ||
    (value.identity !== undefined && !validExecutionIdentity(value.identity)) ||
    (value.evidence !== undefined && !validEvidence(value.evidence)) ||
    (value.timing !== undefined && !timing(value.timing)) ||
    (value.runnerEvidence !== undefined && !array(value.runnerEvidence, validRunnerEvidence))
  )
    return false
  try {
    validateVerification(value.verification as Snapshot['verification'])
    validateRunnerRequirements(value.runners)
  } catch {
    return false
  }
  if (value.analysis !== undefined) {
    const analysis = value.analysis
    if (
      !object(analysis) ||
      analysis.engine !== 'rust' ||
      analysis.backend !== 'tsrs' ||
      analysis.validation !== 'native-diagnostics' ||
      (analysis.status !== 'complete' && analysis.status !== 'unsupported') ||
      !text(analysis.version)
    )
      return false
  }
  return true
}

export function parseSnapshot(input: string): SerializedSnapshot {
  const value: unknown = JSON.parse(input)
  if (!validSnapshot(value)) throw new Error('Invalid or unsupported Bonsai snapshot schema')
  return value
}
