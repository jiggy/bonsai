import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import {
  API,
  SymbolFlags,
  type Symbol as NativeSymbol,
  type Type as NativeType,
  type Diagnostic as NativeDiagnostic,
  type CompilerOptions as NativeCompilerOptions,
} from 'tsrs/unstable/async'
import {
  SyntaxKind,
  type Node as NativeNode,
  type SourceFile as NativeSourceFile,
} from 'tsrs/unstable/ast'
import { sourceCompilerOptions } from './compiler-options.ts'
import type { Timer } from './timing.ts'
import { nativeBinary } from './native-install.ts'

type Span = Map<string, ts.Node>
type RemoteSpan = Map<string, NativeNode>
type SymbolView = Pick<ts.Symbol, 'flags' | 'declarations' | 'valueDeclaration' | 'getName'>
type TypeView = Pick<ts.Type, 'getSymbol'>

const nodeKey = (start: number, end: number, kind: string) => `${start}:${end}:${kind}`
const symbolKey = (symbol: NativeSymbol) => {
  const reference = symbol.reference
  return JSON.stringify([
    reference.kind,
    reference.file?.nodeId,
    reference.snapshot,
    reference.project,
    reference.id,
  ])
}
const canonical = (file: string) => {
  const absolute = resolve(file)
  return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase()
}

function diagnosticView(diagnostic: NativeDiagnostic): ts.Diagnostic {
  const chain = (entry: NativeDiagnostic): ts.DiagnosticMessageChain => ({
    messageText: entry.text,
    category: diagnostic.category,
    code: diagnostic.code,
    ...(entry.messageChain?.length ? { next: entry.messageChain.map(chain) } : {}),
  })
  const fileName = diagnostic.fileName
  return {
    category: diagnostic.category,
    code: diagnostic.code,
    file: fileName
      ? ({ fileName, path: canonical(fileName) } as unknown as ts.SourceFile)
      : undefined,
    start: diagnostic.pos,
    length:
      diagnostic.end === undefined || diagnostic.pos === undefined
        ? undefined
        : diagnostic.end - diagnostic.pos,
    messageText: diagnostic.messageChain?.length
      ? {
          messageText: diagnostic.text,
          code: diagnostic.code,
          category: diagnostic.category,
          next: diagnostic.messageChain.map(chain),
        }
      : diagnostic.text,
    ...(diagnostic.relatedInformation?.length
      ? {
          relatedInformation: diagnostic.relatedInformation.map(
            diagnosticView,
          ) as ts.DiagnosticRelatedInformation[],
        }
      : {}),
  }
}

/** Native semantics with local lexical ASTs; this never creates a JS compiler program. */
export async function createTsrsProgram(
  root: string,
  files: string[],
  cwd: string,
  timer?: Timer,
  signal?: AbortSignal,
) {
  const symbolKeys = new WeakMap<NativeSymbol, string>()
  const keyOf = (symbol: NativeSymbol) => {
    let key = symbolKeys.get(symbol)
    if (key === undefined) {
      key = symbolKey(symbol)
      symbolKeys.set(symbol, key)
    }
    return key
  }
  timer?.start('program')
  const host = { ...ts.sys, getCurrentDirectory: () => cwd }
  const options = {
    ...sourceCompilerOptions,
    // TypeScript 7 defaults differ. Preserve this collector's automatic TS5 roots.
    types: ts.getAutomaticTypeDirectiveNames(sourceCompilerOptions, host),
    typeRoots: ts.getEffectiveTypeRoots(sourceCompilerOptions, host),
  }
  const api = new API({
    cwd,
    runExternalCode: false,
    tsserverPath: nativeBinary(),
  })
  // The pinned SDK's public close waits for initialization. A server that never
  // answers initialization therefore needs to be stopped and reaped first.
  const client = (
    api as unknown as {
      client: { connect(): Promise<void>; connecting?: Promise<void>; process?: ChildProcess }
    }
  ).client
  let nativeProcess: ChildProcess | undefined
  let nativeClosed: Promise<void> | undefined
  const retainServer = () => {
    const child = nativeProcess ?? client.process
    if (child && !nativeProcess) {
      nativeProcess = child
      nativeClosed =
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : new Promise<void>((done) => child.once('close', () => done()))
    }
    return child
  }
  let stopping: Promise<void> | undefined
  let closing: Promise<void> | undefined
  const stopServer = () =>
    (stopping ??= (async () => {
      await client.connecting?.catch(() => {})
      const child = retainServer()
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      await nativeClosed
    })())
  const abort = () => {
    void stopServer().catch(() => {})
  }
  signal?.addEventListener('abort', abort, { once: true })
  const close = () =>
    (closing ??= (async () => {
      try {
        await stopping
        retainServer()
        await api.close()
      } finally {
        try {
          // The SDK ends stdin and clears client.process without awaiting exit.
          await nativeClosed
        } finally {
          signal?.removeEventListener('abort', abort)
        }
      }
      if (
        !signal?.aborted &&
        nativeProcess &&
        (nativeProcess.exitCode !== 0 || nativeProcess.signalCode !== null)
      )
        throw new Error(
          `Rust compiler exited ${nativeProcess.signalCode ? `after ${nativeProcess.signalCode}` : `with status ${nativeProcess.exitCode}`} during shutdown`,
        )
    })())
  try {
    if (signal?.aborted) throw new Error('Rust analysis interrupted')
    const scriptFiles = files.filter((file) => /\.[cm]?ts$/.test(file))
    const names = scriptFiles.map((file) => resolve(root, file))
    // Retain the close event before initialization can fail or hang.
    await client.connect()
    retainServer()
    if (signal?.aborted) throw new Error('Rust analysis interrupted')
    const nativeProgram = await api.createProgram(
      names,
      options as unknown as NativeCompilerOptions,
    )
    const checker = nativeProgram.getProject().checker

    timer?.start('diagnostics')
    const categories = await Promise.all([
      nativeProgram.getConfigFileParsingDiagnostics(),
      nativeProgram.getProgramDiagnostics(),
      nativeProgram.getSyntacticDiagnostics(),
      nativeProgram.getBindDiagnostics(),
      nativeProgram.getGlobalDiagnostics(),
      nativeProgram.getSemanticDiagnostics(),
    ])
    const diagnostics = ts.sortAndDeduplicateDiagnostics(categories.flat().map(diagnosticView))
    const problems = diagnostics.map((diagnostic) => {
      const original = categories
        .flat()
        .find(
          (entry) =>
            entry.fileName === diagnostic.file?.fileName &&
            entry.pos === diagnostic.start &&
            entry.code === diagnostic.code,
        )
      const location =
        diagnostic.file && original?.startPosition
          ? `${relative(root, diagnostic.file.fileName)}:${original.startPosition.line + 1}: `
          : ''
      return location + ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    })

    timer?.start('graph')
    const allNames = await nativeProgram.getSourceFileNames()
    const metadata = await Promise.all(
      allNames.map((file) => nativeProgram.getSourceFileMetadata(file)),
    )
    const external = new Set(
      allNames.filter((_file, index) => metadata[index]?.isFromExternalLibrary).map(canonical),
    )
    const libraries = new Set(
      allNames.filter((_file, index) => metadata[index]?.isDefaultLibrary).map(canonical),
    )
    for (const file of allNames) {
      if (
        !libraries.has(canonical(file)) &&
        ts.preProcessFile(readFileSync(file, 'utf8'), false).isLibFile
      ) {
        problems.push(
          `Rust checker unsupported: ${relative(root, file)} disables default libraries with no-default-lib; tsrs does not preserve this directive's diagnostics`,
        )
      }
    }
    const localFiles = new Map<string, ts.SourceFile>()
    const localSpans = new Map<string, Span>()
    const nativeFiles = new Map<string, NativeSourceFile>()
    const nativeSpans = new Map<string, RemoteSpan>()
    const requests: { local: ts.Node; native: NativeNode }[][] = []
    const elements: ts.ElementAccessExpression[] = []
    const importSpecifiers: ts.StringLiteralLike[] = []
    const importTargets: ts.Expression[] = []
    // A reference can only reach an owned declaration/export or an adapter binding.
    // Keep owned names and adapter bindings; native semantics still resolve
    // aliases and shadows. Ordinary external property names need no query.
    const componentNames = new Set(['default'])
    const fileNames = new Map<string, Set<string>>()
    const collectNames = (node: ts.Node, names: Set<string>): void => {
      const name = (node as ts.NamedDeclaration).name
      if (
        name &&
        ts.isIdentifier(name) &&
        (ts.isImportClause(node) ||
          ts.isImportSpecifier(node) ||
          ts.isNamespaceImport(node) ||
          ts.isImportEqualsDeclaration(node) ||
          ts.isParameter(node) ||
          ts.isBindingElement(node) ||
          (ts.isVariableDeclaration(node) &&
            ts.isVariableDeclarationList(node.parent) &&
            !!(node.parent.flags & ts.NodeFlags.Const)))
      )
        names.add(name.text)
      ts.forEachChild(node, (child) => collectNames(child, names))
    }
    let unsupportedLexical = false
    for (const file of names) {
      const ast = ts.createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.ES2023,
        true,
      )
      localFiles.set(canonical(file), ast)
      const references = new Set(['URL', 'process'])
      collectNames(ast, references)
      fileNames.set(canonical(file), references)
      for (const statement of ast.statements) {
        const declarations = ts.isVariableStatement(statement)
          ? [...statement.declarationList.declarations]
          : [statement]
        for (const declaration of declarations) {
          const name = (declaration as ts.NamedDeclaration).name
          if (name && ts.isIdentifier(name)) componentNames.add(name.text)
        }
        if (ts.isExportDeclaration(statement) && statement.exportClause) {
          const clause = statement.exportClause
          if (ts.isNamespaceExport(clause)) componentNames.add(clause.name.text)
          else for (const binding of clause.elements) componentNames.add(binding.name.text)
        }
      }
      const parseDiagnostics = (
        ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
      ).parseDiagnostics
      if (!diagnostics.length && parseDiagnostics.length) {
        unsupportedLexical = true
        problems.push(
          `Rust checker unsupported: ${relative(root, file)} uses syntax outside Bonsai's lexical AST adapter`,
        )
      }
    }
    if (unsupportedLexical) {
      return { program: undefined, problems, close }
    }
    const remoteFiles = await Promise.all(names.map((file) => nativeProgram.getSourceFile(file)))
    for (const [index, file] of names.entries()) {
      const ast = localFiles.get(canonical(file))!
      const referenceNames = fileNames.get(canonical(file))!
      const text = ast.text
      const remote = remoteFiles[index]
      if (!remote || remote.text !== text)
        throw new Error(`Source changed during native analysis: ${scriptFiles[index]}`)
      const spans: Span = new Map()
      const candidates: ts.Node[] = []
      const expressions: ts.Expression[] = []
      const declarationNames = new Set<ts.Node>()
      for (const statement of ast.statements) {
        if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) continue
        const declarations = ts.isVariableStatement(statement)
          ? [...statement.declarationList.declarations]
          : [statement]
        for (const declaration of declarations) {
          const name = (declaration as ts.NamedDeclaration).name
          if (name) declarationNames.add(name)
        }
      }
      const visit = (node: ts.Node): void => {
        // Primitive adapters compare uses with the imported binding's identity;
        // no external value declaration needs to be materialized for that check.
        if (node.parent === ast && ts.isImportDeclaration(node)) {
          visit(node.moduleSpecifier)
          if (node.importClause?.name) visit(node.importClause.name)
          const bindings = node.importClause?.namedBindings
          if (bindings && ts.isNamespaceImport(bindings)) visit(bindings.name)
          else if (bindings && ts.isNamedImports(bindings))
            for (const binding of bindings.elements) visit(binding.name)
          return
        }
        if (node.parent === ast && ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier) visit(node.moduleSpecifier)
          return
        }
        if (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node))
          spans.set(nodeKey(node.getStart(ast), node.end, ts.SyntaxKind[node.kind]), node)
        const parent = node.parent
        const importSpecifier =
          parent !== undefined &&
          ((ts.isCallExpression(parent) &&
            parent.expression.kind === ts.SyntaxKind.ImportKeyword &&
            parent.arguments[0] === node) ||
            ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
              parent.moduleSpecifier === node))
        const importTarget =
          parent !== undefined &&
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node &&
          parent.name.text === 'url' &&
          ts.isCallExpression(parent.parent) &&
          parent.parent.expression.kind === ts.SyntaxKind.ImportKeyword &&
          parent.parent.arguments[0] === parent
        const initializerCallee =
          parent !== undefined &&
          ts.isCallExpression(parent) &&
          parent.expression === node &&
          ts.isVariableDeclaration(parent.parent) &&
          parent.parent.initializer === parent
        // References use property-name identifiers, not whole accesses or ordinary
        // strings. Loader primitives can be a direct variable-initializer callee.
        if (
          (ts.isIdentifier(node) &&
            (referenceNames.has(node.text) || componentNames.has(node.text))) ||
          (ts.isStringLiteralLike(node) && (importSpecifier || declarationNames.has(node))) ||
          (ts.isPropertyAccessExpression(node) && (importTarget || initializerCallee))
        ) {
          candidates.push(node)
        }
        if (ts.isElementAccessExpression(node)) {
          elements.push(node)
          expressions.push(node.expression)
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const specifier = node.arguments[0]
          if (specifier && ts.isStringLiteralLike(specifier)) importSpecifiers.push(specifier)
          else if (
            specifier &&
            ts.isPropertyAccessExpression(specifier) &&
            specifier.name.text === 'url'
          )
            importTargets.push(specifier.expression)
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
      const required = new Set(
        [...candidates, ...expressions].map((node) =>
          nodeKey(node.getStart(ast), node.end, ts.SyntaxKind[node.kind]),
        ),
      )
      const kinds = new Set([...candidates, ...expressions].map((node) => ts.SyntaxKind[node.kind]))
      const remoteNodes: RemoteSpan = new Map()
      const visitRemote = (node: NativeNode): void => {
        const kind = SyntaxKind[node.kind]
        if (kinds.has(kind)) {
          const key = nodeKey(node.getStart(remote), node.end, kind)
          if (required.has(key)) remoteNodes.set(key, node)
        }
        node.forEachChild(visitRemote)
      }
      visitRemote(remote)
      const queries = candidates.map((local) => {
        const native = remoteNodes.get(
          nodeKey(local.getStart(ast), local.end, ts.SyntaxKind[local.kind]),
        )
        if (!native)
          throw new Error(
            `Unsupported native AST mapping: ${file}:${local.getStart(ast)} (${ts.SyntaxKind[local.kind]})`,
          )
        return { local, native }
      })
      localSpans.set(canonical(file), spans)
      nativeFiles.set(canonical(file), remote)
      nativeSpans.set(canonical(file), remoteNodes)
      requests.push(queries)
    }

    const allFiles = allNames.map(
      (file) =>
        localFiles.get(canonical(file)) ??
        ({ fileName: file, kind: ts.SyntaxKind.SourceFile } as ts.SourceFile),
    )
    const fileMap = new Map(allFiles.map((file) => [canonical(file.fileName), file]))
    const symbols = new Map<string, NativeSymbol>()
    const aliases = new Map<string, NativeSymbol>()
    const locations = new Map<ts.Node, NativeSymbol | undefined>()
    const add = (symbol: NativeSymbol | undefined) => {
      if (symbol) symbols.set(keyOf(symbol), symbol)
      return symbol
    }
    const responses = await Promise.all(
      requests.map((entries) => checker.getSymbolAtLocation(entries.map((entry) => entry.native))),
    )
    requests.forEach((entries, file) => {
      const response = responses[file]
      if (!Array.isArray(response) || response.length !== entries.length)
        throw new Error(`Invalid native symbol batch: expected ${entries.length} results`)
      entries.forEach((entry, index) => locations.set(entry.local, add(response[index])))
    })

    const moduleExports = new Map<string, readonly NativeSymbol[]>()
    const importModules = new Map<string, NativeSymbol>()
    for (const specifier of importSpecifiers) {
      const symbol = locations.get(specifier)
      if (symbol) importModules.set(keyOf(symbol), symbol)
    }
    await Promise.all(
      [...importModules].map(async ([key, symbol]) => {
        const entries = await checker.getExportsOfModule(symbol)
        entries.forEach(add)
        moduleExports.set(key, entries)
      }),
    )

    const expressions = elements.map((element) => element.expression)
    const remoteExpressions = expressions.map((node) => {
      const file = canonical(node.getSourceFile().fileName)
      const remote = nativeSpans
        .get(file)
        ?.get(nodeKey(node.getStart(), node.end, ts.SyntaxKind[node.kind]))
      if (!remote)
        throw new Error(`Unsupported native expression mapping: ${file}:${node.getStart()}`)
      return remote
    })
    const nativeTypes = remoteExpressions.length
      ? await checker.getTypeAtLocation(remoteExpressions)
      : []
    if (!Array.isArray(nativeTypes) || nativeTypes.length !== remoteExpressions.length)
      throw new Error(`Invalid native type batch: expected ${remoteExpressions.length} results`)
    const types = new Map<ts.Node, NativeType>()
    const typeSymbols = new Map<number, NativeSymbol | undefined>()
    const properties = new Map<string, NativeSymbol | undefined>()
    nativeTypes.forEach((type, index) => types.set(expressions[index], type))
    const uniqueTypes = new Map(nativeTypes.map((type) => [type.id, type]))
    await Promise.all(
      [...uniqueTypes.values()].map(async (type) => {
        typeSymbols.set(type.id, add(await type.getSymbol()))
      }),
    )
    const selections = new Map<string, { type: NativeType; name: string }>()
    nativeTypes.forEach((type, index) => {
      const symbol = typeSymbols.get(type.id)
      if (
        !symbol?.declarations.some(
          (declaration) =>
            declaration.kind === SyntaxKind.SourceFile &&
            !external.has(canonical(declaration.path)),
        )
      )
        return
      const selector = elements[index].argumentExpression
      if (ts.isStringLiteralLike(selector))
        selections.set(`${type.id}\0${selector.text}`, { type, name: selector.text })
    })
    await Promise.all(
      [...selections].map(async ([key, { type, name }]) => {
        properties.set(key, add(await checker.getPropertyOfType(type, name)))
      }),
    )

    await Promise.all(
      [...symbols.values()]
        .filter((symbol) => symbol.flags & SymbolFlags.Alias)
        .map(async (symbol) => {
          const target = add(await checker.getAliasedSymbol(symbol))
          if (target) aliases.set(keyOf(symbol), target)
        }),
    )

    const handleKey = (handle: NonNullable<NativeSymbol['valueDeclaration']>) =>
      `${handle.path}\0${handle.index}\0${handle.kind}`
    const resolvedDeclarations = new Map<string, ts.Declaration>()
    const resolveValues = async (candidates: (NativeSymbol | undefined)[]) => {
      const handles = new Map<string, NonNullable<NativeSymbol['valueDeclaration']>>()
      for (const symbol of candidates) {
        const handle = symbol?.valueDeclaration
        if (
          handle &&
          nativeFiles.has(canonical(handle.path)) &&
          (handle.kind === SyntaxKind.FunctionDeclaration ||
            handle.kind === SyntaxKind.VariableDeclaration) &&
          !resolvedDeclarations.has(handleKey(handle))
        )
          handles.set(handleKey(handle), handle)
      }
      await Promise.all(
        [...handles.values()].map(async (handle) => {
          const node = await handle.resolve()
          if (!node) throw new Error(`Native declaration is unavailable: ${handle.path}`)
          const file = canonical(handle.path)
          const remoteFile = nativeFiles.get(file)!
          const local = localSpans
            .get(file)
            ?.get(nodeKey(node.getStart(remoteFile), node.end, SyntaxKind[node.kind]))
          if (!local)
            throw new Error(
              `Unsupported native declaration mapping: ${file}:${node.getStart(remoteFile)}`,
            )
          resolvedDeclarations.set(handleKey(handle), local as ts.Declaration)
        }),
      )
    }
    // Only the internal binding-loader adapter inspects value declarations.
    // Other graph references need symbol identity, not materialized AST nodes.
    const targetSymbols = importTargets.map((target) => locations.get(target))
    await resolveValues(targetSymbols)
    const primitives = targetSymbols.map((symbol) => {
      const handle = symbol?.valueDeclaration
      const target = handle && resolvedDeclarations.get(handleKey(handle))
      if (
        !target ||
        !ts.isVariableDeclaration(target) ||
        !target.initializer ||
        !ts.isCallExpression(target.initializer)
      )
        return undefined
      const primitive = locations.get(target.initializer.expression)
      return primitive && primitive.flags & SymbolFlags.Alias
        ? aliases.get(keyOf(primitive))
        : primitive
    })
    await resolveValues(primitives)
    const declarations = (handle: NativeSymbol['valueDeclaration']): ts.Declaration | undefined => {
      if (!handle) return undefined
      const file = canonical(handle.path)
      if (handle.kind === SyntaxKind.SourceFile)
        return fileMap.get(file) as unknown as ts.Declaration
      return resolvedDeclarations.get(handleKey(handle))
    }
    const views = new Map<string, SymbolView>()
    const symbolView = (symbol: NativeSymbol | undefined): ts.Symbol | undefined => {
      if (!symbol) return undefined
      const key = keyOf(symbol)
      let view = views.get(key)
      if (!view) {
        view = {
          flags: symbol.flags & SymbolFlags.Alias ? ts.SymbolFlags.Alias : ts.SymbolFlags.None,
          get declarations() {
            return symbol.declarations
              .map(declarations)
              .filter((entry): entry is ts.Declaration => entry !== undefined)
          },
          get valueDeclaration() {
            const handle = symbol.valueDeclaration
            const declaration = declarations(handle)
            if (
              handle &&
              !declaration &&
              nativeFiles.has(canonical(handle.path)) &&
              (handle.kind === SyntaxKind.FunctionDeclaration ||
                handle.kind === SyntaxKind.VariableDeclaration)
            )
              throw new Error(`Uncollected native value declaration: ${handle.path}`)
            return declaration
          },
          getName: () => symbol.name,
        }
        views.set(key, view)
      }
      return view as ts.Symbol
    }
    const typeViews = new Map<number, TypeView>()
    const typeView = (type: NativeType): ts.Type => {
      let view = typeViews.get(type.id)
      if (!view) {
        view = { getSymbol: () => symbolView(typeSymbols.get(type.id)) }
        typeViews.set(type.id, view)
      }
      return view as ts.Type
    }
    const viewSymbols = new Map<ts.Symbol, NativeSymbol>()
    symbols.forEach((symbol) => viewSymbols.set(symbolView(symbol)!, symbol))
    const viewTypes = new Map<ts.Type, NativeType>()
    nativeTypes.forEach((type) => viewTypes.set(typeView(type), type))
    const semantic = {
      getSymbolAtLocation: (node: ts.Node) => symbolView(locations.get(node)),
      getAliasedSymbol: (symbol: ts.Symbol) => {
        const native = viewSymbols.get(symbol)
        if (!native) throw new Error('Unrecognized native alias symbol')
        return symbolView(aliases.get(keyOf(native)))!
      },
      getExportsOfModule: (symbol: ts.Symbol) => {
        const native = viewSymbols.get(symbol)
        if (!native) throw new Error('Unrecognized native module symbol')
        return (moduleExports.get(keyOf(native)) ?? []).map((entry) => symbolView(entry)!)
      },
      getTypeAtLocation: (node: ts.Node) => {
        const type = types.get(node)
        if (!type)
          throw new Error(
            `Uncollected native type: ${node.getSourceFile().fileName}:${node.getStart()}`,
          )
        return typeView(type)
      },
      getPropertyOfType: (type: ts.Type, name: string) => {
        const native = viewTypes.get(type)
        if (!native) throw new Error('Unrecognized native namespace type')
        return symbolView(properties.get(`${native.id}\0${name}`))
      },
    }
    const program = {
      getSourceFile: (file: string) => localFiles.get(canonical(file)),
      getSourceFiles: () => allFiles,
      isSourceFileFromExternalLibrary: (file: ts.SourceFile) =>
        external.has(canonical(file.fileName)),
      isSourceFileDefaultLibrary: (file: ts.SourceFile) => libraries.has(canonical(file.fileName)),
      getTypeChecker: () => semantic,
    } as unknown as ts.Program
    return { program, problems, close }
  } catch (error) {
    await close().catch(() => {})
    throw error
  }
}
