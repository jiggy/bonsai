import {
  checkProject,
  githubAction,
  inspectConfiguration,
  explainComponent,
  initializeProject,
  showHelp,
  generateCompletion,
  showVersion,
} from './features/support/actions.ts'

export const actions = {
  check: checkProject,
  'jiggy/bonsai': githubAction,
  'config-show': inspectConfiguration,
  explain: explainComponent,
  init: initializeProject,
  help: showHelp,
  completion: generateCompletion,
  version: showVersion,
}
