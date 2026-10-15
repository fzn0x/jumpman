import { describe, expect, it } from 'vitest'
import {
  createGlobalEdit,
  describeOverride,
  hasOverride,
  NORM_LAYER_ID,
  resolveLayers,
} from './edit.ts'
import { BASE_LAYER_ID, createBaseLayer, createLayer } from './layers.ts'

describe('resolveLayers', () => {
  const lut = createLayer('lut', { id: 'lut1', params: { lutId: 'spring-pink' } })
  const global = createGlobalEdit({
    layers: [createBaseLayer({ exposure: 0.6, shadows: 10 }), lut],
  })

  it('returns the global stack for photos without overrides', () => {
    const layers = resolveLayers(global, undefined)
    expect(layers.map((l) => l.id)).toEqual([BASE_LAYER_ID, 'lut1'])
  })

  it('applies per-photo deltas, hidden layers and own layers', () => {
    const own = createLayer('basic', {
      id: 'own',
      params: { ...createBaseLayer().params, fade: 20 },
    })
    const layers = resolveLayers(global, {
      override: {
        basicDeltas: { [BASE_LAYER_ID]: { exposure: -0.2 } },
        hidden: ['lut1'],
        layers: [own],
      },
    })
    expect(layers.map((l) => l.id)).toEqual([BASE_LAYER_ID, 'own'])
    const base = layers[0]
    expect(base?.kind === 'basic' && base.params.exposure).toBeCloseTo(0.4)
  })

  it('prepends auto-match corrections and drops no-op layers', () => {
    const layers = resolveLayers(createGlobalEdit(), {
      override: {},
      norm: { exposure: 0.3, temperature: 0, tint: 0, contrast: 0, saturation: 0 },
    })
    expect(layers.map((l) => l.id)).toEqual([NORM_LAYER_ID])
  })

  it('skips proposed layers until accepted', () => {
    const proposed = createLayer('lut', { params: { lutId: 'x' }, proposedBy: 'client' })
    const g = createGlobalEdit({ layers: [proposed] })
    expect(resolveLayers(g, undefined)).toEqual([])
  })
})

describe('overrides', () => {
  it('flags and describes deviations from the global edit', () => {
    expect(hasOverride(undefined)).toBe(false)
    expect(hasOverride({ override: { basicDeltas: { base: { exposure: 0 } } } })).toBe(false)
    const state = { override: { basicDeltas: { base: { exposure: 0.2 } }, crop: { cx: 0.3 } } }
    expect(hasOverride(state)).toBe(true)
    expect(describeOverride(state)).toEqual(['exposure', 'crop'])
  })
})
