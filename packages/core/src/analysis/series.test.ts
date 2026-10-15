import { describe, expect, it } from 'vitest'
import { createLayer } from '../model/layers.ts'
import { landscape } from '../test/images.ts'
import { deflicker, describeShift, gradualShift, smooth } from './series.ts'
import { computeStats } from './stats.ts'

describe('series mode', () => {
  it('smooths a series', () => {
    expect(smooth([0, 3, 0, 3, 0], 1)).toEqual([1.5, 1, 2, 1, 1.5])
  })

  it('deflickers alternating exposure while keeping the trend', () => {
    const gains = [1, 0.8, 1, 0.8, 1, 0.8, 1]
    const stats = gains.map((gain) => computeStats(landscape({ gain })))
    const offsets = deflicker(stats, 2)
    const corrected = stats.map((s, i) => s.logAvgLum + (offsets[i] as number))
    const jump = (xs: number[]) =>
      Math.max(...xs.slice(1).map((x, i) => Math.abs(x - (xs[i] as number))))
    expect(jump(corrected)).toBeLessThan(jump(stats.map((s) => s.logAvgLum)) / 2)
  })

  it('interpolates overrides from the first to the last photo', () => {
    const lut = createLayer('lut', { id: 'warm', params: { lutId: 'builtin:golden-hour' } })
    const shifts = gradualShift(
      { basicDeltas: { base: { temperature: -20 } } },
      { basicDeltas: { base: { temperature: 40, exposure: 0.5 } }, layers: [lut] },
      4,
    )
    expect(shifts.map((s) => s.basicDeltas?.base?.temperature)).toEqual([-20, undefined, 20, 40])
    expect(shifts[0]?.layers).toBeUndefined()
    expect(shifts[3]?.layers?.[0]?.opacity).toBe(1)
    expect(shifts[2]?.basicDeltas?.base?.exposure).toBeCloseTo(0.33, 2)
    expect(describeShift({}, { layers: [lut] })).toBe('LUT')
  })
})
