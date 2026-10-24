import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { createCompilerSession, sourceCompilerOptions } from '../src/compiler.ts'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bonsai-compiler-'))
  return {
    root,
    write(file: string, text: string) {
      const path = join(root, file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
      return path
    },
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

function diagnostics(program: ts.Program) {
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
    code: diagnostic.code,
    category: diagnostic.category,
    file: diagnostic.file?.fileName,
    start: diagnostic.start,
    length: diagnostic.length,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    related: diagnostic.relatedInformation?.map((related) => ({
      code: related.code,
      file: related.file?.fileName,
      start: related.start,
      message: ts.flattenDiagnosticMessageText(related.messageText, '\n'),
    })),
  }))
}

function exportedTypes(program: ts.Program, rootNames: string[]) {
  const checker = program.getTypeChecker()
  return rootNames.map((fileName) => {
    const file = program.getSourceFile(fileName)!
    const symbol = checker.getSymbolAtLocation(file)
    return symbol
      ? checker.getExportsOfModule(symbol).map((exported) => ({
          name: exported.name,
          type: checker.typeToString(checker.getTypeOfSymbolAtLocation(exported, file)),
        }))
      : []
  })
}

function references(program: ts.Program, rootNames: string[]) {
  const checker = program.getTypeChecker()
  const declarationTargets = (symbol: ts.Symbol | undefined) =>
    symbol?.declarations?.map((declaration) => ({
      file: declaration.getSourceFile().fileName,
      start: declaration.getStart(),
      kind: declaration.kind,
    }))
  return rootNames.map((fileName) => {
    const facts: unknown[] = []
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node)
        const target =
          symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
        facts.push({
          name: node.text,
          start: node.getStart(),
          target: declarationTargets(target),
          type: checker.typeToString(checker.getTypeAtLocation(node)),
        })
      }
      if (ts.isPropertyAccessExpression(node)) {
        facts.push({
          property: node.name.text,
          target: declarationTargets(
            checker.getPropertyOfType(checker.getTypeAtLocation(node.expression), node.name.text),
          ),
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(program.getSourceFile(fileName)!)
    return facts
  })
}

function compare(session: ReturnType<typeof createCompilerSession>, rootNames: string[]) {
  const program = session.program(rootNames)
  const reference = ts.createProgram(rootNames, sourceCompilerOptions)
  assert.deepEqual(diagnostics(program), diagnostics(reference))
  assert.deepEqual(
    program.getSourceFiles().map((file) => file.fileName),
    reference.getSourceFiles().map((file) => file.fileName),
  )
  assert.deepEqual(exportedTypes(program, rootNames), exportedTypes(reference, rootNames))
  assert.deepEqual(references(program, rootNames), references(reference, rootNames))
  return program
}

test('compiler sessions preserve full compiler options and refresh edited source diagnostics', () => {
  assert.deepEqual(sourceCompilerOptions, {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
    noEmit: true,
    strict: true,
    skipLibCheck: true,
  })
  const project = fixture()
  const session = createCompilerSession()
  try {
    const entry = project.write('entry.ts', 'export const result: string = 42\n')
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 2322))
    project.write('entry.ts', 'export const result: number = 42\n')
    assert.deepEqual(diagnostics(compare(session, [entry])), [])
    assert.deepEqual(diagnostics(compare(session, [entry])), [])
    project.write('entry.ts', 'export const result: string = 42\n')
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 2322))
  } finally {
    session.dispose()
    project.dispose()
  }
})

test('compiler sessions reread declarations outside the maintained root files', () => {
  const project = fixture()
  const session = createCompilerSession()
  try {
    const entry = project.write(
      'entry.ts',
      "import { value as external } from './external/value.js'\nexport const result: string = external.value\n",
    )
    project.write('external/value.d.ts', 'export declare const value: { value: string }\n')
    assert.deepEqual(diagnostics(compare(session, [entry])), [])
    project.write('external/value.d.ts', 'export declare const value: { value: number }\n')
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 2322))
    project.write('external/value.d.ts', 'export declare const value: { value: string }\n')
    assert.deepEqual(diagnostics(compare(session, [entry])), [])
  } finally {
    session.dispose()
    project.dispose()
  }
})

test('compiler sessions resolve newly created modules and forget deleted targets', () => {
  const project = fixture()
  const session = createCompilerSession()
  try {
    const entry = project.write(
      'entry.ts',
      "import { value } from './new/value.js'\nexport const result: string = value\n",
    )
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 2307))
    const target = project.write('new/value.ts', "export const value = 'ready'\n")
    assert.deepEqual(diagnostics(compare(session, [entry])), [])
    rmSync(target)
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 2307))
    project.write('new/value.ts', 'export const value = 42\n')
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 2322))
  } finally {
    session.dispose()
    project.dispose()
  }
})

test('compiler sessions refresh package declaration resolution and NodeNext parse context', () => {
  const project = fixture()
  const session = createCompilerSession()
  try {
    project.write('package.json', '{"type":"module"}')
    const entry = project.write(
      'entry.ts',
      "import { value } from 'library'\nexport const result: string = value\nexport const url = import.meta.url\n",
    )
    project.write('node_modules/library/string.d.ts', 'export declare const value: string\n')
    project.write('node_modules/library/number.d.ts', 'export declare const value: number\n')
    project.write('node_modules/library/package.json', '{"types":"string.d.ts"}')
    assert.deepEqual(diagnostics(compare(session, [entry])), [])
    project.write('node_modules/library/package.json', '{"types":"number.d.ts"}')
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 2322))
    project.write('node_modules/library/package.json', '{"types":"string.d.ts"}')
    project.write('package.json', '{"type":"commonjs"}')
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 1470))
    project.write('package.json', '{"type":"module"}')
    assert.deepEqual(diagnostics(compare(session, [entry])), [])
  } finally {
    session.dispose()
    project.dispose()
  }
})

test('compiler sessions rebuild global symbol scope when the root file set changes', () => {
  const project = fixture()
  const other = fixture()
  const session = createCompilerSession()
  try {
    const entry = project.write('entry.ts', 'export const result: string = BonsaiInput\n')
    const declaration = project.write('input.d.ts', 'declare const BonsaiInput: string\n')
    assert.deepEqual(diagnostics(compare(session, [entry, declaration])), [])
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 2304))
    assert.deepEqual(diagnostics(compare(session, [entry, declaration])), [])
    const otherDeclaration = other.write('input.d.ts', 'declare const BonsaiInput: number\n')
    assert.ok(
      diagnostics(compare(session, [entry, otherDeclaration])).some((item) => item.code === 2322),
    )
    assert.deepEqual(diagnostics(compare(session, [entry, declaration])), [])
  } finally {
    session.dispose()
    project.dispose()
    other.dispose()
  }
})

test('compiler sessions isolate roots and preserve automatic ambient type discovery', () => {
  const first = fixture()
  const second = fixture()
  const session = createCompilerSession()
  const previousDirectory = process.cwd()
  const previousGetCurrentDirectory = ts.sys.getCurrentDirectory
  try {
    // TypeScript memoizes its launch directory. Model successive launch roots in
    // this process while both collectors continue using the same default host.
    ts.sys.getCurrentDirectory = () => process.cwd()
    const entry = first.write('entry.ts', 'export const result: string = BonsaiAmbient\n')
    process.chdir(first.root)
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 2304))
    const ambient = first.write(
      'node_modules/@types/bonsai-fixture/index.d.ts',
      'declare const BonsaiAmbient: string\n',
    )
    assert.deepEqual(diagnostics(compare(session, [entry])), [])
    first.write(
      'node_modules/@types/bonsai-fixture/index.d.ts',
      'declare const BonsaiAmbient: number\n',
    )
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 2322))
    rmSync(dirname(ambient), { recursive: true })
    assert.ok(diagnostics(compare(session, [entry])).some((item) => item.code === 2304))
    first.write(
      'node_modules/@types/bonsai-fixture/index.d.ts',
      'declare const BonsaiAmbient: string\n',
    )
    assert.deepEqual(diagnostics(compare(session, [entry])), [])
    const other = second.write('entry.ts', 'export const result: string = BonsaiAmbient\n')
    process.chdir(second.root)
    assert.ok(diagnostics(compare(session, [other])).some((item) => item.code === 2304))
    process.chdir(first.root)
    assert.deepEqual(diagnostics(compare(session, [entry])), [])
  } finally {
    ts.sys.getCurrentDirectory = previousGetCurrentDirectory
    process.chdir(previousDirectory)
    session.dispose()
    first.dispose()
    second.dispose()
  }
})
