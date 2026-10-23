import fs from 'node:fs'
import vm from 'node:vm'

import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

import * as translucency from './translucency'

// Execute the actual main-process seams, not copies of their logic. Loading the
// entire app would start backend/network/window services. AST selection keeps
// those out while retaining startup state, constructor options and IPC handler.
const source = fs.readFileSync(new URL('./main.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)

const functions = [
  'readPersistedTranslucency',
  'applyWindowOpacity',
  'applyWindowTranslucency',
  'chatWindowSurfaceOptions'
]

const selected = ast.statements.filter(node => {
  if (ts.isFunctionDeclaration(node)) {return functions.includes(node.name?.text ?? '')}

  if (ts.isVariableStatement(node))
    {return node.declarationList.declarations.some(d => d.name.getText(ast) === 'translucencyState')}

  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
    return (
      node.expression.expression.getText(ast) === 'ipcMain.on' &&
      node.expression.arguments[0]?.getText(ast) === "'hermes:translucency'"
    )
  }

  return false
})

const executable = ts.transpileModule(selected.map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText

function harness(platform: string, persisted: unknown, dark = true) {
  const handlers = new Map<string, (_event: unknown, payload: unknown) => void>()

  const windows = Array.from({ length: 2 }, () => ({
    isDestroyed: () => false,
    getOpacity: vi.fn(() => 1),
    setOpacity: vi.fn(),
    setBackgroundColor: vi.fn(),
    setBackgroundMaterial: vi.fn(),
    setVibrancy: vi.fn()
  }))

  const backing = new WeakSet(windows)
  const release = platform === 'win32' ? '10.0.19045' : ''

  const context = vm.createContext({
    ...translucency,
    normalizeTranslucency: translucency.normalizeState,
    vibrancyForTranslucency: translucency.vibrancyFor,
    GLASS_SUPPORTED: translucency.glassSupportedOn(platform, release),
    TRANSLUCENCY_SUPPORTED: translucency.translucencySupportedOn(platform),
    IS_MAC: platform === 'darwin',
    IS_WINDOWS: platform === 'win32',
    TRANSLUCENCY_CONFIG_PATH: '/isolated-fixture/translucency.json',
    nativeTheme: { shouldUseDarkColors: dark },
    fs: {
      readFileSync: () => {
        if (persisted === undefined) {throw new Error('ENOENT')}

        return JSON.stringify(persisted)
      }
    },
    ipcMain: {
      on: (name: string, handler: (_event: unknown, payload: unknown) => void) => handlers.set(name, handler)
    },
    BrowserWindow: { getAllWindows: () => windows },
    translucencyBackedWindows: backing,
    getWindowBackgroundColor: () => '#123456',
    scheduleTranslucencyWrite: vi.fn(),
    hudIpc: { applyHudFrost: vi.fn() },
    rememberLog: (message: string) => {
      throw new Error(message)
    }
  })

  vm.runInContext(executable, context)

  return {
    windows,
    options: () => vm.runInContext('chatWindowSurfaceOptions()', context),
    state: () => vm.runInContext('translucencyState', context),
    apply: (win: (typeof windows)[number]) => {
      context.testWindow = win
      vm.runInContext('applyWindowTranslucency(testWindow)', context)
    },
    ipc: (payload: unknown) => handlers.get('hermes:translucency')!(null, payload)
  }
}

describe('main platform authority', () => {
  it.each([true, false])('Linux cold launch is opaque before first renderer, dark=%s', dark => {
    for (const persisted of [
      undefined,
      { mode: 'clear', intensity: 82, fade: 91 },
      { mode: 'glass', intensity: 89, fade: 72 }
    ]) {
      const main = harness('linux', persisted, dark)
      expect(main.state()).toMatchObject({ mode: 'clear', intensity: 0, fade: 0 })
      // Shared options used by primary and secondary chat window constructors.
      expect(main.options()).not.toHaveProperty('opacity')
      expect(main.options().backgroundColor).toBe('#123456')

      for (const win of main.windows) {
        main.apply(win)
        expect(win.setOpacity).not.toHaveBeenCalled()
      }
    }
  })

  it('rejects nonzero IPC independently of renderer and can restore an already faded window', () => {
    const main = harness('linux', undefined)

    for (const payload of [
      { mode: 'clear', intensity: 100, fade: 100 },
      { mode: 'glass', intensity: 91, fade: 78 },
      { intensity: 73 }
    ]) {
      main.ipc(payload)
      expect(main.state()).toMatchObject({ mode: 'clear', intensity: 0, fade: 0 })
      expect(main.options()).not.toHaveProperty('opacity')

      for (const win of main.windows) {expect(win.setOpacity).not.toHaveBeenCalled()}
    }

    const faded = main.windows[0]
    faded.getOpacity.mockReturnValue(0.7)
    main.apply(faded)
    expect(faded.setOpacity).toHaveBeenCalledExactlyOnceWith(1)
  })

  it.each(['darwin', 'win32'])('keeps clear mode working on %s, including Windows without glass', platform => {
    const main = harness(platform, { mode: 'clear', intensity: 54 })
    expect(main.options().opacity).toBe(
      translucency.windowOpacityFor(translucency.normalizeState({ mode: 'clear', intensity: 54 }, false))
    )
    main.ipc({ mode: 'clear', intensity: 76, fade: 0 })

    for (const win of main.windows)
      {expect(win.setOpacity).toHaveBeenCalledExactlyOnceWith(translucency.windowOpacityFor(main.state()))}

    const opaque = harness(platform, { mode: 'clear', intensity: 0 })
    opaque.apply(opaque.windows[0])
    expect(opaque.windows[0].setOpacity).not.toHaveBeenCalled()
  })
})
