import type ts from 'typescript'

export type StructuralPolicy = { metric: 'control-depth-v1'; maxDepth: number }
export type ControlDepthRegion = {
  file: string
  line: number
  column: number
  kind: 'module' | 'function'
  name: string
  depth: number
  deepestLine: number
  deepestColumn: number
}
export type ControlDepthFacts = {
  metric: 'control-depth-v1'
  complete: boolean
  regions: ControlDepthRegion[]
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, minimum = 0): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum

export function validateStructuralPolicy(value: unknown): void {
  if (value === undefined) return
  if (
    !object(value) ||
    value.metric !== 'control-depth-v1' ||
    !integer(value.maxDepth) ||
    Object.keys(value).some((key) => key !== 'metric' && key !== 'maxDepth')
  )
    throw new Error(
      'policy.structural needs metric control-depth-v1 and a nonnegative integer maxDepth',
    )
}

/** The current metric needs a nonempty TypeScript scope without unsupported executable files. */
export function controlDepthSupported(
  files: readonly { file: string; executable?: boolean }[],
): boolean {
  const typescript = (file: string) => /\.[cm]?ts$/.test(file)
  return (
    files.every(({ executable }) => executable === undefined || typeof executable === 'boolean') &&
    files.some(({ file }) => typescript(file)) &&
    !files.some(
      ({ file, executable }) =>
        !typescript(file) && (executable === true || /\.(?:py[wi]?|rs|[cm]?jsx?|tsx)$/.test(file)),
    )
  )
}

/** Validate facts and one lexical module region per measured TypeScript file. */
export function validControlDepth(
  value: unknown,
  files: readonly { file: string; executable?: boolean }[],
): value is ControlDepthFacts {
  if (
    !object(value) ||
    value.metric !== 'control-depth-v1' ||
    typeof value.complete !== 'boolean' ||
    (value.complete && !controlDepthSupported(files)) ||
    Object.keys(value).some((key) => key !== 'metric' && key !== 'complete' && key !== 'regions') ||
    !Array.isArray(value.regions)
  )
    return false
  const expected = new Set(
    files.filter(({ file }) => /\.[cm]?ts$/.test(file)).map(({ file }) => file),
  )
  const modules = new Set<string>()
  const identities = new Set<string>()
  for (const region of value.regions) {
    if (
      !object(region) ||
      Object.keys(region).some(
        (key) =>
          ![
            'file',
            'line',
            'column',
            'kind',
            'name',
            'depth',
            'deepestLine',
            'deepestColumn',
          ].includes(key),
      ) ||
      typeof region.file !== 'string' ||
      !expected.has(region.file) ||
      !integer(region.line, 1) ||
      !integer(region.column, 1) ||
      (region.kind !== 'module' && region.kind !== 'function') ||
      typeof region.name !== 'string' ||
      !region.name.length ||
      !integer(region.depth) ||
      !integer(region.deepestLine, region.line) ||
      !integer(region.deepestColumn, 1)
    )
      return false
    const id = `${region.file}\0${region.kind}\0${region.line}\0${region.column}`
    if (identities.has(id)) return false
    identities.add(id)
    if (region.kind === 'module') {
      if (region.line !== 1 || region.column !== 1 || modules.has(region.file)) return false
      modules.add(region.file)
    }
  }
  return !value.complete || modules.size === expected.size
}

/** Reuse the collector's lexical AST/API; importing validators never loads TypeScript. */
export function measureControlDepth(
  syntax: typeof ts,
  ast: ts.SourceFile,
  file: string,
): ControlDepthRegion[] {
  const regions: ControlDepthRegion[] = []
  const location = (node: ts.Node) => {
    const point = ast.getLineAndCharacterOfPosition(node.getStart(ast))
    return { line: point.line + 1, column: point.character + 1 }
  }
  const functionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
    syntax.isFunctionDeclaration(node) ||
    syntax.isFunctionExpression(node) ||
    syntax.isArrowFunction(node) ||
    syntax.isMethodDeclaration(node) ||
    syntax.isGetAccessorDeclaration(node) ||
    syntax.isSetAccessorDeclaration(node) ||
    syntax.isConstructorDeclaration(node)
  const collect = (fn?: ts.FunctionLikeDeclaration) => {
    if (fn && !fn.body) return
    const start = fn ? location(fn) : { line: 1, column: 1 }
    const name =
      fn?.name && syntax.isIdentifier(fn.name)
        ? fn.name.text
        : fn && syntax.isConstructorDeclaration(fn)
          ? 'constructor'
          : fn
            ? '<anonymous>'
            : '<module>'
    const region: ControlDepthRegion = {
      file,
      ...start,
      kind: fn ? 'function' : 'module',
      name,
      depth: 0,
      deepestLine: start.line,
      deepestColumn: start.column,
    }
    regions.push(region)
    const visit = (node: ts.Node, depth: number): void => {
      if (functionLike(node)) {
        if (node.name && syntax.isComputedPropertyName(node.name))
          visit(node.name.expression, depth)
        if (syntax.canHaveDecorators(node))
          for (const decorator of syntax.getDecorators(node) ?? []) visit(decorator, depth)
        for (const parameter of node.parameters)
          if (syntax.canHaveDecorators(parameter))
            for (const decorator of syntax.getDecorators(parameter) ?? []) visit(decorator, depth)
        collect(node)
        return
      }
      const decision =
        syntax.isIfStatement(node) ||
        syntax.isForStatement(node) ||
        syntax.isForInStatement(node) ||
        syntax.isForOfStatement(node) ||
        syntax.isWhileStatement(node) ||
        syntax.isDoStatement(node) ||
        syntax.isSwitchStatement(node) ||
        syntax.isCatchClause(node) ||
        syntax.isConditionalExpression(node)
      const next = depth + Number(decision)
      if (next > region.depth) {
        const point = location(node)
        region.depth = next
        region.deepestLine = point.line
        region.deepestColumn = point.column
      }
      if (syntax.isIfStatement(node)) {
        visit(node.expression, next)
        visit(node.thenStatement, next)
        if (node.elseStatement) {
          let branch = node.elseStatement
          while (syntax.isBlock(branch) && branch.statements.length === 1)
            branch = branch.statements[0]!
          visit(node.elseStatement, syntax.isIfStatement(branch) ? depth : next)
        }
      } else syntax.forEachChild(node, (child) => visit(child, next))
    }
    if (fn) {
      for (const parameter of fn.parameters) {
        visit(parameter.name, 0)
        if (parameter.initializer) visit(parameter.initializer, 0)
      }
      visit(fn.body!, 0)
    } else for (const statement of ast.statements) visit(statement, 0)
  }
  collect()
  return regions
}
