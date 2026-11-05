/**
 * Literal local imports keep every supported route visible to source analysis
 * while avoiding unrelated fixture initialization in each isolated worker.
 */
export async function checkProject(input: Record<string, unknown>) {
  switch (input.fixture) {
    case 'integrations': {
      const { checkIntegrations } = await import('./integrations.ts')
      return checkIntegrations(input as Parameters<typeof checkIntegrations>[0])
    }
    case 'python': {
      const { checkPythonProject } = await import('./python.ts')
      return checkPythonProject()
    }
    case 'accounting': {
      const { checkAccounting } = await import('./accounting.ts')
      return checkAccounting(input as Parameters<typeof checkAccounting>[0])
    }
    case 'ancestry': {
      const { checkAncestry } = await import('./ancestry.ts')
      return checkAncestry(input as Parameters<typeof checkAncestry>[0])
    }
    case 'verification': {
      const { checkVerification } = await import('./verification.ts')
      return checkVerification(input as Parameters<typeof checkVerification>[0])
    }
    case 'ux': {
      const { checkUx } = await import('./ux.ts')
      return checkUx(input as Parameters<typeof checkUx>[0])
    }
    case 'html-report': {
      const { checkHtmlReport } = await import('./report.ts')
      return checkHtmlReport(input as Parameters<typeof checkHtmlReport>[0])
    }
    case 'control-depth': {
      const { checkControlDepth } = await import('./control-depth.ts')
      return checkControlDepth(input as Parameters<typeof checkControlDepth>[0])
    }
    case 'supporting-suite': {
      const { checkSupportingSuite } = await import('./runners.ts')
      return checkSupportingSuite(input as Parameters<typeof checkSupportingSuite>[0])
    }
    case 'scenario-state': {
      const { verifyIsolatedScenarios } = await import('./basic.ts')
      return verifyIsolatedScenarios(input)
    }
    case undefined: {
      const { checkBasicProject } = await import('./basic.ts')
      return checkBasicProject(input)
    }
    default:
      throw new Error(`Unknown check fixture: ${input.fixture}`)
  }
}

export async function inspectConfiguration(input: Record<string, unknown>) {
  if (input.fixture === 'ancestry') {
    const { inspectAncestryConfiguration } = await import('./ancestry.ts')
    return inspectAncestryConfiguration(input as Parameters<typeof inspectAncestryConfiguration>[0])
  }
  if (input.fixture === 'project') {
    const { projectBehavior } = await import('./project-behavior.ts')
    return projectBehavior(input as Parameters<typeof projectBehavior>[0])
  }
  const { inspectConfiguration } = await import('./basic.ts')
  return inspectConfiguration(input)
}

export async function explainComponent(input: Record<string, unknown>) {
  if (input.fixture === 'integrations') {
    const { explainIntegrations } = await import('./integrations.ts')
    return explainIntegrations(input as Parameters<typeof explainIntegrations>[0])
  }
  if (input.fixture === 'project') {
    const { projectBehavior } = await import('./project-behavior.ts')
    return projectBehavior(input as Parameters<typeof projectBehavior>[0])
  }
  const { explainComponent } = await import('./basic.ts')
  return explainComponent(input)
}

export async function initializeProject(input: Record<string, unknown>) {
  if (input.fixture === 'project') {
    const { projectBehavior } = await import('./project-behavior.ts')
    return projectBehavior(input as Parameters<typeof projectBehavior>[0])
  }
  const { initializeProject } = await import('./basic.ts')
  return initializeProject()
}

export async function generateCompletion(input: Record<string, unknown>) {
  if (input.fixture === 'ux') {
    const { checkUx } = await import('./ux.ts')
    return checkUx(input as Parameters<typeof checkUx>[0])
  }
  const { generateCompletion } = await import('./basic.ts')
  return generateCompletion(input as Parameters<typeof generateCompletion>[0])
}

export async function showHelp(input: { command?: string }) {
  const { showHelp } = await import('./basic.ts')
  return showHelp(input)
}

export async function showVersion() {
  const { showVersion } = await import('./basic.ts')
  return showVersion()
}

export async function githubAction(input: { change?: 'grow' | 'incomplete' } = {}) {
  const { githubAction } = await import('./github-action.ts')
  return githubAction(input)
}
