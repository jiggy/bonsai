import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { invoke } from './cli.ts'
import { project, write } from './project.ts'

const registry =
  "import { writeFileSync } from 'node:fs'\nwriteFileSync(new URL('./must-not-run', import.meta.url), 'ran')\nexport const actions = {}\n"
const existingFeature = '# Keep this existing requirement\nFeature: Existing product\n'

export function projectBehavior(input: { case: string }) {
  const fixture = project({ 'bindings.ts': registry, 'features/existing.feature': existingFeature })
  const { root } = fixture
  try {
    if (input.case === 'preserve-existing') {
      write(root, 'bonsai.json', '// Keep the existing policy\n{"custom":true}\n')
      const report = invoke(['init', '--root', root])
      return {
        ...report,
        configurationText: readFileSync(join(root, 'bonsai.json'), 'utf8'),
        bindingText: readFileSync(join(root, 'bindings.ts'), 'utf8'),
        featureText: readFileSync(join(root, 'features/existing.feature'), 'utf8'),
        handlerExecuted: existsSync(join(root, 'must-not-run')),
      }
    }
    if (input.case === 'reuse-inputs') {
      rmSync(join(root, 'bonsai.json'))
      return {
        ...invoke(['init', '--root', root]),
        bindingText: readFileSync(join(root, 'bindings.ts'), 'utf8'),
        featureText: readFileSync(join(root, 'features/existing.feature'), 'utf8'),
        handlerExecuted: existsSync(join(root, 'must-not-run')),
      }
    }
    if (input.case === 'saved-scope') {
      rmSync(join(root, 'bonsai.json'))
      rmSync(join(root, 'bindings.ts'))
      rmSync(join(root, 'features'), { recursive: true })
      write(root, '.gitignore', '*.generated.ts\n')
      write(root, 'src/app.ts', 'export function app() { return 1 }\n')
      write(root, 'examples/child/bonsai.json', '{}\n')
      write(root, 'examples/child/child.ts', 'export const child = true\n')
      const report = invoke(['init', '--root', root])
      write(root, 'src/later.generated.ts', 'export const generated = true\n')
      write(root, 'src/later.ts', 'export const authored = true\n')
      write(root, '.gitignore', 'src/later.ts\n')
      const checked = invoke(['check', '--root', root])
      return {
        ...report,
        inventory: checked.snapshot.source.files.map((file: { file: string }) => file.file),
        nestedConfigurationText: readFileSync(join(root, 'examples/child/bonsai.json'), 'utf8'),
      }
    }
    if (input.case === 'blocked-starter') {
      rmSync(join(root, 'bonsai.json'))
      rmSync(join(root, 'bindings.ts'))
      rmSync(join(root, 'features'), { recursive: true })
      write(root, 'features', 'Keep the existing features file\n')
      return {
        ...invoke(['init', '--root', root]),
        configurationExists: existsSync(join(root, 'bonsai.json')),
        bindingExists: existsSync(join(root, 'bonsai.bindings.ts')),
        featuresText: readFileSync(join(root, 'features'), 'utf8'),
      }
    }
    if (input.case === 'config-precedence') {
      const original = readFileSync(join(root, 'bonsai.json'), 'utf8')
      const selected = structuredClone(fixture.config)
      selected.policy.bootstrap = 777
      write(
        root,
        'selected.jsonc',
        '// An explicit policy with JSON comments\n' + JSON.stringify(selected),
      )
      return {
        ...invoke(['config', 'show', '--root', root, '--policy', join(root, 'selected.jsonc')], {
          BONSAI_ROOT: join(root, 'missing-root'),
          BONSAI_POLICY: join(root, 'missing-policy.json'),
        }),
        configurationUnchanged: readFileSync(join(root, 'bonsai.json'), 'utf8') === original,
        handlerExecuted: existsSync(join(root, 'must-not-run')),
      }
    }
    if (input.case === 'piped-policy') {
      const original = readFileSync(join(root, 'bonsai.json'), 'utf8')
      const selected = structuredClone(fixture.config)
      selected.policy.bootstrap = 888
      const policy = '// A policy supplied through standard input\n' + JSON.stringify(selected)
      return {
        ...invoke(['config', 'show', '--root', root, '--policy', '-'], {}, policy),
        configurationUnchanged: readFileSync(join(root, 'bonsai.json'), 'utf8') === original,
        handlerExecuted: existsSync(join(root, 'must-not-run')),
      }
    }
    if (
      input.case === 'explain-readonly' ||
      input.case === 'piped-target' ||
      input.case === 'conflicting-pipes'
    ) {
      const text =
        'Feature: Example\nScenario: Read result\n When I invoke "app" with {}\n Then response "status" equals "ok"\n'
      write(
        root,
        'handler.ts',
        "import { writeFileSync } from 'node:fs'\nexport function app() { writeFileSync(new URL('./must-not-run', import.meta.url), 'ran'); return { status: 'ok' } }\n",
      )
      write(
        root,
        'bindings.ts',
        "import { app } from './handler.ts'\nexport const actions = { 'app': app }\n",
      )
      write(root, 'features/existing.feature', text)
      fixture.config.maintained.push('handler.ts')
      write(root, 'bonsai.json', JSON.stringify(fixture.config))
      const report =
        input.case === 'piped-target'
          ? invoke(['explain', '-', '--root', root], {}, 'handler.ts#app\r\nhandler.ts#app\n')
          : input.case === 'conflicting-pipes'
            ? invoke(
                ['explain', '-', '--root', root, '--policy', '-'],
                {},
                JSON.stringify(fixture.config),
              )
            : invoke(['explain', 'handler.ts#app', '--root', root])
      return {
        ...report,
        handlerExecuted: existsSync(join(root, 'must-not-run')),
      }
    }
    throw new Error(`Unknown project fixture: ${input.case}`)
  } finally {
    fixture.dispose()
  }
}
