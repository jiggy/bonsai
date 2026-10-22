import {
  checkProject,
  inspectConfiguration,
  explainComponent,
  initializeProject,
  showHelp,
  generateCompletion,
} from './src/self-host.ts'

export const actions = {
  check: checkProject,
  'config-show': inspectConfiguration,
  explain: explainComponent,
  init: initializeProject,
  help: showHelp,
  completion: generateCompletion,
}
