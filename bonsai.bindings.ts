import {
  checkProject,
  inspectConfiguration,
  explainComponent,
  initializeProject,
  showHelp,
  generateCompletion,
  verifyIsolatedScenarios,
} from './src/self-host.ts'

export const actions = {
  check: checkProject,
  'config-show': inspectConfiguration,
  explain: explainComponent,
  init: initializeProject,
  help: showHelp,
  completion: generateCompletion,
  'verify-isolated-scenarios': verifyIsolatedScenarios,
}
