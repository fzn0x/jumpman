import { describe, expect, it } from 'vitest'
import { landscape, makeImage } from '../test/images.ts'
import { computeStats, differenceHash } from './stats.ts'

describe('computeStats', () => {
  it('measures exposure in EV', () => {
    const mid = computeStats(makeImage(32, 32, () => [0.5, 0.5, 0.5]))
    const bright = computeStats(makeImage(32, 32, () => [0.8, 0.8, 0.8]))
    expect(mid.logAvgLum).toBeCloseTo(Math.log2(0.214 + 1e-4), 1)
    expect(bright.logAvgLum).toBeGreaterThan(mid.logAvgLum + 1)
    expect(mid.contrast).toBeCloseTo(0, 5)
    expect(mid.p50).toBeCloseTo(0.5, 1)
  })

  it('detects sky and foliage in a landscape', () => {
    const s = computeStats(landscape())
    expect(s.scene.sky).toBeGreaterThan(0.6)
    expect(s.scene.foliage).toBeGreaterThan(0.3)
    expect(s.scene.skin).toBeLessThan(0.1)
    expect(s.palette.length).toBeGreaterThan(1)
    expect(s.paletteWeights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
  })

  it('reports warmth of a color cast', () => {
    const warm = computeStats(landscape({ cast: [1.2, 1, 0.7] }))
    const cool = computeStats(landscape({ cast: [0.8, 1, 1.2] }))
    expect(warm.scene.warmth).toBeGreaterThan(cool.scene.warmth)
  })

  it('finds an off-center subject', () => {
    const img = makeImage(60, 60, (u, v) =>
      Math.hypot(u - 0.7, v - 0.4) < 0.12 ? [0.9, 0.2, 0.2] : [0.4, 0.4, 0.4],
    )
    const s = computeStats(img)
    expect(s.subject.x).toBeGreaterThan(0.55)
    expect(s.subject.y).toBeLessThan(0.5)
  })

  it('produces stable hashes for similar images', () => {
    const a = differenceHash(landscape())
    const b = differenceHash(landscape({ gain: 0.9 }))
    expect(a).toHaveLength(16)
    let diff = 0
    for (let i = 0; i < 16; i++) {
      let x = Number.parseInt(a[i] as string, 16) ^ Number.parseInt(b[i] as string, 16)
      while (x) {
        diff += x & 1
        x >>= 1
      }
    }
    expect(diff).toBeLessThanOrEqual(2)
  })
})
