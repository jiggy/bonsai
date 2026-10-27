import { Parser, AstBuilder, GherkinClassicTokenMatcher, compile } from '@cucumber/gherkin'
import type { Contracts, Step, Check } from './model.ts'

export const normalizeSelector = (selector: string) => selector.replace(/\[\d+\]/g, '[*]')
export const pairKey = (action: string, selector: string) =>
  JSON.stringify([action, normalizeSelector(selector)])

/** Compile every pickle, including every outline row; never deduplicate obligations. */
export function compileContracts(files: { file: string; text: string }[]): Contracts {
  const result: Contracts = { pairs: [], checks: [], cases: [], problems: [] }
  const pairs = new Set<string>()
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
        for (const [stepIndex, step] of pickle.steps.entries()) {
          const line = locations.get(step.astNodeIds[0]) ?? 1
          const invoke = /^I invoke "([^"\n]+)" with (.+)$/.exec(step.text)
          const observe = /^response "([^"\n]+)" equals (.+)$/.exec(step.text)
          if (step.argument)
            throw new Error(`${file}:${line}: DataTables and DocStrings are not supported yet`)
          if (invoke) {
            if (action && observations === 0)
              throw new Error(`${file}:${line}: action has no observation`)
            action = invoke[1]
            observations = 0
            steps.push({ kind: 'action', action, input: JSON.parse(invoke[2]) })
          } else if (observe && action) {
            if (!/^[A-Za-z_$][\w$]*(?:\[\d+\]|\.[A-Za-z_$][\w$]*)*$/.test(observe[1])) {
              throw new Error(`${file}:${line}: unsupported response selector`)
            }
            const check: Check = {
              id: `${file}:${index}:${stepIndex}`,
              file,
              line,
              action,
              selector: observe[1],
              expected: JSON.parse(observe[2]),
            }
            result.checks.push(check)
            observations++
            pairs.add(pairKey(action, check.selector))
            steps.push({ kind: 'observation', check })
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
