import { describe, expect, it } from 'vitest'
import { defaultBasic } from './basic.ts'
import { createBranch, createGlobalEdit, hasOverride, resolveLayers } from './edit.ts'
import { BASE_LAYER_ID, createBaseLayer, createLayer } from './layers.ts'
import {
  applyOp,
  applyOps,
  describeStep,
  GLOBAL,
  type MacroStep,
  overrideFromLayers,
  recordStep,
} from './ops.ts'

const photo = (photoId: string) => ({ kind: 'photo', photoId }) as const
const baseOf = (layers: ReturnType<typeof resolveLayers>) => {
  const b = layers.find((l) => l.id === BASE_LAYER_ID)
  if (b?.kind !== 'basic') throw new Error('no base layer')
  return b.params
}

describe('edit ops', () => {
  it('sets global sliders and individual deltas', () => {
    let b = createBranch()
    b = applyOp(b, {
      type: 'setBasic',
      layerId: BASE_LAYER_ID,
      key: 'exposure',
      value: 0.6,
      scope: GLOBAL,
    })
    b = applyOp(b, {
      type: 'setBasic',
      layerId: BASE_LAYER_ID,
      key: 'exposure',
      value: 0.2,
      scope: photo('p1'),
    })
    expect(b.photos.p1?.override.basicDeltas?.base?.exposure).toBeCloseTo(-0.4)
    expect(baseOf(resolveLayers(b.global, b.photos.p1)).exposure).toBeCloseTo(0.2)
    expect(baseOf(resolveLayers(b.global, b.photos.p2)).exposure).toBeCloseTo(0.6)
    // Moving the global value keeps the individual offset.
    b = applyOp(b, {
      type: 'setBasic',
      layerId: BASE_LAYER_ID,
      key: 'exposure',
      value: 1,
      scope: GLOBAL,
    })
    expect(baseOf(resolveLayers(b.global, b.photos.p1)).exposure).toBeCloseTo(0.6)
  })

  it('adds, updates, moves and removes layers in both scopes', () => {
    const lut = createLayer('lut', { id: 'lut', params: { lutId: 'builtin:mono' } })
    let b = createBranch()
    b = applyOp(b, { type: 'addLayer', layer: lut, scope: GLOBAL })
    b = applyOp(b, { type: 'updateLayer', layerId: 'lut', patch: { opacity: 0.5 }, scope: GLOBAL })
    expect(b.global.layers[1]?.opacity).toBe(0.5)
    b = applyOp(b, {
      type: 'updateLayer',
      layerId: 'lut',
      patch: { enabled: false },
      scope: photo('p1'),
    })
    expect(b.photos.p1?.override.hidden).toEqual(['lut'])
    b = applyOp(b, { type: 'moveLayer', layerId: 'lut', toIndex: 0, scope: GLOBAL })
    expect(b.global.layers.map((l) => l.id)).toEqual(['lut', BASE_LAYER_ID])
    b = applyOp(b, { type: 'removeLayer', layerId: 'lut', scope: GLOBAL })
    expect(b.global.layers.map((l) => l.id)).toEqual([BASE_LAYER_ID])
    expect(hasOverride(b.photos.p1)).toBe(false)
  })

  it('keeps photo-only layers separate', () => {
    const own = createLayer('basic', { id: 'own', params: { ...defaultBasic(), fade: 30 } })
    let b = applyOp(createBranch(), { type: 'addLayer', layer: own, scope: photo('p1') })
    b = applyOp(b, { type: 'setBasic', layerId: 'own', key: 'fade', value: 50, scope: photo('p1') })
    const l = b.photos.p1?.override.layers?.[0]
    expect(l?.kind === 'basic' && l.params.fade).toBe(50)
    b = applyOp(b, { type: 'removeLayer', layerId: 'own', scope: photo('p1') })
    expect(hasOverride(b.photos.p1)).toBe(false)
  })

  it('resets a photo, keeping auto-match if asked, and reverts everything', () => {
    let b = applyOps(createBranch(), [
      { type: 'setBasic', layerId: BASE_LAYER_ID, key: 'shadows', value: 30, scope: photo('p1') },
      {
        type: 'setNorms',
        norms: { p1: { exposure: 0.4, temperature: 0, tint: 0, contrast: 0, saturation: 0 } },
      },
    ])
    b = applyOp(b, { type: 'resetPhoto', photoId: 'p1', keepNorm: true })
    expect(hasOverride(b.photos.p1)).toBe(false)
    expect(b.photos.p1?.norm?.exposure).toBe(0.4)
    b = applyOp(b, {
      type: 'setBasic',
      layerId: BASE_LAYER_ID,
      key: 'contrast',
      value: 20,
      scope: GLOBAL,
    })
    b = applyOp(b, { type: 'resetAll' })
    expect(b.global).toEqual(createGlobalEdit())
    expect(b.photos.p1).toEqual({ override: {} })
  })

  it('applies looks by replacing or appending', () => {
    const look = [createBaseLayer({ contrast: 10 }), createLayer('lut', { params: { lutId: 'x' } })]
    let b = applyOp(createBranch(), {
      type: 'setBasic',
      layerId: BASE_LAYER_ID,
      key: 'contrast',
      value: 5,
      scope: GLOBAL,
    })
    const appended = applyOp(b, { type: 'applyLayers', layers: look, mode: 'append' })
    expect(appended.global.layers).toHaveLength(2)
    expect(baseOf(appended.global.layers).contrast).toBe(15)
    b = applyOp(b, {
      type: 'applyLayers',
      layers: [createLayer('lut', { params: { lutId: 'y' } })],
      mode: 'replace',
    })
    expect(b.global.layers[0]?.id).toBe(BASE_LAYER_ID)
    expect(b.global.layers).toHaveLength(2)
  })
})

describe('copy / paste', () => {
  it('pastes a photo edit so the targets resolve to the same stack', () => {
    const lut = createLayer('lut', { id: 'lut', params: { lutId: 'mono' } })
    let b = applyOps(createBranch(), [
      { type: 'addLayer', layer: lut, scope: GLOBAL },
      { type: 'setBasic', layerId: BASE_LAYER_ID, key: 'exposure', value: 0.5, scope: GLOBAL },
      {
        type: 'setBasic',
        layerId: BASE_LAYER_ID,
        key: 'exposure',
        value: 1.2,
        scope: photo('src'),
      },
      { type: 'updateLayer', layerId: 'lut', patch: { enabled: false }, scope: photo('src') },
    ])
    const copied = resolveLayers(b.global, b.photos.src)
    b = applyOp(b, { type: 'pasteToPhotos', photoIds: ['t1', 't2'], layers: copied })
    expect(resolveLayers(b.global, b.photos.t1)).toEqual(copied)
    expect(b.photos.t2?.override.hidden).toEqual(['lut'])
  })

  it('turns unknown layers into photo-only layers', () => {
    const o = overrideFromLayers(createGlobalEdit().layers, [createLayer('split', { id: 'x' })])
    expect(o.hidden).toEqual([BASE_LAYER_ID])
    expect(o.layers?.[0]?.kind).toBe('split')
  })
})

describe('macros', () => {
  it('records replayable steps and merges slider drags', () => {
    let steps: MacroStep[] = []
    for (const value of [0.1, 0.2, 0.3]) {
      steps = recordStep(steps, {
        kind: 'op',
        op: { type: 'setBasic', layerId: BASE_LAYER_ID, key: 'exposure', value, scope: GLOBAL },
      })
    }
    steps = recordStep(steps, { kind: 'op', op: { type: 'resetPhoto', photoId: 'p' } })
    steps = recordStep(steps, { kind: 'tool', tool: 'autoMatch' })
    expect(steps).toHaveLength(2)
    expect(describeStep(steps[0] as MacroStep)).toBe('Set exposure to 0.3')
    expect(describeStep(steps[1] as MacroStep)).toBe('Auto-match')
    const ops = steps.flatMap((s) => (s.kind === 'op' ? [s.op] : []))
    expect(baseOf(applyOps(createBranch(), ops).global.layers).exposure).toBe(0.3)
  })
})
