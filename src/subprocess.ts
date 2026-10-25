import ts from 'typescript'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Builtin = { module: string; name: string }
type Target = { file: string; value: 'url' | 'path' }
type Launch = { file: string } | { problem: string }

/** A literal module URL identifies an executable, never all of its exports. */
export function createSubprocessAdapter(root: string, files: string[], program: ts.Program) {
  const checker = program.getTypeChecker()
  const imports = new Map<ts.Symbol, Builtin>()
  const constants = new Map<ts.Symbol, ts.VariableDeclaration>()
  const local = new Set<ts.Symbol>()
  const unalias = (symbol: ts.Symbol | undefined) =>
    symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
  const imported = (name: ts.Identifier, module: string, exported: string) => {
    const symbol = checker.getSymbolAtLocation(name)
    if (symbol) imports.set(symbol, { module, name: exported })
  }
  for (const file of files) {
    const ast = program.getSourceFile(resolve(root, file))
    if (!ast) continue
    for (const statement of ast.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !['node:child_process', 'node:url'].includes(statement.moduleSpecifier.text)
      )
        continue
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings))
        for (const binding of bindings.elements)
          imported(
            binding.name,
            statement.moduleSpecifier.text,
            (binding.propertyName ?? binding.name).text,
          )
    }
    const visit = (node: ts.Node) => {
      // Property accesses and object keys have names too, but cannot shadow
      // globals. Keep this set limited to declarations that bind value names.
      const declaration =
        ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isModuleDeclaration(node) ||
        ts.isBindingElement(node) ||
        ts.isImportSpecifier(node) ||
        ts.isImportClause(node) ||
        ts.isNamespaceImport(node) ||
        ts.isImportEqualsDeclaration(node)
      const name = declaration ? node.name : undefined
      if (name && ts.isIdentifier(name)) {
        const symbol = checker.getSymbolAtLocation(name)
        if (symbol) local.add(symbol)
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isVariableDeclarationList(node.parent) &&
        node.parent.flags & ts.NodeFlags.Const
      ) {
        if (ts.isIdentifier(node.name)) {
          const symbol = unalias(checker.getSymbolAtLocation(node.name))
          if (symbol) constants.set(symbol, node)
        } else if (ts.isObjectBindingPattern(node.name) && node.initializer) {
          let initializer = node.initializer
          if (ts.isAwaitExpression(initializer)) initializer = initializer.expression
          if (
            ts.isCallExpression(initializer) &&
            initializer.expression.kind === ts.SyntaxKind.ImportKeyword &&
            initializer.arguments.length === 1 &&
            ts.isStringLiteral(initializer.arguments[0]!)
          ) {
            for (const binding of node.name.elements) {
              const exported = binding.propertyName ?? binding.name
              if (
                !binding.dotDotDotToken &&
                ts.isIdentifier(binding.name) &&
                (ts.isIdentifier(exported) || ts.isStringLiteral(exported))
              )
                imported(binding.name, initializer.arguments[0]!.text, exported.text)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  const builtin = (expression: ts.Expression, module: string, names: string[]) => {
    if (!ts.isIdentifier(expression)) return false
    const symbol = checker.getSymbolAtLocation(expression)
    const entry = symbol && imports.get(symbol)
    return entry?.module === module && names.includes(entry.name)
  }
  const global = (expression: ts.Expression, name: string) => {
    if (!ts.isIdentifier(expression) || expression.text !== name) return false
    const symbol = checker.getSymbolAtLocation(expression)
    return symbol !== undefined && !(symbol.flags & ts.SymbolFlags.Alias) && !local.has(symbol)
  }
  const target = (expression: ts.Expression, seen = new Set<ts.Symbol>()): Target | undefined => {
    if (ts.isIdentifier(expression)) {
      const symbol = unalias(checker.getSymbolAtLocation(expression))
      const declaration = symbol && constants.get(symbol)
      if (!symbol || !declaration?.initializer || seen.has(symbol)) return undefined
      seen.add(symbol)
      const value = target(declaration.initializer, seen)
      // A const URL object can still have its pathname mutated. Only primitive
      // path strings may cross an alias without a separate mutation analysis.
      return value?.value === 'path' ? value : undefined
    }
    if (
      ts.isCallExpression(expression) &&
      expression.arguments.length === 1 &&
      builtin(expression.expression, 'node:url', ['fileURLToPath'])
    ) {
      const value = target(expression.arguments[0]!, seen)
      return value?.value === 'url' ? { file: value.file, value: 'path' } : undefined
    }
    if (
      !ts.isNewExpression(expression) ||
      !global(expression.expression, 'URL') ||
      expression.arguments?.length !== 2
    )
      return undefined
    const [path, base] = expression.arguments
    if (
      !path ||
      !ts.isStringLiteralLike(path) ||
      !/^\.{1,2}\//.test(path.text) ||
      !base ||
      !ts.isPropertyAccessExpression(base) ||
      base.name.text !== 'url' ||
      !ts.isMetaProperty(base.expression) ||
      base.expression.keywordToken !== ts.SyntaxKind.ImportKeyword ||
      base.expression.name.text !== 'meta'
    )
      return undefined
    try {
      const url = new URL(path.text, pathToFileURL(expression.getSourceFile().fileName))
      if (url.protocol !== 'file:' || url.search || url.hash) return undefined
      return { file: relative(root, fileURLToPath(url)).split(sep).join('/'), value: 'url' }
    } catch {
      return undefined
    }
  }
  const safeOptions = (options: ts.Expression | undefined, fork: boolean) => {
    if (!options) return true
    if (!ts.isObjectLiteralExpression(options)) return false
    for (const property of options.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
      )
        return false
      const name = property.name.text
      if (name === 'shell' && property.initializer.kind !== ts.SyntaxKind.FalseKeyword) return false
      if (fork && name === 'execPath') return false
      if (
        fork &&
        name === 'execArgv' &&
        (!ts.isArrayLiteralExpression(property.initializer) || property.initializer.elements.length)
      )
        return false
    }
    return true
  }
  const maintained = new Set(files)
  return (call: ts.CallExpression): Launch | undefined => {
    const fork = builtin(call.expression, 'node:child_process', ['fork'])
    let path: ts.Expression | undefined
    if (fork) {
      if (call.arguments.length > 3 || !safeOptions(call.arguments[2], true)) return undefined
      // Requiring an explicit argument array avoids confusing fork's options overload.
      if (call.arguments[1] && !ts.isArrayLiteralExpression(call.arguments[1])) return undefined
      path = call.arguments[0]
    } else {
      if (
        !builtin(call.expression, 'node:child_process', [
          'spawn',
          'spawnSync',
          'execFile',
          'execFileSync',
        ]) ||
        call.arguments.length > 3 ||
        !safeOptions(call.arguments[2], false)
      )
        return undefined
      const runtime = call.arguments[0]
      const args = call.arguments[1]
      if (
        !runtime ||
        !ts.isPropertyAccessExpression(runtime) ||
        runtime.name.text !== 'execPath' ||
        !global(runtime.expression, 'process') ||
        !args ||
        !ts.isArrayLiteralExpression(args)
      )
        return undefined
      const first = args.elements[0]
      if (!first || ts.isSpreadElement(first) || ts.isOmittedExpression(first)) return undefined
      path = first
    }
    const selected = path && target(path)
    if (!selected || (!fork && selected.value !== 'path')) return undefined
    if (!maintained.has(selected.file))
      return { problem: `Subprocess entry point outside maintained inventory: ${selected.file}` }
    if (!/\.[cm]?ts$/.test(selected.file))
      return { problem: `Unsupported subprocess entry point: ${selected.file}` }
    return { file: selected.file }
  }
}

/** Function/type declarations and inert exported values are not execution roots. */
export function executesAtEntry(node: ts.Node): boolean {
  const effect = (part: ts.Node): boolean => {
    if (ts.isFunctionLike(part) || ts.isClassExpression(part)) return false
    if (
      ts.isCallExpression(part) ||
      ts.isNewExpression(part) ||
      ts.isAwaitExpression(part) ||
      ts.isDeleteExpression(part) ||
      ts.isTaggedTemplateExpression(part) ||
      (ts.isBinaryExpression(part) &&
        part.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        part.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      ((ts.isPrefixUnaryExpression(part) || ts.isPostfixUnaryExpression(part)) &&
        (part.operator === ts.SyntaxKind.PlusPlusToken ||
          part.operator === ts.SyntaxKind.MinusMinusToken))
    )
      return true
    return ts.forEachChild(part, effect) ?? false
  }
  if (ts.isVariableDeclaration(node)) return node.initializer ? effect(node.initializer) : false
  if (ts.isExportAssignment(node) || ts.isExpressionStatement(node)) return effect(node.expression)
  return !ts.isDeclarationStatement(node) && !ts.isEmptyStatement(node)
}
