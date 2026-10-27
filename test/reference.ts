import ts from 'typescript'
import { realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { measureSource, collectSourceGraph } from '../src/source.ts'
import type { Source } from '../src/model.ts'
import type { Timer } from '../src/timing.ts'
import { createCompilerSession } from './compiler.ts'

export { countTokens, inventory, fingerprint } from '../src/source.ts'

const compiler = createCompilerSession()

/** Development oracle only; the published checker always uses native semantics. */
export function analyzeSource(
  root: string,
  files: string[],
  bindings: string,
  timer?: Timer,
): Source {
  timer?.start('measurement')
  root = realpathSync(root)
  const source = measureSource(root, files)
  const scriptFiles = files.filter((file) => /\.[cm]?ts$/.test(file))
  timer?.start('program')
  const program = compiler.program(scriptFiles.map((file) => resolve(root, file)))
  timer?.start('diagnostics')
  source.problems.push(
    ...ts.getPreEmitDiagnostics(program).map((d) => {
      const location =
        d.file && d.start !== undefined
          ? `${relative(root, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: `
          : ''
      return location + ts.flattenDiagnosticMessageText(d.messageText, '\n')
    }),
  )
  timer?.start('graph')
  const result = collectSourceGraph(root, files, bindings, source, program)
  timer?.finish()
  return result
}
