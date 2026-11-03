import { Parser, AstBuilder, GherkinClassicTokenMatcher, compile } from '@cucumber/gherkin'
import type { Contracts, Step, Check, Reference } from './model.ts'
import {
  createDomainStepMatcher,
  substituteDomainValue,
  type DomainStepDefinition,
} from './domain-steps.ts'

export const normalizeSelector = (selector: string) => selector.replace(/\[\d+\]/g, '[*]')
export const pairKey = (action: string, selector: string) =>
  JSON.stringify([action, normalizeSelector(selector)])

/** Compile every pickle, including every outline row; never deduplicate obligations. */
export function compileContracts(
  files: { file: string; text: string }[],
  definitions: DomainStepDefinition[] = [],
): Contracts {
  const result: Contracts = { pairs: [], checks: [], cases: [], problems: [] }
  const pairs = new Set<string>()
  let matchDomain: ReturnType<typeof createDomainStepMatcher>
  try {
    matchDomain = createDomainStepMatcher(definitions)
  } catch (error) {
    result.problems.push(`Invalid domain step definitions: ${String(error)}`)
    return result
  }
  for (const { file, text } of files) {
    try {
      let next = 0
      const nextId = () => (next++).toString()
      const document = new Parser(new AstBuilder(nextId), new GherkinClassicTokenMatcher()).parse(
        text,
      )
      const locations = new Map<string, number>()
      const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return
        const node = value as Record<string, unknown>
        if (typeof node.id === 'string' && node.location)
          locations.set(node.id, (node.location as { line: number }).line)
        for (const child of Object.values(node)) {
          if (Array.isArray(child)) child.forEach(visit)
          else if (child && typeof child === 'object') visit(child)
        }
      }
      visit(document)
      for (const [index, pickle] of compile(document, file, nextId).entries()) {
        const steps: Step[] = []
        let action: string | undefined
        let observations = 0
        let context: Record<string, unknown> = {}
        const contextRefs: Reference[] = []
        let actionRefs: Reference[] = []
        for (const [stepIndex, step] of pickle.steps.entries()) {
          const line = locations.get(step.astNodeIds[0]) ?? 1
          const mergeInput = (input: unknown): unknown => {
            if (!Object.keys(context).length) return input
            if (!input || typeof input !== 'object' || Array.isArray(input))
              throw new Error(`${file}:${line}: Given context requires an object action input`)
            const duplicate = Object.keys(input).find((key) => Object.hasOwn(context, key))
            if (duplicate !== undefined)
              throw new Error(`${file}:${line}: input field is already set by Given: ${duplicate}`)
            return Object.fromEntries([...Object.entries(context), ...Object.entries(input)])
          }
          const invokeAction = (name: string, input: unknown, refs: Reference[]) => {
            if (action && observations === 0)
              throw new Error(`${file}:${line}: action has no observation`)
            action = name
            observations = 0
            actionRefs = [...contextRefs, ...refs]
            steps.push({
              kind: 'action',
              action,
              input: mergeInput(input),
              ...(actionRefs.length && { definitionRefs: actionRefs }),
            })
          }
          const observeValue = (
            selector: string,
            expected: unknown,
            refs: Reference[],
            suffix = '',
          ) => {
            if (!action) throw new Error(`${file}:${line}: observation has no preceding action`)
            if (!/^[A-Za-z_$][\w$]*(?:\[\d+\]|\.[A-Za-z_$][\w$]*)*$/.test(selector))
              throw new Error(`${file}:${line}: unsupported response selector`)
            const definitionRefs = [...actionRefs, ...refs]
            const check: Check = {
              id: `${file}:${index}:${stepIndex}${suffix}`,
              file,
              line,
              action,
              selector,
              expected,
              ...(definitionRefs.length && { definitionRefs }),
            }
            result.checks.push(check)
            observations++
            pairs.add(pairKey(action, selector))
            steps.push({ kind: 'observation', check })
          }
          const invoke = /^I invoke "([^"\n]+)" with (.+)$/.exec(step.text)
          const observe = /^response "([^"\n]+)" equals (.+)$/.exec(step.text)
          if (step.argument)
            throw new Error(`${file}:${line}: DataTables and DocStrings are not supported yet`)
          let matches: ReturnType<typeof matchDomain>
          try {
            matches = matchDomain(step.text)
          } catch (error) {
            throw new Error(`${file}:${line}: invalid domain step parameter: ${String(error)}`)
          }
          const role =
            step.type === 'Context'
              ? 'given'
              : step.type === 'Action'
                ? 'when'
                : step.type === 'Outcome'
                  ? 'then'
                  : undefined
          const matching = matches.filter(({ definition }) => definition.kind === role)
          if (matching.length > 1 || (matching.length && (invoke || observe)))
            throw new Error(`${file}:${line}: ambiguous domain step: ${step.text}`)
          if (invoke) {
            invokeAction(invoke[1]!, JSON.parse(invoke[2]!), [])
          } else if (observe && action) {
            observeValue(observe[1]!, JSON.parse(observe[2]!), [])
          } else if (matching.length) {
            const { definition, parameters } = matching[0]!
            if (definition.kind === 'given') {
              if (action)
                throw new Error(
                  `${file}:${line}: Given context must precede every action in its scenario`,
                )
              context = mergeInput(substituteDomainValue(definition.input, parameters)) as Record<
                string,
                unknown
              >
              contextRefs.push(definition.sourceRef)
            } else if (definition.kind === 'when') {
              invokeAction(
                definition.action,
                substituteDomainValue(definition.input ?? {}, parameters),
                [definition.sourceRef],
              )
            } else {
              for (const [observationIndex, observation] of definition.observations.entries()) {
                observeValue(
                  observation.selector,
                  substituteDomainValue(observation.equals, parameters),
                  [definition.sourceRef],
                  definition.observations.length > 1 ? `:${observationIndex}` : '',
                )
              }
            }
          } else if (matches.length) {
            throw new Error(
              `${file}:${line}: domain step is not bound for its Given/When/Then role: ${step.text}`,
            )
          } else throw new Error(`${file}:${line}: unsupported or unbound step: ${step.text}`)
        }
        if (!action || observations === 0)
          throw new Error(`${file}: scenario must invoke an action and observe its result`)
        if (pickle.tags.some((tag) => /@(skip|ignore|pending)/i.test(tag.name))) {
          throw new Error(`${file}: skip tags are not accepted`)
        }
        result.cases.push({ id: `${file}:${index}`, name: pickle.name, steps })
      }
    } catch (error) {
      result.problems.push(String(error))
    }
  }
  if (!result.cases.length) result.problems.push('No executable contract cases found')
  result.pairs = [...pairs].sort()
  return result
}
