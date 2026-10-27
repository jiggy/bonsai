import {
  checkBasicProject,
  inspectConfiguration as inspectBasicConfiguration,
  explainComponent as explainBasicComponent,
  initializeProject as initializeBasicProject,
  showHelp,
  generateCompletion as generateBasicCompletion,
  verifyIsolatedScenarios,
  showVersion,
} from './basic.ts'
import { checkAccounting } from './accounting.ts'
import { checkAncestry, inspectAncestryConfiguration } from './ancestry.ts'
import { checkVerification } from './verification.ts'
import { projectBehavior } from './project-behavior.ts'
import { checkUx } from './ux.ts'

/** Fixture inputs arrange contexts; the action identity remains the public command. */
export function checkProject(input: Record<string, unknown>) {
  switch (input.fixture) {
    case 'accounting':
      return checkAccounting(input as Parameters<typeof checkAccounting>[0])
    case 'ancestry':
      return checkAncestry(input as Parameters<typeof checkAncestry>[0])
    case 'verification':
      return checkVerification(input as Parameters<typeof checkVerification>[0])
    case 'ux':
      return checkUx(input as Parameters<typeof checkUx>[0])
    case 'scenario-state':
      return verifyIsolatedScenarios(input)
    case undefined:
      return checkBasicProject(input)
    default:
      throw new Error(`Unknown check fixture: ${input.fixture}`)
  }
}

export function inspectConfiguration(input: Record<string, unknown>) {
  if (input.fixture === 'ancestry')
    return inspectAncestryConfiguration(input as Parameters<typeof inspectAncestryConfiguration>[0])
  return input.fixture === 'project'
    ? projectBehavior(input as Parameters<typeof projectBehavior>[0])
    : inspectBasicConfiguration(input)
}

export function explainComponent(input: Record<string, unknown>) {
  return input.fixture === 'project'
    ? projectBehavior(input as Parameters<typeof projectBehavior>[0])
    : explainBasicComponent(input)
}

export function initializeProject(input: Record<string, unknown>) {
  return input.fixture === 'project'
    ? projectBehavior(input as Parameters<typeof projectBehavior>[0])
    : initializeBasicProject()
}

export function generateCompletion(input: Record<string, unknown>) {
  return input.fixture === 'ux'
    ? checkUx(input as Parameters<typeof checkUx>[0])
    : generateBasicCompletion(input as Parameters<typeof generateBasicCompletion>[0])
}

export { showHelp, showVersion }
