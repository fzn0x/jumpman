import { describe, expect, it } from 'vitest'
import {
  hexToRgb,
  hslToRgb,
  linearToOklab,
  linearToSrgb,
  luma,
  oklabToLinear,
  rgbToHex,
  rgbToHsl,
  solveWhiteBalance,
  srgbToLinear,
  wbGains,
} from './color.ts'
import type { RGB } from './lut.ts'

const close = (a: RGB, b: RGB, digits = 4) => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i] as number, digits)
}

describe('color conversions', () => {
  it('round-trips the sRGB transfer function', () => {
    for (const v of [0, 0.002, 0.04, 0.2, 0.5, 0.9, 1]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6)
    }
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3)
  })

  it('round-trips HSL', () => {
    for (const c of [
      [0.9, 0.2, 0.1],
      [0.1, 0.6, 0.3],
      [0.2, 0.3, 0.95],
      [0.5, 0.5, 0.5],
    ] as RGB[]) {
      close(hslToRgb(rgbToHsl(c)), c)
    }
    expect(rgbToHsl([1, 0, 0])[0]).toBe(0)
    expect(rgbToHsl([0, 0, 1])[0]).toBeCloseTo(240)
  })

  it('round-trips Oklab and maps white to L=1', () => {
    close(linearToOklab([1, 1, 1]), [1, 0, 0], 3)
    const c: RGB = [0.3, 0.6, 0.1]
    close(oklabToLinear(linearToOklab(c)), c)
  })

  it('converts hex colors', () => {
    expect(rgbToHex(hexToRgb('#FFA0A0'))).toBe('#ffa0a0')
    close(hexToRgb('#e00'), [14 / 15, 0, 0])
  })
})

describe('white balance', () => {
  it('keeps luminance constant', () => {
    expect(luma(wbGains(60, -30))).toBeCloseTo(1, 6)
    expect(wbGains(0, 0)).toEqual([1, 1, 1])
  })

  it('warms with positive temperature and adds magenta with positive tint', () => {
    const [r, g, b] = wbGains(50, 0)
    expect(r).toBeGreaterThan(b)
    const t = wbGains(0, 50)
    expect(t[1]).toBeLessThan(t[0])
    expect(g).toBeGreaterThan(0)
  })

  it('solves sliders that neutralize a color cast', () => {
    const cast: RGB = [0.3, 0.25, 0.18]
    const { temperature, tint } = solveWhiteBalance(cast, [1, 1, 1])
    const gains = wbGains(temperature, tint)
    const out = cast.map((v, i) => v * (gains[i] as number)) as RGB
    expect(out[0] / out[2]).toBeCloseTo(1, 3)
    expect(out[1] / Math.sqrt(out[0] * out[2])).toBeCloseTo(1, 3)
  })
})
