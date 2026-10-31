import ts from 'typescript'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type Transpiler = { transformSync(text: string): string }
type BunRuntime = {
  Transpiler: new (options: {
    loader: 'ts'
    target: 'bun'
    macro: Record<string, never>
    treeShaking: false
    deadCodeElimination: false
    trimUnusedImports: true
  }) => Transpiler
}

/** Classify default Bun output without importing or executing maintained modules. */
export function runtimeCoverageScope(root: string, files: string[]) {
  const included = new Set(files.map((file) => resolve(root, file)))
  const modes = new Map<string, boolean>()
  const defaultMode = (file: string, measured: boolean): boolean => {
    let directory = dirname(file)
    const searched: string[] = []
    let supported = true
    while (true) {
      const key = measured + ':' + directory
      if (modes.has(key)) {
        supported = modes.get(key)!
        break
      }
      searched.push(key)
      if (existsSync(resolve(directory, 'bunfig.toml'))) {
        supported = false
        break
      }
      const config = resolve(directory, 'tsconfig.json')
      if (existsSync(config)) {
        try {
          const parsed = ts.parseConfigFileTextToJson(config, readFileSync(config, 'utf8'))
          const value = parsed.config
          const options = value?.compilerOptions === undefined ? {} : value.compilerOptions
          supported =
            (!measured || included.has(config)) &&
            !parsed.error &&
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            value.extends === undefined &&
            options !== null &&
            typeof options === 'object' &&
            !Array.isArray(options) &&
            (options.verbatimModuleSyntax === undefined ||
              options.verbatimModuleSyntax === false) &&
            (options.preserveValueImports === undefined ||
              options.preserveValueImports === false) &&
            options.importsNotUsedAsValues === undefined &&
            (options.experimentalDecorators === undefined ||
              options.experimentalDecorators === false) &&
            (options.emitDecoratorMetadata === undefined || options.emitDecoratorMetadata === false)
        } catch {
          supported = false
        }
        break
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    for (const key of searched) modes.set(key, supported)
    return supported
  }
  const argumentOverride =
    /^(?:--(?:tsconfig-override|config|define|drop|loader|jsx[^\s=]*|preload|require|import)(?:[=\s:]|$)|-[rdc])/
  const environmentOverride =
    /(?:^|\s)["']?(?:--(?:tsconfig-override|config|define|drop|loader|jsx[^\s="']*|preload|require|import)(?=["']?(?:[=\s:]|$))|-[rdc])/
  const options = [process.env.BUN_OPTIONS ?? '', process.env.NODE_OPTIONS ?? '']
  const defaultRuntime =
    !options.some((value) => environmentOverride.test(value)) &&
    !process.execArgv.some((value) => argumentOverride.test(value)) &&
    defaultMode(resolve(process.cwd(), '<runtime>'), false) &&
    defaultMode(fileURLToPath(import.meta.url), false) &&
    defaultMode(resolve(root, '<runtime>'), true)
  let transpiler: Transpiler | undefined
  try {
    const bun = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun
    if (defaultRuntime && bun)
      transpiler = new bun.Transpiler({
        loader: 'ts',
        target: 'bun',
        macro: {},
        treeShaking: false,
        deadCodeElimination: false,
        trimUnusedImports: true,
      })
  } catch {}
  return (ast: ts.SourceFile): boolean | undefined => {
    if (ast.isDeclarationFile) return false
    if (!transpiler || !defaultMode(ast.fileName, true)) return undefined
    if (
      (ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
        .length
    )
      return undefined
    // Transforming macros can execute their modules. Reject their syntax first.
    let macro = false
    const macroOptions = (node: ts.Node): boolean => {
      if (
        ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
        node.name.text === 'type' &&
        ts.isStringLiteralLike(node.initializer) &&
        node.initializer.text === 'macro'
      )
        return true
      return ts.forEachChild(node, macroOptions) ?? false
    }
    const inspect = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (
          (node.moduleSpecifier &&
            ts.isStringLiteralLike(node.moduleSpecifier) &&
            node.moduleSpecifier.text.startsWith('macro:')) ||
          node.attributes?.elements.some(
            (attribute) =>
              attribute.name.text === 'type' &&
              ts.isStringLiteralLike(attribute.value) &&
              attribute.value.text === 'macro',
          )
        )
          macro = true
      }
      if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression) &&
        node.moduleReference.expression.text.startsWith('macro:')
      )
        macro = true
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        ((node.arguments[0] &&
          ts.isStringLiteralLike(node.arguments[0]) &&
          node.arguments[0].text.startsWith('macro:')) ||
          (node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[1] &&
            macroOptions(node.arguments[1])))
      )
        macro = true
      if (!macro) ts.forEachChild(node, inspect)
    }
    inspect(ast)
    if (macro) return undefined
    // These declarations emit with dead-code elimination and tree shaking disabled.
    // Keep ambiguous erasure (imports, namespaces, enums, ambient declarations)
    // on Bun's emission path rather than rebuilding its erasure rules here.
    if (
      ast.statements.some(
        (statement) =>
          !(
            ts.canHaveModifiers(statement) &&
            ts
              .getModifiers(statement)
              ?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)
          ) &&
          ((ts.isFunctionDeclaration(statement) && statement.body !== undefined) ||
            ts.isClassDeclaration(statement) ||
            ts.isVariableStatement(statement) ||
            (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression))),
      )
    )
      return true
    try {
      const emitted = ts.createSourceFile(
        ast.fileName,
        transpiler.transformSync(ast.text),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      )
      if (
        (emitted as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
          .length
      )
        return undefined
      return emitted.statements.some(
        (statement) =>
          !ts.isEmptyStatement(statement) &&
          !(
            ts.isExportDeclaration(statement) &&
            !statement.moduleSpecifier &&
            statement.exportClause &&
            ts.isNamedExports(statement.exportClause) &&
            statement.exportClause.elements.length === 0
          ),
      )
    } catch {
      return undefined
    }
  }
}
