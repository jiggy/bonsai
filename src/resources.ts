import ts from 'typescript'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Resource = { file: string } | { problem: string }

/** Resolve a bounded code-owned text read, without evaluating application code. */
export function createResourceAdapter(root: string, files: string[], program: ts.Program) {
  const checker = program.getTypeChecker()
  const readers = new Set<ts.Symbol>()
  const local = new Set<ts.Symbol>()
  for (const file of files) {
    const ast = program.getSourceFile(resolve(root, file))
    if (!ast) continue
    for (const statement of ast.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== 'node:fs'
      ) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings))
        for (const binding of bindings.elements) {
          if ((binding.propertyName ?? binding.name).text !== 'readFileSync' || binding.isTypeOnly || statement.importClause?.isTypeOnly) continue
          const symbol = checker.getSymbolAtLocation(binding.name)
          if (symbol) readers.add(symbol)
        }
    }
    const visit = (node: ts.Node): void => {
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
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  const canonicalRoot = realpathSync(root)
  const maintained = new Set(files)
  const within = (path: string) => {
    const name = relative(canonicalRoot, path)
    return name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name)
  }
  // These extensions declare a textual format. Unknown and binary formats need
  // their own accounting adapter, even if particular bytes happen to be ASCII.
  const textual = new Set(['.txt', '.json', '.sql', '.md', '.markdown', '.html', '.htm', '.css', '.svg', '.yaml', '.yml', '.toml', '.ini', '.xml', '.graphql', '.gql', '.csv', '.tsv', '.ts', '.mts', '.cts'])
  const validated = new Map<string, Resource>()
  return (call: ts.CallExpression): Resource | undefined => {
    if (!ts.isIdentifier(call.expression)) return undefined
    const reader = checker.getSymbolAtLocation(call.expression)
    if (!reader || !readers.has(reader)) return undefined
    const target = call.arguments[0]
    if (!target || !ts.isNewExpression(target) || !ts.isIdentifier(target.expression) || target.expression.text !== 'URL') return undefined
    const symbol = checker.getSymbolAtLocation(target.expression)
    if (!symbol || symbol.flags & ts.SymbolFlags.Alias || local.has(symbol)) return undefined
    const [path, base] = target.arguments ?? []
    if (
      !base ||
      !ts.isPropertyAccessExpression(base) ||
      base.name.text !== 'url' ||
      !ts.isMetaProperty(base.expression) ||
      base.expression.keywordToken !== ts.SyntaxKind.ImportKeyword ||
      base.expression.name.text !== 'meta'
    ) return undefined
    const unsupported = (reason: string): Resource => ({ problem: 'Unsupported resource dependency: ' + reason })
    if (!path || !ts.isStringLiteralLike(path)) return unsupported('computed module-relative URL')
    if (target.arguments?.length !== 2 || call.arguments.length !== 2) return unsupported('expected direct URL and UTF-8 encoding')
    const encoding = call.arguments[1]!
    if (!ts.isStringLiteralLike(encoding) || !['utf8', 'utf-8'].includes(encoding.text)) return unsupported('expected literal UTF-8 encoding')
    if (!/^\.{1,2}\//.test(path.text) || /[\\?#\u0000-\u001f\u007f]|%(?:2f|5c)/i.test(path.text)) return unsupported('expected a plain module-relative file URL')
    let absolute: string
    try {
      const url = new URL(path.text, pathToFileURL(target.getSourceFile().fileName))
      if (url.protocol !== 'file:' || url.search || url.hash) return unsupported('expected a local URL without search or hash')
      absolute = fileURLToPath(url)
    } catch { return unsupported('malformed file URL') }
    const file = relative(canonicalRoot, absolute).split(sep).join('/')
    if (!within(absolute) || !maintained.has(file)) return { problem: 'Resource dependency outside maintained inventory: ' + file }
    const prior = validated.get(file)
    if (prior) return prior
    let result: Resource
    try {
      let current = canonicalRoot
      for (const part of relative(canonicalRoot, absolute).split(sep)) {
        current = resolve(current, part)
        if (lstatSync(current).isSymbolicLink()) throw new Error('symlinked resource path')
      }
      if (!lstatSync(absolute).isFile()) throw new Error('resource is not a regular file')
      if (realpathSync(absolute) !== absolute || !within(realpathSync(absolute))) throw new Error('noncanonical resource path')
      if (!textual.has(extname(file).toLowerCase())) throw new Error('unsupported resource format; binary accounting is unavailable')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(absolute))
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('binary resource content is unsupported')
      result = { file }
    } catch (error) {
      result = { problem: 'Unsupported resource dependency: ' + file + ' — ' + (error instanceof Error ? error.message : String(error)) }
    }
    validated.set(file, result)
    return result
  }
}
