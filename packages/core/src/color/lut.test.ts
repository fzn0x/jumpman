import { describe, expect, it } from 'vitest'
import { createLut, identityLut, sampleLut } from './lut.ts'

describe('3D LUT', () => {
  it('identity LUT returns input colors', () => {
    const lut = identityLut(9)
    const out = sampleLut(lut, [0.13, 0.5, 0.91])
    expect(out[0]).toBeCloseTo(0.13, 5)
    expect(out[1]).toBeCloseTo(0.5, 5)
    expect(out[2]).toBeCloseTo(0.91, 5)
  })

  it('interpolates linear transforms exactly', () => {
    const lut = createLut(5, ([r, g, b]) => [1 - r, g * 0.5, b])
    const out = sampleLut(lut, [0.3, 0.7, 1])
    expect(out[0]).toBeCloseTo(0.7, 5)
    expect(out[1]).toBeCloseTo(0.35, 5)
    expect(out[2]).toBeCloseTo(1, 5)
  })
})
