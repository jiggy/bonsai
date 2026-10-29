import ts from 'typescript'
import { measureControlDepth } from './control-depth.ts'
import { readFileSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import type { Source, Component } from './model.ts'
import { createSubprocessAdapter, executesAtEntry } from './subprocess.ts'

export { inventory, fingerprint } from './inventory.ts'

/** Lexical tokens, with literal payload charged in four-byte blocks. Comments are charged too. */
export function countTokens(text: string, typescript = false): number {
  if (!typescript) return (text.match(/[\p{L}\p{N}_]+|[^\s]/gu) ?? []).length
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  let count = 0
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.WhitespaceTrivia || token === ts.SyntaxKind.NewLineTrivia) continue
    const value = scanner.getTokenText()
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      count += countTokens(value)
    } else if (
      token === ts.SyntaxKind.StringLiteral ||
      token === ts.SyntaxKind.RegularExpressionLiteral ||
      token === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      token === ts.SyntaxKind.TemplateHead ||
      token === ts.SyntaxKind.TemplateMiddle ||
      token === ts.SyntaxKind.TemplateTail
    ) {
      count += Math.max(1, Math.ceil(Buffer.byteLength(value) / 4))
    } else count++
  }
  return count
}

/** Whole-inventory cost is independent of the selected semantic checker. */
export function measureSource(root: string, files: string[]): Source {
  const source: Source = {
    files: [],
    components: [],
    relationships: [],
    actions: Object.create(null),
    problems: [],
  }
  for (const file of files) {
    source.files.push({
      file,
      tokens: countTokens(readFileSync(resolve(root, file), 'utf8'), /\.[cm]?ts$/.test(file)),
    })
    if ((/\.[cm]?[jt]sx?$/.test(file) && !/\.[cm]?ts$/.test(file)) || file.endsWith('.rs'))
      source.problems.push(`Unsupported source language: ${file}`)
  }
  return source
}

/** Shared Bonsai rules consume resolved semantic facts. */
export function collectSourceGraph(
  root: string,
  files: string[],
  bindings: string,
  source: Source,
  program: ts.Program,
): Source {
  const scriptFiles = files.filter((file) => /\.[cm]?ts$/.test(file))
  source.controlDepth = { metric: 'control-depth-v1', complete: false, regions: [] }
  const checker = program.getTypeChecker()
  const nodes = new Map<ts.Node, Component>()
  const symbols = new Map<ts.Symbol, Component>()
  const unalias = (symbol: ts.Symbol | undefined) =>
    symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
  const reference = (node: ts.Node) => ({
    file: relative(root, node.getSourceFile().fileName).split(sep).join('/'),
    line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
  })
  for (const file of scriptFiles) {
    const ast = program.getSourceFile(resolve(root, file))!
    source.controlDepth.regions.push(...measureControlDepth(ts, ast, file))
    for (const statement of ast.statements) {
      if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) continue
      const declarations = ts.isVariableStatement(statement)
        ? [...statement.declarationList.declarations]
        : [statement]
      for (const node of declarations) {
        const named = node as ts.NamedDeclaration
        const name = named.name?.getText() ?? `<top-level:${node.getStart()}>`
        const component: Component = {
          ...reference(node),
          id: `${file}#${name}`,
          name,
          kind:
            file === bindings
              ? 'binding'
              : /(?:^|\/)(?:test|tests)\/|\.(?:test|spec)\./.test(file)
                ? 'test'
                : 'production',
          tokens: countTokens(node.getText(), true),
        }
        if (named.name && !ts.isIdentifier(named.name))
          source.problems.push(`Unsupported declaration: ${component.id}`)
        if (source.components.some((existing) => existing.id === component.id))
          source.problems.push(
            `Duplicate or overloaded component requires an adapter: ${component.id}`,
          )
        nodes.set(node, component)
        source.components.push(component)
        const symbol = named.name && unalias(checker.getSymbolAtLocation(named.name))
        if (symbol) symbols.set(symbol, component)
        if (file === bindings && ts.isVariableDeclaration(node) && name === 'actions') {
          source.registry = component.id
          if (
            !node.initializer ||
            !ts.isObjectLiteralExpression(node.initializer) ||
            !ts.isVariableStatement(statement) ||
            !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
          ) {
            source.problems.push('Bindings must export const actions = { "action": namedHandler }')
            continue
          }
        }
      }
    }
  }
  const seen = new Set<string>()
  const connect = (
    owner: Component,
    target: Component | undefined,
    node: ts.Node,
    kind: 'reference' | 'entry-point' = 'reference',
  ) => {
    if (!target || target.id === owner.id) return
    const key = `${owner.id}\0${target.id}\0${kind}`
    if (seen.has(key)) return
    seen.add(key)
    source.relationships.push({
      from: owner.id,
      to: target.id,
      kind,
      origin: 'static',
      sourceRef: reference(node),
    })
  }
  const subprocess = createSubprocessAdapter(root, files, program)
  const entries = new Map<string, Component[]>()
  for (const [node, component] of nodes)
    if (executesAtEntry(node))
      entries.set(component.file, [...(entries.get(component.file) ?? []), component])
  // This adapter belongs to the checker, not to arbitrary application imports.
  // The target primitive validates the selected project's inventory and identity.
  // A fixture project is a separate execution boundary, never ancestry for every
  // export of this project's registry. Evidence must contain its loading receipt.
  // Compare implementation contents as well as symbols: archives and separate
  // checkouts have different absolute paths, while lookalikes are not adapters.
  const implementations = new Map(
    ['evidence.ts', 'binding-target.ts'].map((file) => [
      file,
      readFileSync(new URL(file, import.meta.url), 'utf8'),
    ]),
  )
  const bindingImport = (call: ts.CallExpression, owner: ts.Node): boolean => {
    if (
      !ts.isFunctionDeclaration(owner) ||
      owner.name?.text !== 'collectEvidence' ||
      owner.getSourceFile().text !== implementations.get('evidence.ts') ||
      call.arguments.length !== 1
    )
      return false
    const argument = call.arguments[0]!
    if (!ts.isPropertyAccessExpression(argument) || argument.name.text !== 'url') return false
    const handle = checker.getSymbolAtLocation(argument.expression)?.valueDeclaration
    if (
      !handle ||
      !ts.isVariableDeclaration(handle) ||
      !ts.isIdentifier(handle.name) ||
      !ts.isVariableDeclarationList(handle.parent) ||
      !(handle.parent.flags & ts.NodeFlags.Const) ||
      !handle.initializer ||
      !ts.isCallExpression(handle.initializer)
    )
      return false
    const initializer = handle.initializer
    const primitive = unalias(checker.getSymbolAtLocation(initializer.expression))?.valueDeclaration
    if (
      !primitive ||
      !ts.isFunctionDeclaration(primitive) ||
      primitive.name?.text !== 'projectBindingTarget' ||
      primitive.getSourceFile().text !== implementations.get('binding-target.ts') ||
      initializer.arguments.length !== 3
    )
      return false
    return [0, 1, 3].every((parameter, index) => {
      const name = owner.parameters[parameter]?.name
      const value = initializer.arguments[index]!
      return (
        name &&
        ts.isIdentifier(name) &&
        ts.isIdentifier(value) &&
        checker.getSymbolAtLocation(name) === checker.getSymbolAtLocation(value)
      )
    })
  }
  for (const [node, owner] of nodes) {
    const visit = (child: ts.Node): void => {
      if (ts.isCallExpression(child)) {
        const launch = subprocess(child)
        if (launch && 'problem' in launch)
          source.problems.push(`${launch.problem} at ${owner.file}:${reference(child).line}`)
        else if (launch)
          for (const entry of entries.get(launch.file) ?? [])
            connect(owner, entry, child, 'entry-point')
      }
      if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = child.arguments[0]
        if (!specifier || !ts.isStringLiteralLike(specifier)) {
          if (bindingImport(child, node)) {
            const boundaries = (source.bindingImports ??= [])
            boundaries.push({
              ...reference(child),
              from: owner.id,
              adapter: 'project-bindings-v1',
              bindings,
            })
          } else {
            const location = child.getSourceFile().getLineAndCharacterOfPosition(child.getStart())
            source.problems.push(
              `Dynamic import requires an adapter: ${owner.id} at ${owner.file}:${location.line + 1}:${location.character + 1} — ${child.getText().replace(/\s+/g, ' ')}`,
            )
          }
        } else {
          // A named destructuring import has local symbols, not import aliases.
          // Resolve only its selected exports so unused siblings remain unrooted.
          let expression: ts.Node = child
          while (
            ts.isAwaitExpression(expression.parent) ||
            ts.isParenthesizedExpression(expression.parent) ||
            ts.isAsExpression(expression.parent)
          )
            expression = expression.parent
          if (
            ts.isVariableDeclaration(expression.parent) &&
            ts.isObjectBindingPattern(expression.parent.name)
          ) {
            const module = checker.getSymbolAtLocation(specifier)
            const exports = module ? checker.getExportsOfModule(module) : []
            for (const binding of expression.parent.name.elements) {
              const name = binding.propertyName ?? binding.name
              if (
                binding.dotDotDotToken ||
                !ts.isIdentifier(binding.name) ||
                (!ts.isIdentifier(name) && !ts.isStringLiteral(name))
              ) {
                source.problems.push(
                  `Unsupported dynamic import selection: ${owner.id} at ${owner.file}:${reference(child).line}`,
                )
                continue
              }
              const selected = exports.find((entry) => entry.getName() === name.text)
              const symbol = unalias(selected)
              const target = symbol && symbols.get(symbol)
              const local = checker.getSymbolAtLocation(binding.name)
              if (local && target) symbols.set(local, target)
              connect(owner, target, child)
            }
          }
        }
      }
      if (ts.isElementAccessExpression(child)) {
        const namespace = checker.getTypeAtLocation(child.expression)
        const localModule = namespace
          .getSymbol()
          ?.declarations?.some(
            (declaration) =>
              ts.isSourceFile(declaration) && !program.isSourceFileFromExternalLibrary(declaration),
          )
        if (localModule) {
          if (ts.isStringLiteralLike(child.argumentExpression)) {
            const selected = unalias(
              checker.getPropertyOfType(namespace, child.argumentExpression.text),
            )
            connect(owner, selected && symbols.get(selected), child)
          } else {
            source.problems.push(
              `Unsupported dynamic import selection: ${owner.id} at ${owner.file}:${reference(child).line} — ${child.getText()}`,
            )
          }
        }
      }
      if (ts.isIdentifier(child)) {
        const symbol = unalias(checker.getSymbolAtLocation(child))
        const target = symbol && symbols.get(symbol)
        connect(owner, target, child)
      }
      ts.forEachChild(child, visit)
    }
    visit(node)
    if (
      owner.id === source.registry &&
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          (!ts.isStringLiteral(property.name) && !ts.isIdentifier(property.name)) ||
          !ts.isIdentifier(property.initializer)
        ) {
          source.problems.push('Each action binding must be a literal key and named handler')
          continue
        }
        const symbol = unalias(checker.getSymbolAtLocation(property.initializer))
        const target = symbol && symbols.get(symbol)
        if (!target || target.kind !== 'production')
          source.problems.push(`Cannot resolve action handler: ${property.name.text}`)
        else if (Object.hasOwn(source.actions, property.name.text))
          source.problems.push(`Duplicate action: ${property.name.text}`)
        else source.actions[property.name.text] = target.id
      }
    }
  }
  // Imported local modules must be inside the measured inventory.
  const included = new Set(files.map((file) => resolve(root, file)))
  for (const ast of program.getSourceFiles()) {
    if (
      !program.isSourceFileFromExternalLibrary(ast) &&
      !program.isSourceFileDefaultLibrary(ast) &&
      !included.has(resolve(ast.fileName))
    ) {
      source.problems.push(
        `Local dependency outside maintained inventory: ${relative(root, ast.fileName)}`,
      )
    }
  }
  if (!source.registry) source.problems.push('No exported actions registry found')
  source.controlDepth.complete = true
  return source
}
