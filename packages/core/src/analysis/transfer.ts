/**
 * "Edit from a sample image": generates a LUT that approximates the look of
 * any reference photo (a film still, a magazine shot) using a Reinhard-style
 * statistics transfer in Oklab.
 */
import { linearToOklab, linearToSrgb, oklabToLinear, srgbToLinear } from '../color/color.ts'
import { createLut, type Lut3D, type RGB } from '../color/lut.ts'
import { clamp, mean } from '../util.ts'
import type { PhotoStats } from './stats.ts'

export interface LabStats {
  mean: RGB
  std: RGB
}

export function labStatsOf(stats: PhotoStats): LabStats {
  return { mean: stats.oklabMean, std: stats.oklabStd }
}

/** Average Oklab statistics of a batch (the "source" side of the transfer). */
export function batchLabStats(list: PhotoStats[]): LabStats {
  const pick = (f: (s: PhotoStats) => RGB) =>
    [0, 1, 2].map((c) => mean(list.map((s) => f(s)[c] as number))) as RGB
  return { mean: pick((s) => s.oklabMean), std: pick((s) => s.oklabStd) }
}

export interface TransferOptions {
  /** 0..1 overall strength. */
  strength?: number
  /** Limit on how much the contrast (std ratio) can change. */
  maxScale?: number
  size?: number
  title?: string
}

export function colorTransferLut(
  source: LabStats,
  target: LabStats,
  opts: TransferOptions = {},
): Lut3D {
  const { strength = 1, maxScale = 2.2, size = 33, title = 'Sample match' } = opts
  const scale = [0, 1, 2].map((c) => {
    const s = (target.std[c] as number) / Math.max(1e-4, source.std[c] as number)
    return clamp(s, 1 / maxScale, maxScale)
  })
  return createLut(
    size,
    (rgb) => {
      const lab = linearToOklab([srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])])
      const out = lab.map((v, c) => {
        const t = ((v - (source.mean[c] as number)) * (scale[c] as number) +
          (target.mean[c] as number)) as number
        return v + (t - v) * strength
      }) as RGB
      const lin = oklabToLinear(out)
      return [linearToSrgb(clamp(lin[0])), linearToSrgb(clamp(lin[1])), linearToSrgb(clamp(lin[2]))]
    },
    title,
  )
}
