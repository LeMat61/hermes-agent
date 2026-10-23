import { describe, expect, it } from 'vitest'

import * as shared from '../../shared/src/translucency'

import { windowBackingOptions, windowOpacityOptions } from './translucency'

describe('effective translucency platform policy', () => {
  it.each(['light', 'dark'] as const)('keeps Linux opaque without changing %s preferences', appearance => {
    // Resolve real defaults as well as migrated/nonzero preferences before applying policy.
    for (const payload of [
      null,
      {},
      { mode: 'clear', base: {}, light: {}, dark: {} },
      { intensity: 81, fade: 70, mode: 'glass', material: 'header', scope: 'window' },
      { mode: 'clear', base: { intensity: 44, fade: 91 }, light: { intensity: 65 }, dark: {} }
    ]) {
      const book = shared.normalizeBook(payload, false)
      const before = structuredClone(book)
      const resolved = shared.resolveTranslucency(book, appearance, false)
      const original = structuredClone(resolved)
      expect(shared).toHaveProperty('effectiveTranslucencyState', expect.any(Function))
      // Even a stale/forged glass mode must be disabled independently of the
      // normalization capability gate, while leaving material/scope intact.
      const forced = { ...resolved, mode: 'glass' as const, fade: 95 }
      expect(shared.effectiveTranslucencyState(forced, false)).toEqual({
        ...forced,
        mode: 'clear',
        intensity: 0,
        fade: 0
      })
      const effective = shared.effectiveTranslucencyState(resolved, false)
      expect(effective).toEqual({ ...original, mode: 'clear', intensity: 0, fade: 0 })
      expect(windowOpacityOptions(effective)).toEqual({})
      expect(windowBackingOptions(effective, '#123456')).toEqual({ backgroundColor: '#123456' })
      expect(book).toEqual(before)
      expect(resolved).toEqual(original)
    }
  })

  it.each(['darwin', 'win32'])('preserves supported %s behavior independently of glass support', platform => {
    for (const glassSupported of [true, false]) {
      for (const mode of ['clear', 'glass']) {
        const state = shared.normalizeState({ mode, intensity: 64, fade: 48 }, glassSupported)
        expect(shared).toHaveProperty('effectiveTranslucencyState', expect.any(Function))
        const effective = shared.effectiveTranslucencyState(state, shared.translucencySupportedOn(platform))
        expect(effective).toEqual(state)
        expect(windowOpacityOptions(effective)).toEqual(windowOpacityOptions(state))
      }
    }
  })
})
