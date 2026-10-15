import { describe, expect, it } from 'vitest'
import { builtinLut, builtinLutId, LOOKS } from './looks.ts'
import { sampleLut } from './lut.ts'

describe('built-in looks', () => {
  it('has unique ids', () => {
    expect(new Set(LOOKS.map((l) => l.id)).size).toBe(LOOKS.length)
  })

  it('bakes every look into a valid LUT', () => {
    for (const look of LOOKS) {
      const lut = builtinLut(builtinLutId(look.id), 9)
      expect(lut?.data.length).toBe(9 ** 3 * 3)
      expect(lut?.data.every((v) => v >= 0 && v <= 1)).toBe(true)
    }
  })

  it('caches baked LUTs and returns undefined for unknown ids', () => {
    expect(builtinLut('mono', 9)).toBe(builtinLut('builtin:mono', 9))
    expect(builtinLut('nope')).toBeUndefined()
  })

  it('mono look removes color', () => {
    const lut = builtinLut('mono', 17)
    if (!lut) throw new Error('missing')
    const [r, g, b] = sampleLut(lut, [0.8, 0.3, 0.2])
    expect(Math.abs(r - g) + Math.abs(g - b)).toBeLessThan(0.02)
  })
})
