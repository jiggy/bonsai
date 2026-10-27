import {
  checkProject,
  inspectConfiguration,
  explainComponent,
  initializeProject,
  showHelp,
  generateCompletion,
  showVersion,
} from './features/support/actions.ts'

export const actions = {
  check: checkProject,
  'config-show': inspectConfiguration,
  explain: explainComponent,
  init: initializeProject,
  help: showHelp,
  completion: generateCompletion,
  version: showVersion,
}
