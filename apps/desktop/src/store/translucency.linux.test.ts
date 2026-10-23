// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

const KEY = 'hermes.desktop.translucency.v2'
const LEGACY_KEY = 'hermes.desktop.translucency.v1'

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

it.each([
  { name: 'original empty sections', key: KEY, payload: { mode: 'clear', base: {}, light: {}, dark: {} } },
  { name: 'untouched profile', key: KEY, payload: null },
  {
    name: 'nonzero book',
    key: KEY,
    payload: { mode: 'clear', base: { intensity: 72, fade: 81 }, light: { intensity: 91 }, dark: {} }
  },
  { name: 'legacy v1', key: LEGACY_KEY, payload: { mode: 'clear', intensity: 83, fade: 64 } }
])('Linux store sends opaque IPC and preserves $name', async ({ key, payload }) => {
  vi.resetModules()
  vi.useFakeTimers()
  localStorage.clear()

  if (payload !== null) {localStorage.setItem(key, JSON.stringify(payload))}
  // Renderer bridge fixture, not a claim about the host/compositor.
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux x86_64' })
  const send = vi.fn()
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { glassSupported: false, translucencySupported: false, setTranslucency: send }
  })
  const { normalizeBook } = await import('@hermes/shared/translucency')
  const store = await import('./translucency')
  const preferred = normalizeBook(payload, false)
  expect(send).toHaveBeenCalled()

  for (const appearance of ['dark', 'light', 'dark'] as const) {
    store.setAppearance(appearance)
    expect(store.$translucency.get()).toMatchObject({ mode: 'clear', intensity: 0, fade: 0 })
    expect(send.mock.lastCall?.[0]).toMatchObject({ mode: 'clear', intensity: 0, fade: 0 })

    for (const attr of ['data-hermes-clear', 'data-hermes-glass', 'data-hermes-glass-on']) {
      expect(document.documentElement.hasAttribute(attr)).toBe(false)
    }

    expect(store.$translucencyBook.get()).toEqual(preferred)
  }

  vi.advanceTimersByTime(150)
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(preferred)

  if (key === LEGACY_KEY) {expect(JSON.parse(localStorage.getItem(LEGACY_KEY)!)).toEqual(payload)}
})
