import { describe, expect, it } from 'vitest'
import { boxMean, guidedFilter, resizeBilinear } from './refine.ts'

describe('mask refinement', () => {
  it('resizes bilinearly and keeps flat images flat', () => {
    expect([...resizeBilinear([0, 1], 2, 1, 2, 1)]).toEqual([0, 1])
    expect([...resizeBilinear([0, 1], 2, 1, 4, 1)]).toEqual([0, 0.25, 0.75, 1])
    const flat = resizeBilinear(new Float32Array(6).fill(0.4), 3, 2, 7, 5)
    expect(flat).toHaveLength(35)
    for (const v of flat) expect(v).toBeCloseTo(0.4)
  })

  it('averages a window clipped at the borders', () => {
    const m = boxMean([1, 2, 3, 4], 4, 1, 1)
    expect([...m]).toEqual([1.5, 2, 3, 3.5])
    expect([...boxMean([5], 1, 1, 3)]).toEqual([5])
  })

  it('snaps a blurry mask edge to the edge of the guide', () => {
    const w = 32
    const h = 4
    const guide = new Float32Array(w * h)
    const blurry = new Float32Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        guide[y * w + x] = x < 16 ? 0.9 : 0.1
        blurry[y * w + x] = Math.min(1, Math.max(0, (24 - x) / 16))
      }
    const out = guidedFilter(guide, blurry, w, h, 4, 1e-4)
    // The input falls by 1/16 per pixel; the filtered mask steps where the guide does.
    const at = (x: number) => out[w + x] as number
    expect(at(15) - at(16)).toBeGreaterThan(0.3)
    expect(at(17) - at(18)).toBeLessThan(1 / 16)
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('leaves a constant mask unchanged', () => {
    const guide = Float32Array.from({ length: 64 }, (_, i) => (i % 7) / 7)
    for (const v of guidedFilter(guide, new Float32Array(64).fill(0.7), 8, 8, 2, 1e-3))
      expect(v).toBeCloseTo(0.7)
  })
})
