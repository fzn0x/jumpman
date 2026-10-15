import { describe, expect, it } from 'vitest'
import { addBasic, compactBasic, defaultBasic, formatBasicValue, isBasicDefault } from './basic.ts'

describe('basic adjustments', () => {
  it('adds deltas and clamps to slider range', () => {
    const b = { ...defaultBasic(), exposure: 4.5, contrast: 90 }
    const out = addBasic(b, { exposure: 1, contrast: -20, shadows: 15 })
    expect(out.exposure).toBe(5)
    expect(out.contrast).toBe(70)
    expect(out.shadows).toBe(15)
  })

  it('detects defaults and compacts zero entries', () => {
    expect(isBasicDefault(defaultBasic())).toBe(true)
    expect(isBasicDefault({ fade: 3 })).toBe(false)
    expect(compactBasic({ fade: 0, tint: 4 })).toEqual({ tint: 4 })
  })

  it('formats signed values with slider precision', () => {
    expect(formatBasicValue('exposure', 0.6)).toBe('+0.60')
    expect(formatBasicValue('brightness', -12)).toBe('-12')
    expect(formatBasicValue('brightness', 0)).toBe('0')
  })
})
