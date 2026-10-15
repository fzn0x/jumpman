import { describe, expect, it } from 'vitest'
import { defaultBasic } from '../model/basic.ts'
import { createLayer, defaultHsl, defaultSplit } from '../model/layers.ts'
import { luma } from './color.ts'
import type { RGB } from './lut.ts'
import { sampleLut } from './lut.ts'
import {
  applyBasic,
  applyHsl,
  applySplit,
  bakeLut,
  hueBandWeights,
  maskValue,
  renderImage,
  toneCurve,
} from './pipeline.ts'

const ctx = { u: 0.5, v: 0.5, aspect: 1.5 }
const basic = (p: Partial<ReturnType<typeof defaultBasic>>) => ({ ...defaultBasic(), ...p })
const gray: RGB = [0.5, 0.5, 0.5]
const noLuts = () => undefined

describe('basic layer', () => {
  it('is the identity at default values', () => {
    for (const c of [gray, [0.9, 0.2, 0.1], [0.02, 0.4, 0.8]] as RGB[]) {
      const out = applyBasic(c, defaultBasic(), ctx)
      for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(c[i] as number, 5)
    }
  })

  it('brightens with exposure and recovers highlights', () => {
    expect(applyBasic(gray, basic({ exposure: 1 }), ctx)[0]).toBeGreaterThan(0.65)
    const bright: RGB = [0.92, 0.92, 0.92]
    expect(applyBasic(bright, basic({ highlights: -100 }), ctx)[0]).toBeLessThan(0.85)
    expect(toneCurve(1.4, basic({ highlights: -100, whites: -50 }))).toBeLessThan(1)
  })

  it('lifts shadows and crushes blacks', () => {
    const dark: RGB = [0.15, 0.15, 0.15]
    expect(applyBasic(dark, basic({ shadows: 80 }), ctx)[0]).toBeGreaterThan(0.2)
    expect(applyBasic(dark, basic({ blacks: -100 }), ctx)[0]).toBeLessThan(0.15)
  })

  it('applies contrast around a pivot', () => {
    const p = basic({ contrast: 60 })
    expect(applyBasic([0.25, 0.25, 0.25], p, ctx)[0]).toBeLessThan(0.25)
    expect(applyBasic([0.75, 0.75, 0.75], p, ctx)[0]).toBeGreaterThan(0.75)
  })

  it('warms, desaturates, fades and vignettes', () => {
    const warm = applyBasic(gray, basic({ temperature: 60 }), ctx)
    expect(warm[0]).toBeGreaterThan(warm[2])
    const mono = applyBasic([0.8, 0.3, 0.2], basic({ saturation: -100 }), ctx)
    expect(mono[0]).toBeCloseTo(mono[1], 5)
    expect(applyBasic([0, 0, 0], basic({ fade: 100 }), ctx)[0]).toBeGreaterThan(0.05)
    const corner = applyBasic(gray, basic({ vignette: -100 }), { u: 0, v: 0, aspect: 1.5 })
    const center = applyBasic(gray, basic({ vignette: -100 }), ctx)
    expect(corner[0]).toBeLessThan(center[0])
  })

  it('adds grain deterministically', () => {
    const a = applyBasic(gray, basic({ grain: 100 }), { u: 0.31, v: 0.62, aspect: 1 })
    const b = applyBasic(gray, basic({ grain: 100 }), { u: 0.31, v: 0.62, aspect: 1 })
    expect(a).toEqual(b)
  })
})

describe('hsl, split toning and masks', () => {
  it('hue band weights form a partition of unity', () => {
    for (const h of [0, 15, 45, 100, 200, 250, 290, 330, 359]) {
      const sum = hueBandWeights(h).reduce((s, w) => s + w, 0)
      expect(sum).toBeCloseTo(1, 6)
    }
    expect(hueBandWeights(240)[5]).toBe(1)
  })

  it('targets only the chosen hue band', () => {
    const params = defaultHsl()
    params.blue.saturation = -100
    const blue = applyHsl([0.1, 0.2, 0.9], params)
    expect(Math.max(...blue) - Math.min(...blue)).toBeLessThan(0.05)
    const red: RGB = [0.9, 0.1, 0.1]
    expect(applyHsl(red, params)).toEqual(red)
  })

  it('tints shadows while roughly preserving luminance', () => {
    const p = { ...defaultSplit(), shadowHue: 220, shadowSaturation: 100 }
    const dark: RGB = [0.15, 0.15, 0.15]
    const out = applySplit(dark, p)
    expect(out[2]).toBeGreaterThan(out[0])
    expect(luma(out)).toBeCloseTo(luma(dark), 2)
  })

  it('evaluates masks', () => {
    const radial = { type: 'radial', cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2, feather: 0.3 } as const
    expect(maskValue(radial, gray, ctx)).toBe(1)
    expect(maskValue(radial, gray, { ...ctx, u: 0.95 })).toBe(0)
    expect(maskValue({ ...radial, invert: true }, gray, ctx)).toBe(0)
    const linear = { type: 'linear', x0: 0, y0: 0, x1: 0, y1: 1 } as const
    expect(maskValue(linear, gray, { ...ctx, v: 0 })).toBe(1)
    expect(maskValue(linear, gray, { ...ctx, v: 1 })).toBe(0)
    const sky = { type: 'sky' } as const
    expect(maskValue(sky, [0.45, 0.65, 0.95], { ...ctx, v: 0.1 })).toBeGreaterThan(0.8)
    expect(maskValue(sky, [0.3, 0.5, 0.2], { ...ctx, v: 0.9 })).toBe(0)
  })
})

describe('render and bake', () => {
  it('blends layers by opacity', () => {
    const src = { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]) }
    const full = renderImage(
      src,
      [createLayer('basic', { params: basic({ saturation: 0, exposure: 1 }) })],
      noLuts,
    )
    const half = renderImage(
      src,
      [createLayer('basic', { params: basic({ exposure: 1 }), opacity: 0.5 })],
      noLuts,
    )
    const f = full.data[0] as number
    const h = half.data[0] as number
    expect(h).toBeGreaterThan(128)
    expect(h).toBeLessThan(f)
  })

  it('bakes color layers into a LUT', () => {
    const lut = bakeLut(
      [createLayer('basic', { params: basic({ saturation: -100, vignette: -100 }) })],
      noLuts,
      17,
    )
    const out = sampleLut(lut, [0.8, 0.2, 0.3])
    expect(out[0]).toBeCloseTo(out[1], 2)
    const id = bakeLut([], noLuts, 9)
    expect(sampleLut(id, [0.3, 0.6, 0.9])[2]).toBeCloseTo(0.9, 4)
  })
})
