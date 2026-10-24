import ts from 'typescript'

export const sourceCompilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowImportingTsExtensions: true,
  noEmit: true,
  strict: true,
  skipLibCheck: true,
}

type Document = {
  fileName: string
  source: ts.SourceFile
  version: string
  kind: ts.ScriptKind
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX
  if (/\.[cm]?js$/i.test(fileName)) return ts.ScriptKind.JS
  if (/\.json$/i.test(fileName)) return ts.ScriptKind.JSON
  return ts.ScriptKind.TS
}

/** Reuse parsed documents, never filesystem lookups, resolution, or diagnostics. */
export function createCompilerSession() {
  let directory = ts.sys.getCurrentDirectory()
  let registry = ts.createDocumentRegistry(ts.sys.useCaseSensitiveFileNames, directory)
  let documents = new Map<string, Document>()
  let version = 0
  const release = (document: Document) =>
    registry.releaseDocument(
      document.fileName,
      sourceCompilerOptions,
      document.kind,
      document.source.impliedNodeFormat,
    )
  const dispose = () => {
    documents.forEach(release)
    documents.clear()
  }

  return {
    dispose,
    program(rootNames: string[]): ts.Program {
      const host = ts.createCompilerHost(sourceCompilerOptions)
      if (directory !== host.getCurrentDirectory()) {
        dispose()
        directory = host.getCurrentDirectory()
        registry = ts.createDocumentRegistry(host.useCaseSensitiveFileNames(), directory)
      }
      const next = new Map<string, Document>()
      let bytes = 0
      host.getSourceFile = (fileName, options, onError, shouldCreateNewSourceFile) => {
        let text: string | undefined
        try {
          text = host.readFile(fileName)
        } catch (error) {
          onError?.((error as Error).message)
          text = ''
        }
        if (text === undefined) return undefined
        const format = typeof options === 'object' ? options.impliedNodeFormat : undefined
        const key = `${host.getCanonicalFileName(fileName)}\0${format ?? ''}`
        const existing = next.get(key)
        if (existing && !shouldCreateNewSourceFile) return existing.source
        // Keep at most one request's documents, capped even for unusually large projects.
        if (
          shouldCreateNewSourceFile ||
          next.size >= 4096 ||
          bytes + text.length * 2 > 64 * 1024 * 1024
        )
          return ts.createSourceFile(fileName, text, options)
        let previous = documents.get(key)
        if (previous && previous.fileName !== fileName) {
          release(previous)
          documents.delete(key)
          previous = undefined
        }
        const documentVersion =
          previous?.source.text === text ? previous.version : String(++version)
        const kind = scriptKind(fileName)
        const document: Document = {
          fileName,
          source: registry.acquireDocument(
            fileName,
            sourceCompilerOptions,
            ts.ScriptSnapshot.fromString(text),
            documentVersion,
            kind,
            options,
          ),
          version: documentVersion,
          kind,
        }
        next.set(key, document)
        bytes += text.length * 2
        return document.source
      }
      try {
        return ts.createProgram(rootNames, sourceCompilerOptions, host)
      } finally {
        documents.forEach(release)
        documents = next
      }
    },
  }
}
