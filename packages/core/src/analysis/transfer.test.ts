import { describe, expect, it } from 'vitest'
import { renderImage } from '../color/pipeline.ts'
import { createLayer } from '../model/layers.ts'
import { landscape, makeImage } from '../test/images.ts'
import { computeStats } from './stats.ts'
import { batchLabStats, colorTransferLut, labStatsOf } from './transfer.ts'

describe('edit from a sample image', () => {
  it('moves the batch color statistics toward the sample', () => {
    const photo = landscape()
    const sample = makeImage(32, 32, (u, v) => [0.75 + u * 0.1, 0.45 + v * 0.1, 0.3])
    const src = batchLabStats([computeStats(photo)])
    const target = labStatsOf(computeStats(sample))
    const lut = colorTransferLut(src, target, { size: 17 })
    const out = computeStats(
      renderImage(photo, [createLayer('lut', { params: { lutId: 'x' } })], (id) =>
        id === 'x' ? lut : undefined,
      ),
    )
    const before = Math.abs(src.mean[1] - target.mean[1]) + Math.abs(src.mean[2] - target.mean[2])
    const after =
      Math.abs(out.oklabMean[1] - target.mean[1]) + Math.abs(out.oklabMean[2] - target.mean[2])
    expect(after).toBeLessThan(before / 2)
  })

  it('is the identity at zero strength', () => {
    const s = labStatsOf(computeStats(landscape()))
    const lut = colorTransferLut(
      s,
      { mean: [0.5, 0.1, 0.1], std: [0.1, 0.1, 0.1] },
      { strength: 0, size: 5 },
    )
    expect(lut.data[3]).toBeCloseTo(0.25, 3)
  })
})
