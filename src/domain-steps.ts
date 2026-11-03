import type ts from 'typescript'
import type { Reference } from './model.ts'

export type DomainValue =
  | null
  | boolean
  | number
  | string
  | DomainValue[]
  | { [key: string]: DomainValue }
export type DomainStepDefinition = { pattern: string; sourceRef: Reference } & (
  | { kind: 'given'; input: Record<string, DomainValue> }
  | { kind: 'when'; action: string; input?: Record<string, DomainValue> }
  | { kind: 'then'; observations: { selector: string; equals: DomainValue }[] }
)

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !/[\r\n]/.test(value)
const selector = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z_$][\w$]*(?:\[\d+\]|\.[A-Za-z_$][\w$]*)*$/.test(value)
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key))

function pattern(text: string) {
  if (!nonempty(text) || text.length > 4096) throw new Error('step pattern must be nonempty text')
  const parameters: { name: string; type: string }[] = []
  let expression = '^'
  let end = 0
  const literal = (value: string) => {
    if (/[{}]/.test(value)) throw new Error('unsupported step parameter; use {name:string}, {name:int}, or {name:json}')
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  for (const match of text.matchAll(/\{([A-Za-z_][\w]*):(string|int|json)\}/g)) {
    expression += literal(text.slice(end, match.index))
    const name = match[1]!
    const type = match[2]!
    if (parameters.length && match.index === end)
      throw new Error('step parameters need a literal separator')
    if (parameters.some((parameter) => parameter.name === name) || parameters.length >= 32)
      throw new Error('step parameters must have unique names; at most 32 are supported')
    end = match.index! + match[0].length
    if (type === 'json' && end !== text.length)
      throw new Error('a JSON parameter must end its step pattern')
    if (type === 'int' && /[0-9]/.test(text[end] ?? ''))
      throw new Error('an integer step parameter needs a nondigit separator')
    expression += type === 'string'
      ? '("(?:[^"\\\\\u0000-\u001f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*")'
      : type === 'int' ? '(-?(?:0|[1-9][0-9]*))' : '(.+)'
    parameters.push({ name, type })
  }
  expression += literal(text.slice(end)) + '$'
  return { expression: new RegExp(expression), parameters }
}

function validateValue(value: unknown, parameters: Set<string>, used: Set<string>, depth = 0): void {
  if (depth > 32) throw new Error('step values exceed the supported nesting depth')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) {
    for (const item of value) validateValue(item, parameters, used, depth + 1)
    return
  }
  if (!record(value)) throw new Error('step values must be JSON literals or parameter references')
  if (Object.hasOwn(value, 'parameter')) {
    if (Object.keys(value).length !== 1 || typeof value.parameter !== 'string' || !parameters.has(value.parameter))
      throw new Error('step parameter references must select a declared parameter')
    used.add(value.parameter)
    return
  }
  for (const item of Object.values(value)) validateValue(item, parameters, used, depth + 1)
}

function validateDefinition(value: unknown): asserts value is DomainStepDefinition {
  if (!record(value) || !nonempty(value.pattern) || !record(value.sourceRef) ||
    !nonempty(value.sourceRef.file) || !Number.isSafeInteger(value.sourceRef.line) ||
    (value.sourceRef.line as number) < 1 || !keys(value.sourceRef, ['file', 'line']))
    throw new Error('step definition needs a pattern and source location')
  const parameters = new Set(pattern(value.pattern).parameters.map((parameter) => parameter.name))
  const used = new Set<string>()
  if (value.kind === 'given' || value.kind === 'when') {
    const allowed = ['kind', 'pattern', 'sourceRef', 'input', ...(value.kind === 'when' ? ['action'] : [])]
    if (!keys(value, allowed)) throw new Error('unknown step definition setting')
    if (value.kind === 'given' && (!record(value.input) || !Object.keys(value.input).length))
      throw new Error('Given must construct a nonempty input object')
    if (value.kind === 'when' && !nonempty(value.action)) throw new Error('When needs a literal action name')
    if (value.input !== undefined) {
      if (!record(value.input) || Object.hasOwn(value.input, 'parameter'))
        throw new Error('step input must be an object of named input fields')
      validateValue(value.input, parameters, used)
    }
  } else if (value.kind === 'then') {
    if (!keys(value, ['kind', 'pattern', 'sourceRef', 'observations']) ||
      !Array.isArray(value.observations) || !value.observations.length)
      throw new Error('Then needs individually required observations')
    for (const observation of value.observations) {
      if (!record(observation) || !keys(observation, ['selector', 'equals']) ||
        !selector(observation.selector) || !Object.hasOwn(observation, 'equals'))
        throw new Error('each observation needs a literal selector and equals value')
      validateValue(observation.equals, parameters, used)
    }
  } else throw new Error('unsupported step definition kind')
  if ([...parameters].some((name) => !used.has(name)))
    throw new Error('every captured parameter must contribute to input or an observation')
}

/** Validate serialized adapter facts without loading the TypeScript compiler. */
export function validDomainStepDefinitions(value: unknown): value is DomainStepDefinition[] {
  if (!Array.isArray(value)) return false
  try {
    for (const definition of value) validateDefinition(definition)
    return true
  } catch {
    return false
  }
}

/** Read only literal metadata from the measured registry; never import candidate code. */
export function collectDomainSteps(tsApi: typeof ts, source: ts.SourceFile, file: string): {
  definitions: DomainStepDefinition[]
  problems: string[]
} {
  const definitions: DomainStepDefinition[] = []
  const problems: string[] = []
  const location = (node: ts.Node): Reference => ({
    file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
  })
  const read = (node: ts.Expression, depth = 0): DomainValue => {
    if (depth > 32) throw new Error('step values exceed the supported nesting depth')
    if (tsApi.isParenthesizedExpression(node) || tsApi.isAsExpression(node) ||
      tsApi.isTypeAssertionExpression(node) || tsApi.isSatisfiesExpression(node))
      return read(node.expression, depth + 1)
    if (tsApi.isStringLiteralLike(node)) return node.text
    if (tsApi.isNumericLiteral(node)) {
      const value = Number(node.text)
      if (Number.isFinite(value)) return value
    }
    if (node.kind === tsApi.SyntaxKind.NullKeyword) return null
    if (node.kind === tsApi.SyntaxKind.TrueKeyword) return true
    if (node.kind === tsApi.SyntaxKind.FalseKeyword) return false
    if (tsApi.isPrefixUnaryExpression(node) && node.operator === tsApi.SyntaxKind.MinusToken &&
      tsApi.isNumericLiteral(node.operand)) {
      const value = -Number(node.operand.text)
      if (Number.isFinite(value)) return value
    }
    if (tsApi.isArrayLiteralExpression(node)) return node.elements.map((item) => read(item, depth + 1))
    if (tsApi.isObjectLiteralExpression(node)) {
      const entries: [string, DomainValue][] = []
      const names = new Set<string>()
      for (const property of node.properties) {
        if (!tsApi.isPropertyAssignment(property) ||
          !(tsApi.isIdentifier(property.name) || tsApi.isStringLiteral(property.name) || tsApi.isNumericLiteral(property.name)))
          throw new Error('step metadata supports literal properties only')
        const name = property.name.text
        if (names.has(name)) throw new Error('duplicate step metadata property: ' + name)
        names.add(name)
        entries.push([name, read(property.initializer, depth + 1)])
      }
      return Object.fromEntries(entries)
    }
    throw new Error('step metadata must contain only JSON literals; callbacks, aliases, and spreads are unsupported')
  }
  let found = false
  for (const statement of source.statements) {
    if (tsApi.isExportDeclaration(statement) && statement.exportClause &&
      tsApi.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some((element) => element.name.text === 'steps')) {
      problems.push(`${file}:${location(statement).line}: step definitions must directly export const steps`)
    }
    if (!tsApi.isVariableStatement(statement) ||
      !tsApi.getModifiers(statement)?.some((modifier) => modifier.kind === tsApi.SyntaxKind.ExportKeyword)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!tsApi.isIdentifier(declaration.name) || declaration.name.text !== 'steps') continue
      try {
        if (found || !(statement.declarationList.flags & tsApi.NodeFlags.Const) || !declaration.initializer)
          throw new Error('step definitions require one exported const steps literal array')
        found = true
        let initializer = declaration.initializer
        while (tsApi.isParenthesizedExpression(initializer) || tsApi.isAsExpression(initializer) ||
          tsApi.isTypeAssertionExpression(initializer) || tsApi.isSatisfiesExpression(initializer))
          initializer = initializer.expression
        if (!tsApi.isArrayLiteralExpression(initializer))
          throw new Error('step definitions require one exported const steps literal array')
        for (const element of initializer.elements) {
          const raw = read(element)
          if (!record(raw)) throw new Error('each step definition must be a literal object')
          const kinds = ['given', 'when', 'then'].filter((kind) => Object.hasOwn(raw, kind))
          if (kinds.length !== 1) throw new Error('each step definition needs exactly one Given, When, or Then pattern')
          const kind = kinds[0]!
          if (!keys(raw, [kind, ...(kind === 'given' ? ['input'] : kind === 'when' ? ['action', 'input'] : ['observations'])]))
            throw new Error('unknown step definition setting')
          const { [kind]: text, ...settings } = raw
          const definition = { kind, pattern: text, ...settings, sourceRef: location(element) }
          validateDefinition(definition)
          definitions.push(definition)
        }
      } catch (error) {
        problems.push(`${file}:${location(declaration).line}: unsupported domain step definitions: ${String(error)}`)
      }
    }
  }
  return { definitions: problems.length ? [] : definitions, problems }
}

export function createDomainStepMatcher(definitions: DomainStepDefinition[]) {
  const prepared = definitions.map((definition) => {
    validateDefinition(definition)
    return { definition, ...pattern(definition.pattern) }
  })
  return (text: string) => prepared.flatMap(({ definition, expression, parameters }) => {
    const match = expression.exec(text)
    if (!match) return []
    const values = Object.fromEntries(parameters.map(({ name, type }, index) => {
      const value: unknown = JSON.parse(match[index + 1]!)
      if (type === 'int' && !Number.isSafeInteger(value)) throw new Error('integer step parameter is outside the exact safe range')
      // Parsed JSON values are data, including a literal object named "parameter".
      const finite = (item: unknown): boolean => typeof item === 'number' ? Number.isFinite(item)
        : item === null || typeof item !== 'object' || Object.values(item).every(finite)
      if (!finite(value)) throw new Error('step parameter must contain finite JSON numbers')
      return [name, value]
    }))
    return [{ definition, parameters: values }]
  })
}

export function substituteDomainValue(value: DomainValue, parameters: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((item) => substituteDomainValue(item, parameters))
  if (value !== null && typeof value === 'object') {
    if (Object.hasOwn(value, 'parameter')) return structuredClone(parameters[value.parameter as string])
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteDomainValue(item, parameters)]))
  }
  return value
}
