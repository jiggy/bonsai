import ts from 'typescript'
import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { jigPackageDigest } from './jig-evidence.ts'

type JigRoute =
  | {
      file: string
      declarations: ts.ExportAssignment[]
      selection: { route: string; packagePath: string; digest: string; settings: Record<string, unknown> }
    }
  | { problem: string }

/** Resolve the literal local-binding subset of Jig authoring without loading it. */
export function createJigRouteAdapter(root: string, files: string[], program: ts.Program) {
  const checker = program.getTypeChecker()
  const imports = new Map<ts.Symbol, { module: string; name: string }>()
  const locals = new Set<ts.Symbol>()
  const maintained = new Set(files)
  const canonicalRoot = realpathSync(root)
  for (const file of files) {
    const ast = program.getSourceFile(resolve(root, file))
    if (!ast) continue
    for (const statement of ast.statements) {
      if (
        !ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.importClause?.isTypeOnly
      ) continue
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings))
        for (const binding of bindings.elements) {
          if (binding.isTypeOnly) continue
          const symbol = checker.getSymbolAtLocation(binding.name)
          if (symbol) imports.set(symbol, {
            module: statement.moduleSpecifier.text, name: (binding.propertyName ?? binding.name).text,
          })
        }
    }
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) || ts.isParameter(node) ||
        ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) || ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node) ||
        ts.isBindingElement(node) || ts.isImportSpecifier(node) ||
        ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)
      ) {
        if (node.name && ts.isIdentifier(node.name)) {
          const symbol = checker.getSymbolAtLocation(node.name)
          if (symbol) locals.add(symbol)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  const imported = (expression: ts.Expression, module: string, names: string[]) => {
    if (!ts.isIdentifier(expression)) return false
    const symbol = checker.getSymbolAtLocation(expression)
    const binding = symbol && imports.get(symbol)
    return binding?.module === module && names.includes(binding.name)
  }
  const fail = (reason: string): never => { throw new Error(reason) }
  const properties = (expression: ts.Expression | undefined, label: string) => {
    if (!expression || !ts.isObjectLiteralExpression(expression))
      return fail(`${label} must be a literal object`)
    const result = new Map<string, ts.Expression>()
    for (const property of expression.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
      ) return fail(`${label} cannot contain computed keys, spreads, or shorthand properties`)
      const key = property.name.text
      if (key === '__proto__') return fail(`${label} cannot change its object prototype`)
      if (result.has(key)) return fail(`${label} has a duplicate ${key} property`)
      result.set(key, property.initializer)
    }
    return result
  }
  const projectPath = (expression: ts.Expression | undefined, label: string) => {
    if (!expression || !ts.isStringLiteralLike(expression))
      return fail(`${label} must be a literal project-relative path`)
    const path = expression.text.replace(/^\.\//, '')
    const segments = path.split('/')
    if (
      path.length > 1024 || segments.length > 64 ||
      segments.some((part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..' || part.length > 255) ||
      segments[0]!.toLowerCase() === '.jig'
    ) return fail(`${label} must be a plain local slash path without escapes or globs`)
    return path
  }
  const checkedPath = (file: string, directory = false) => {
    let path = canonicalRoot
    try {
      for (const part of file.split('/')) {
        path = resolve(path, part)
        if (lstatSync(path).isSymbolicLink()) return fail(`symlinked route path: ${file}`)
      }
      const info = lstatSync(path)
      if (directory ? !info.isDirectory() : !info.isFile()) return fail(`invalid route path: ${file}`)
      if (realpathSync(path) !== path) return fail(`noncanonical route path: ${file}`)
    } catch (error) {
      return fail(`cannot inspect route path ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
    return path
  }
  const sourceFile = (file: string) => {
    if (!maintained.has(file)) return fail(`route source outside maintained inventory: ${file}`)
    checkedPath(file)
    const ast = program.getSourceFile(resolve(root, file))
    if (!ast) return fail(`route source must be maintained TypeScript: ${file}`)
    return ast
  }
  const definition = (file: string, name: string) => {
    const ast = sourceFile(file)
    const exports = ast.statements.filter(ts.isExportAssignment)
    const declaration = exports[0]
    if (
      exports.length !== 1 || !declaration || declaration.isExportEquals ||
      !ts.isCallExpression(declaration.expression) ||
      !imported(declaration.expression.expression, '@jigging/jig', [name]) ||
      declaration.expression.arguments.length !== 1
    ) return fail(`${file} must directly export default ${name}({...}) from @jigging/jig`)
    return { declaration, values: properties(declaration.expression.arguments[0], file) }
  }
  const discovery = (expression: ts.Expression | undefined, label: string) => {
    if (
      !expression || !ts.isCallExpression(expression) ||
      !imported(expression.expression, '@jigging/jig', ['discover']) ||
      expression.arguments.length !== 1
    ) return fail(`${label} must use discover with literal directory roots`)
    const input = expression.arguments[0]!
    const roots = (ts.isArrayLiteralExpression(input) ? [...input.elements] : [input])
      .map((entry) => projectPath(entry, label))
    if (!roots.length || new Set(roots.map((path) => path.toLowerCase())).size !== roots.length)
      return fail(`${label} requires nonempty, distinct directory roots`)
    roots.forEach((path) => checkedPath(path, true))
    return roots
  }
  const literal = (value: ts.Expression): boolean => {
    if (
      ts.isStringLiteralLike(value) || ts.isNumericLiteral(value) ||
      [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(value.kind)
    ) return true
    if (ts.isPrefixUnaryExpression(value))
      return value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)
    if (ts.isArrayLiteralExpression(value)) return value.elements.every(literal)
    if (ts.isObjectLiteralExpression(value)) return [...properties(value, 'literal data').values()].every(literal)
    return false
  }
  const data = (value: ts.Expression, depth = 0): unknown => {
    if (depth > 64) return fail('binding settings exceed 64 JSON levels')
    if (ts.isStringLiteralLike(value)) return value.text
    if (ts.isNumericLiteral(value)) {
      const number = Number(value.text)
      return Number.isFinite(number) ? number : fail('binding settings need finite JSON numbers')
    }
    if (value.kind === ts.SyntaxKind.TrueKeyword) return true
    if (value.kind === ts.SyntaxKind.FalseKeyword) return false
    if (value.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand))
      return -(data(value.operand, depth) as number)
    if (ts.isArrayLiteralExpression(value)) return value.elements.map((entry) => data(entry, depth + 1))
    if (ts.isObjectLiteralExpression(value)) return Object.fromEntries([...properties(value, 'literal data')].map(([key, entry]) => [key, data(entry, depth + 1)]))
    return fail('binding settings must contain literal JSON data')
  }
  const projectCwd = (expression: ts.Expression | undefined) => {
    let value = expression
    if (
      value && ts.isCallExpression(value) && value.arguments.length === 1 &&
      imported(value.expression, 'node:url', ['fileURLToPath'])
    ) value = value.arguments[0]
    if (
      !value || !ts.isNewExpression(value) || !ts.isIdentifier(value.expression) ||
      value.expression.text !== 'URL' || value.arguments?.length !== 2
    ) return false
    const symbol = checker.getSymbolAtLocation(value.expression)
    if (!symbol || symbol.flags & ts.SymbolFlags.Alias || locals.has(symbol)) return false
    const [path, base] = value.arguments
    if (
      !path || !ts.isStringLiteralLike(path) || !/^\.{1,2}\//.test(path.text) ||
      /[\\?#%\u0000-\u001f\u007f]/.test(path.text) ||
      !base || !ts.isPropertyAccessExpression(base) || base.name.text !== 'url' ||
      !ts.isMetaProperty(base.expression) || base.expression.keywordToken !== ts.SyntaxKind.ImportKeyword ||
      base.expression.name.text !== 'meta'
    ) return false
    try {
      const cwd = fileURLToPath(new URL(path.text, pathToFileURL(value.getSourceFile().fileName)))
      return realpathSync(cwd) === canonicalRoot
    } catch { return false }
  }
  return (call: ts.CallExpression): JigRoute | undefined => {
    if (!imported(call.expression, 'node:child_process', ['spawn', 'spawnSync', 'execFile', 'execFileSync']))
      return undefined
    const executable = call.arguments[0]
    if (!executable || !ts.isStringLiteralLike(executable) || executable.text !== 'jig') return undefined
    const args = call.arguments[1]
    if (args && ts.isArrayLiteralExpression(args) && args.elements[0] &&
      ts.isStringLiteralLike(args.elements[0]) && args.elements[0].text !== 'run') return undefined
    try {
      if (
        call.arguments.length !== 3 || !args || !ts.isArrayLiteralExpression(args) ||
        args.elements.some((entry) => ts.isSpreadElement(entry) || ts.isOmittedExpression(entry)) ||
        !args.elements[0] || !ts.isStringLiteralLike(args.elements[0]) || args.elements[0].text !== 'run'
      ) return fail('use a literal jig run argument array and explicit project cwd options')
      const route = args.elements[1]
      if (!route || !ts.isStringLiteralLike(route) || !/^binding:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.text) || route.text.length > 72)
        return fail('only a literal binding:<id> route is supported')
      const flags = new Set<string>()
      for (let index = 2; index < args.elements.length; index++) {
        const flag = args.elements[index]!
        if (!ts.isStringLiteralLike(flag) || !['--input', '--json'].includes(flag.text) || flags.has(flag.text))
          return fail('named routes support only one --input value and one --json flag')
        flags.add(flag.text)
        if (flag.text === '--input' && !args.elements[++index]) return fail('--input requires a value')
      }
      const options = properties(call.arguments[2], 'Jig launch options')
      if (!projectCwd(options.get('cwd')))
        return fail('set cwd to a direct new URL(relativePath, import.meta.url) for the analyzed project root')
      for (const [name, value] of options) {
        if (name === 'cwd') continue
        if (name === 'shell' && value.kind === ts.SyntaxKind.FalseKeyword) continue
        if (!['encoding', 'timeout', 'maxBuffer', 'stdio', 'windowsHide', 'killSignal'].includes(name) || !literal(value))
          return fail(`unsupported Jig launch option: ${name}`)
      }
      const jig = definition('jig.ts', 'defineJig')
      if ([...jig.values.keys()].some((name) => name !== 'flows' && name !== 'bindings'))
        return fail('this adapter supports only flows and bindings in defineJig')
      const bindingRoots = discovery(jig.values.get('bindings'), 'Jig bindings')
      const flowRoots = discovery(jig.values.get('flows'), 'Jig flows')
      const members = new Map<string, string>()
      for (const directory of bindingRoots)
        for (const name of readdirSync(checkedPath(directory, true)).sort()) {
          if (!name.endsWith('.ts')) continue
          const id = name.slice(0, -3)
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64)
            return fail(`invalid binding declaration name: ${directory}/${name}`)
          const file = `${directory}/${name}`
          checkedPath(file)
          if (!maintained.has(file)) return fail(`discovered binding outside maintained inventory: ${file}`)
          if (members.has(id)) return fail(`ambiguous binding:${id}: ${members.get(id)} and ${file}`)
          members.set(id, file)
        }
      const bindingFile = members.get(route.text.slice('binding:'.length))
      if (!bindingFile) return fail(`missing ${route.text} in configured binding discovery`)
      const binding = definition(bindingFile, 'defineBinding')
      for (const [name, value] of binding.values) {
        if (name === 'package') continue
        if (name === 'settings' && ts.isObjectLiteralExpression(value) && literal(value)) continue
        if (['slots', 'attachments'].includes(name) && ts.isObjectLiteralExpression(value) && !value.properties.length) continue
        return fail(`${bindingFile}: unsupported ${name}; child route and attachment mappings need another adapter`)
      }
      const packagePath = projectPath(binding.values.get('package'), `${bindingFile} package`)
      if (!flowRoots.includes(dirname(packagePath).split(sep).join('/')))
        return fail(`selected package is not an immediate member of configured flow discovery: ${packagePath}`)
      const entries = readdirSync(checkedPath(packagePath, true)).filter((name) => /^FLOW\.[a-z0-9]{1,16}$/.test(name))
      if (entries.length !== 1 || entries[0] !== 'FLOW.ts')
        return fail(`${packagePath} must contain exactly one FLOW.ts implementation`)
      const file = `${packagePath}/FLOW.ts`
      sourceFile(file)
      const settings = binding.values.has('settings')
        ? data(binding.values.get('settings')!) as Record<string, unknown>
        : {}
      return {
        file, declarations: [jig.declaration, binding.declaration],
        selection: { route: route.text, packagePath, digest: jigPackageDigest(root, files, packagePath), settings },
      }
    } catch (error) {
      return { problem: `Unsupported Jig route: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}
