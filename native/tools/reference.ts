import { realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { analyzeSource } from '../../src/source.ts'

export type ReferenceRequest = {
  protocol: 1
  root: string
  files: string[]
  bindings: string
  mode?: 'full' | 'diagnostics'
}

/** Separate measurement only; the production collector keeps all of its diagnostics. */
export function collectReference(request: ReferenceRequest) {
  const started = performance.now()
  if (request.protocol !== 1) throw new Error('Unsupported reference protocol')
  if (request.mode === 'diagnostics') {
    const root = realpathSync(request.root)
    // Match analyzeSource's compiler options, including its implicit library/type inputs.
    const program = ts.createProgram(
      request.files.filter((file) => /\.[cm]?ts$/.test(file)).map((file) => resolve(root, file)),
      {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        allowImportingTsExtensions: true,
        noEmit: true,
        strict: true,
        skipLibCheck: true,
      },
    )
    const problems = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      const location =
        diagnostic.file && diagnostic.start !== undefined
          ? `${relative(root, diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}: `
          : ''
      return location + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    })
    return {
      protocol: 1,
      typescriptDiagnostics: 'run',
      problems,
      elapsedMs: performance.now() - started,
    }
  }
  if (request.mode !== undefined && request.mode !== 'full')
    throw new Error('Unknown reference mode')
  const source = analyzeSource(request.root, request.files, request.bindings)
  return {
    protocol: 1,
    typescriptDiagnostics: 'run',
    source,
    elapsedMs: performance.now() - started,
  }
}

async function main() {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of input) {
    try {
      process.stdout.write(JSON.stringify(collectReference(JSON.parse(line))) + '\n')
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          protocol: 1,
          error: error instanceof Error ? error.message : String(error),
        }) + '\n',
      )
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n',
    )
    process.exitCode = 1
  })
}
