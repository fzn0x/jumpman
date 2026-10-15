import { describe, expect, it } from 'vitest'
import { landscape, makeImage } from '../test/images.ts'
import {
  batchPalette,
  groupByMoment,
  hammingHex,
  selectByColor,
  selectByScene,
  selectSameMoment,
  selectSimilar,
  selectTimeRange,
  similarity,
} from './similarity.ts'
import { computeStats } from './stats.ts'

const portrait = () =>
  makeImage(48, 64, (u, v) =>
    Math.hypot(u - 0.5, v - 0.45) < 0.3 ? [0.85, 0.62, 0.5] : [0.2, 0.2, 0.25],
  )

describe('smart selection', () => {
  const at = (i: number) => {
    const p = photos[i]
    if (!p) throw new Error('missing photo')
    return p
  }
  const photos = [
    { id: 'a', stats: computeStats(landscape()), takenAt: 1_000 },
    { id: 'b', stats: computeStats(landscape({ gain: 0.95 })), takenAt: 61_000 },
    { id: 'c', stats: computeStats(portrait()), takenAt: 3_600_000 },
    { id: 'd', stats: computeStats(makeImage(40, 40, () => [0.95, 0.4, 0.6])), takenAt: 3_700_000 },
  ]

  it('computes hamming distance of hex hashes', () => {
    expect(hammingHex('ffff', '0000')).toBe(16)
    expect(hammingHex('00f0', '00f1')).toBe(1)
  })

  it('selects visually similar photos', () => {
    expect(similarity(at(0).stats, at(1).stats)).toBeGreaterThan(0.9)
    expect(selectSimilar(at(0), photos)).toEqual(['a', 'b'])
  })

  it('selects by time range and moment', () => {
    expect(selectTimeRange(photos, 0, 100_000)).toEqual(['a', 'b'])
    expect(groupByMoment(photos)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
    expect(selectSameMoment(at(2), photos)).toEqual(['c', 'd'])
  })

  it('selects by scene type', () => {
    expect(selectByScene('landscape', photos)).toEqual(['a', 'b'])
    expect(selectByScene('portrait', photos)).toContain('c')
  })

  it('selects by palette color', () => {
    expect(selectByColor('#f06699', photos)).toEqual(['d'])
    const palette = batchPalette(photos)
    expect(palette.length).toBeGreaterThan(2)
    expect(new Set(palette).size).toBe(palette.length)
  })
})
