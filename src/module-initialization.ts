import ts from 'typescript'
import { dirname, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Component, Source } from './model.ts'

/** Type syntax remains structural ancestry without loading its referenced module. */
export function runtimeReference(node: ts.Node): boolean {
  for (let current = node; current.parent; current = current.parent) {
    const parent = current.parent
    if (
      ts.isExpressionWithTypeArguments(parent) &&
      current === parent.expression &&
      ts.isHeritageClause(parent.parent) &&
      parent.parent.token === ts.SyntaxKind.ExtendsKeyword &&
      ts.isClassLike(parent.parent.parent)
    )
      continue
    if (
      ts.isTypeNode(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent)
    )
      return false
  }
  return true
}

type Connect = (
  owner: Component,
  target: Component | undefined,
  node: ts.Node,
  kind?: 'reference' | 'entry-point' | 'module-initialization',
  runtime?: boolean,
) => void

/** Runtime imports establish startup dependencies, not ancestry for every export. */
export function moduleInitialization(
  root: string,
  source: Source,
  program: ts.Program,
  nodes: Map<ts.Node, Component>,
  entries: Map<string, Component[]>,
  used: Set<ts.Symbol>,
  launches: { owner: Component; node: ts.Node; file: string }[],
  connect: Connect,
) {
  const checker = program.getTypeChecker()
  const canonical = (file: string) => resolve(file)
  const included = new Map(source.files.map(({ file }) => [canonical(resolve(root, file)), file]))
  const bindingFiles = new Set(
    source.components
      .filter((component) => component.kind === 'binding')
      .map((component) => component.file),
  )
  const role = (file: string): Component['kind'] =>
    bindingFiles.has(file)
      ? 'binding'
      : /(?:^|\/)(?:test|tests)\/|\.(?:test|spec)\./.test(file)
        ? 'test'
        : 'production'
  const testFiles = new Set(
    source.files.filter(({ file }) => role(file) === 'test').map(({ file }) => file),
  )
  const imports = new Map<string, { file: string; node: ts.Node }[]>()
  const modes = new Map<string, boolean>()
  const problem = (message: string) => {
    if (!source.problems.includes(message)) source.problems.push(message)
  }
  const importMode = (file: string, measured: boolean): boolean => {
    let directory = dirname(file)
    const searched: string[] = []
    let preserve = false
    while (true) {
      const key = measured + ':' + directory
      if (modes.has(key)) {
        preserve = modes.get(key)!
        break
      }
      searched.push(directory)
      const config = resolve(directory, 'tsconfig.json')
      if (existsSync(config)) {
        if (measured && !included.has(canonical(config))) {
          problem('Module initialization requires measured Bun configuration: ' + config)
          break
        }
        const parsed = ts.parseConfigFileTextToJson(config, readFileSync(config, 'utf8'))
        if (parsed.error || !parsed.config || typeof parsed.config !== 'object') {
          problem('Unsupported Bun import configuration: ' + config)
          break
        }
        const options = parsed.config.compilerOptions ?? {}
        if (typeof options !== 'object' || Array.isArray(options)) {
          problem('Unsupported Bun import configuration: ' + config)
          break
        }
        if (
          parsed.config.extends !== undefined ||
          options.verbatimModuleSyntax === true ||
          (options.verbatimModuleSyntax !== undefined &&
            typeof options.verbatimModuleSyntax !== 'boolean') ||
          options.importsNotUsedAsValues !== undefined ||
          options.preserveValueImports === true ||
          options.emitDecoratorMetadata === true
        )
          problem(
            'Module initialization requires an adapter for preserved, inherited or legacy import/decorator settings: ' +
              config,
          )
        preserve = false
        break
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    for (const searchedDirectory of searched)
      modes.set(measured + ':' + searchedDirectory, preserve)
    return preserve
  }
  const preservesImports = (file: string): boolean => {
    if (
      /--tsconfig-override(?:[=\s]|$)/.test(process.env.BUN_OPTIONS ?? '') ||
      process.execArgv.some(
        (argument) =>
          argument === '--tsconfig-override' || argument.startsWith('--tsconfig-override='),
      )
    )
      problem('Module initialization requires an adapter for Bun tsconfig overrides')
    // Bun's evidence worker imports do not necessarily use the candidate's nearest
    // config. Support default elision only; preserve/inherited contexts block.
    importMode(resolve(process.cwd(), '<runtime>'), false)
    importMode(fileURLToPath(import.meta.url), false)
    return importMode(file, true)
  }
  const target = (specifier: ts.StringLiteralLike): string | undefined => {
    const module = checker.getSymbolAtLocation(specifier)
    const declaration = module?.declarations?.find(ts.isSourceFile)
    const direct = specifier.text.startsWith('.')
      ? program.getSourceFile(resolve(dirname(specifier.getSourceFile().fileName), specifier.text))
      : undefined
    const ast = declaration ?? direct
    if (!ast || program.isSourceFileFromExternalLibrary(ast)) return undefined
    return included.get(canonical(ast.fileName))
  }
  for (const [file] of entries) imports.set(file, [])
  for (const { file } of source.files) {
    if (!/\.[cm]?ts$/.test(file)) continue
    const ast = program.getSourceFile(resolve(root, file))!
    const loads: { file: string; node: ts.Node }[] = []
    const preserve = () => preservesImports(ast.fileName)
    const exported = new Set<string>()
    for (const statement of ast.statements)
      if (
        ts.isExportDeclaration(statement) &&
        !statement.isTypeOnly &&
        !statement.moduleSpecifier &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      )
        for (const binding of statement.exportClause.elements)
          if (!binding.isTypeOnly) exported.add((binding.propertyName ?? binding.name).text)
    for (const statement of ast.statements) {
      let specifier: ts.Expression | undefined
      let loadsAtStartup = false
      if (ts.isImportDeclaration(statement)) {
        specifier = statement.moduleSpecifier
        const clause = statement.importClause
        if (!clause) loadsAtStartup = true
        else if (!clause.isTypeOnly) {
          const bindings = clause.namedBindings
          const names = [
            ...(clause.name ? [clause.name] : []),
            ...(bindings && ts.isNamespaceImport(bindings)
              ? [bindings.name]
              : bindings && ts.isNamedImports(bindings)
                ? bindings.elements
                    .filter((binding) => !binding.isTypeOnly)
                    .map((binding) => binding.name)
                : []),
          ]
          loadsAtStartup =
            (bindings !== undefined &&
              ts.isNamedImports(bindings) &&
              bindings.elements.length === 0) ||
            names.some((name) => {
              const symbol = checker.getSymbolAtLocation(name)
              return exported.has(name.text) || (symbol !== undefined && used.has(symbol))
            }) ||
            preserve()
        }
      } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
        specifier = statement.moduleSpecifier
        loadsAtStartup =
          !statement.isTypeOnly &&
          (!statement.exportClause ||
            !ts.isNamedExports(statement.exportClause) ||
            statement.exportClause.elements.length === 0 ||
            statement.exportClause.elements.some((binding) => !binding.isTypeOnly) ||
            preserve())
      }
      if (!loadsAtStartup || !specifier || !ts.isStringLiteralLike(specifier)) continue
      const imported = target(specifier)
      if (imported) loads.push({ file: imported, node: statement })
    }
    imports.set(file, loads)
  }
  // Share direct module-load facts instead of repeating transitive startup per component.
  // Verification test registration is not production module initialization ancestry.
  const active = new Set(
    [...entries]
      .filter(([file, values]) => !testFiles.has(file) && values.length)
      .map(([file]) => file),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const [file, loads] of imports) {
      if (testFiles.has(file) || active.has(file) || !loads.some((load) => active.has(load.file)))
        continue
      active.add(file)
      changed = true
    }
  }
  const hubs = new Map<string, Component>()
  for (const file of active) {
    const hub: Component = {
      file,
      line: 1,
      id: file + '#<module-initialization>',
      name: '<module-initialization>',
      kind: role(file),
      tokens: 0,
    }
    hubs.set(file, hub)
    source.components.push(hub)
  }
  for (const [file, hub] of hubs) {
    const ast = program.getSourceFile(resolve(root, file))!
    for (const entry of entries.get(file) ?? []) connect(hub, entry, ast, 'module-initialization')
    for (const load of imports.get(file) ?? [])
      connect(hub, hubs.get(load.file), load.node, 'module-initialization')
  }
  for (const launch of launches)
    if (launch.owner.kind !== 'test')
      connect(launch.owner, hubs.get(launch.file), launch.node, 'entry-point')
  for (const [node, owner] of nodes) {
    if (owner.kind === 'test') continue
    connect(owner, hubs.get(owner.file), node, 'module-initialization')
    const visit = (child: ts.Node): void => {
      if (
        ts.isCallExpression(child) &&
        child.expression.kind === ts.SyntaxKind.ImportKeyword &&
        child.arguments[0] &&
        ts.isStringLiteralLike(child.arguments[0])
      ) {
        const imported = target(child.arguments[0])
        if (imported) connect(owner, hubs.get(imported), child, 'module-initialization')
      }
      ts.forEachChild(child, visit)
    }
    visit(node)
  }
}
