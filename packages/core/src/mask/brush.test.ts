import { beforeEach, describe, expect, it } from 'vitest'
import type { BrushMask, BrushStroke } from '../model/layers.ts'
import {
  BRUSH_LIMITS,
  brushMaskKey,
  brushMaskRaster,
  brushPointCount,
  clearBrushCache,
  quantizeBrushValue,
  rasterizeBrushMask,
} from './brush.ts'

const stroke = (points: number[], o: Partial<BrushStroke> = {}): BrushStroke => ({
  mode: 'paint',
  size: 0.1,
  feather: 0,
  flow: 1,
  points,
  ...o,
})
const brush = (...strokes: BrushStroke[]): BrushMask => ({ type: 'brush', strokes })
const at = (data: Uint8Array, w: number, x: number, y: number) => data[y * w + x] as number

describe('brush rasterizer', () => {
  beforeEach(clearBrushCache)

  it('covers a round dab and nothing outside it', () => {
    // 100 x 50: radius = 0.1 * 50 = 5 px around (50, 25).
    const d = rasterizeBrushMask(brush(stroke([0.5, 0.5])), 100, 50)
    expect(d).toHaveLength(100 * 50)
    expect(at(d, 100, 50, 25)).toBe(255)
    expect(at(d, 100, 53, 25)).toBe(255)
    expect(at(d, 100, 57, 25)).toBe(0)
    expect(at(d, 100, 50, 32)).toBe(0)
    expect(at(d, 100, 0, 0)).toBe(0)
  })

  it('sweeps the brush along the path', () => {
    const d = rasterizeBrushMask(brush(stroke([0.2, 0.5, 0.8, 0.5])), 100, 50)
    for (let x = 20; x < 80; x += 5) expect(at(d, 100, x, 25)).toBe(255)
    expect(at(d, 100, 50, 15)).toBe(0)
    expect(at(d, 100, 10, 25)).toBe(0)
  })

  it('fades out across the feathered part of the radius', () => {
    // 200 x 200: radius 40 px, fully feathered.
    const d = rasterizeBrushMask(brush(stroke([0.5, 0.5], { size: 0.2, feather: 1 })), 200, 200)
    const row = [100, 110, 120, 130, 139].map((x) => at(d, 200, x, 100))
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThan(row[i - 1] as number)
    expect(row[0]).toBeGreaterThan(250)
    // Half way out: 1 - smoothstep(0, 1, 0.5) = 0.5.
    expect(Math.abs(at(d, 200, 120, 100) - 128)).toBeLessThan(10)
    expect(at(d, 200, 141, 100)).toBe(0)
  })

  it('builds up flow and erases', () => {
    const dot = (o: Partial<BrushStroke>) => stroke([0.5, 0.5], { size: 0.2, ...o })
    const once = rasterizeBrushMask(brush(dot({ flow: 0.5 })), 40, 40)
    const twice = rasterizeBrushMask(brush(dot({ flow: 0.5 }), dot({ flow: 0.5 })), 40, 40)
    expect(at(once, 40, 20, 20)).toBe(128)
    expect(at(twice, 40, 20, 20)).toBe(191)
    const erased = rasterizeBrushMask(brush(dot({}), dot({ mode: 'erase', size: 0.3 })), 40, 40)
    expect(Math.max(...erased)).toBe(0)
    const half = rasterizeBrushMask(brush(dot({}), dot({ mode: 'erase', flow: 0.5 })), 40, 40)
    expect(at(half, 40, 20, 20)).toBe(128)
  })

  it('keeps dabs round on any aspect ratio', () => {
    for (const [w, h] of [
      [300, 100],
      [100, 300],
    ] as const) {
      const d = rasterizeBrushMask(brush(stroke([0.5, 0.5], { size: 0.2 })), w, h)
      const cx = Math.floor(w / 2)
      const cy = Math.floor(h / 2)
      let across = 0
      let down = 0
      for (let x = 0; x < w; x++) if (at(d, w, x, cy) > 127) across++
      for (let y = 0; y < h; y++) if (at(d, w, cx, y) > 127) down++
      // Radius is 20% of the shorter side (100 px): about 40 px wide both ways.
      expect(Math.abs(across - 40)).toBeLessThanOrEqual(1)
      expect(Math.abs(down - 40)).toBeLessThanOrEqual(1)
    }
  })

  it('ignores empty strokes and stays in bounds near the edges', () => {
    expect(Math.max(...rasterizeBrushMask(brush(), 10, 10))).toBe(0)
    expect(Math.max(...rasterizeBrushMask(brush(stroke([])), 10, 10))).toBe(0)
    const d = rasterizeBrushMask(brush(stroke([-0.5, -0.5, 1.5, 1.5], { size: 0.3 })), 20, 10)
    expect(at(d, 20, 10, 5)).toBe(255)
  })
})

describe('brush raster cache', () => {
  beforeEach(clearBrushCache)

  it('returns the cached raster for unchanged or equal content', () => {
    const m = brush(stroke([0.3, 0.3, 0.6, 0.4]))
    const a = brushMaskRaster(m, 64, 48)
    expect(brushMaskRaster(m, 64, 48)).toBe(a)
    expect(brushMaskRaster(JSON.parse(JSON.stringify(m)) as BrushMask, 64, 48)).toBe(a)
    expect(brushMaskRaster(m, 32, 24).key).not.toBe(a.key)
    expect(brushMaskRaster(brush(stroke([0.3, 0.3, 0.6, 0.41])), 64, 48).key).not.toBe(a.key)
  })

  it('grows a stroke incrementally with the same bytes as a full rasterization', () => {
    const path = [0.1, 0.2, 0.15, 0.25, 0.3, 0.3, 0.45, 0.5, 0.5, 0.52, 0.7, 0.6, 0.72, 0.8]
    const first = stroke([0.8, 0.2, 0.2, 0.8], { size: 0.08, feather: 0.6, flow: 0.7 })
    const settings = { size: 0.05, feather: 0.4, flow: 0.6 }
    const masks: BrushMask[] = []
    for (let n = 2; n <= path.length; n += 2)
      masks.push(brush(first, stroke(path.slice(0, n), settings)))
    const done = masks[masks.length - 1] as BrushMask
    masks.push(brush(...done.strokes, stroke([0.4, 0.4, 0.5, 0.6], { mode: 'erase', size: 0.04 })))
    masks.push(brush(first))
    for (const m of masks) {
      expect(brushMaskRaster(m, 120, 90).data).toEqual(rasterizeBrushMask(m, 120, 90))
    }
  })

  it('keys by every stroke value', () => {
    const base = stroke([0.5, 0.5])
    const keys = new Set(
      [
        base,
        { ...base, mode: 'erase' as const },
        { ...base, size: 0.11 },
        { ...base, feather: 0.1 },
        { ...base, flow: 0.9 },
        { ...base, points: [0.5, 0.5001] },
      ].map((s) => brushMaskKey([s], 10, 10)),
    )
    expect(keys.size).toBe(6)
  })
})

describe('brush helpers', () => {
  it('quantizes to 4 decimals and counts points', () => {
    expect(quantizeBrushValue(0.123456)).toBe(0.1235)
    expect(brushPointCount(brush(stroke([0, 0, 1, 1]), stroke([0.5, 0.5])))).toBe(3)
    expect(BRUSH_LIMITS.maxSize).toBeGreaterThan(BRUSH_LIMITS.minSize)
  })
})
