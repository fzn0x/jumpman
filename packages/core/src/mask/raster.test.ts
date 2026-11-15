import { describe, expect, it } from 'vitest'
import type { Mask } from '../model/layers.ts'
import {
  confidenceToCoverage,
  EMPTY_MASK_RASTER,
  type MaskRaster,
  maskRasterSize,
  resolveMaskRaster,
  sampleMaskRaster,
} from './raster.ts'

describe('raster masks', () => {
  it('sizes rasters to the photo aspect with a capped long edge', () => {
    expect(maskRasterSize(6000, 4000)).toEqual({ width: 1024, height: 683 })
    expect(maskRasterSize(3000, 4000)).toEqual({ width: 768, height: 1024 })
    expect(maskRasterSize(500, 300)).toEqual({ width: 500, height: 300 })
    expect(maskRasterSize(4000, 2000, 512)).toEqual({ width: 512, height: 256 })
  })

  it('samples bilinearly with texel centers and clamped edges', () => {
    const r: MaskRaster = { width: 2, height: 1, data: new Uint8Array([0, 255]), key: 't' }
    expect(sampleMaskRaster(r, 0.25, 0.5)).toBe(0)
    expect(sampleMaskRaster(r, 0.75, 0.5)).toBe(1)
    expect(sampleMaskRaster(r, 0.5, 0.5)).toBeCloseTo(0.5)
    expect(sampleMaskRaster(r, -1, 2)).toBe(0)
    expect(sampleMaskRaster(r, 2, -1)).toBe(1)
  })

  it('resolves brush rasters, analytic masks and custom producers', () => {
    const source = { width: 400, height: 200 }
    const brush: Mask = { type: 'brush', strokes: [] }
    const b = resolveMaskRaster(brush, source)
    expect(b?.width).toBe(400)
    expect(b?.height).toBe(200)
    expect(b?.key).toMatch(/^brush:400x200:/)
    expect(resolveMaskRaster({ type: 'sky' }, source)).toBeNull()
    // A segmentation model can hand in a per-photo raster for any mask type.
    const seg: MaskRaster = { width: 4, height: 2, data: new Uint8Array(8).fill(9), key: 'seg' }
    const custom = (m: Mask) => (m.type === 'sky' ? seg : null)
    expect(resolveMaskRaster({ type: 'sky' }, source, custom)).toBe(seg)
    expect(resolveMaskRaster(brush, source, custom)?.key).toBe(b?.key)
    expect(resolveMaskRaster(brush, source, () => EMPTY_MASK_RASTER)).toBe(EMPTY_MASK_RASTER)
  })

  it('quantizes model confidences to coverage', () => {
    expect([...confidenceToCoverage([0, 0.5, 1, -0.2, 1.7, Number.NaN, 0.002])]).toEqual([
      0, 128, 255, 0, 255, 0, 1,
    ])
    expect(confidenceToCoverage(new Float32Array(0))).toHaveLength(0)
  })
})
