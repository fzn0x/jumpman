import { describe, expect, it } from 'vitest'
import { cropRect, fitSize, rotatedSize } from './crop.ts'

describe('crop', () => {
  it('fits the largest window of a ratio inside the image', () => {
    expect(cropRect(4000, 3000, 1)).toEqual({ x: 500, y: 0, w: 3000, h: 3000 })
    const r = cropRect(3000, 4000, 9 / 16)
    expect(r.h).toBe(4000)
    expect(r.w).toBeCloseTo(2250)
  })

  it('keeps the window inside the image when repositioned', () => {
    const r = cropRect(4000, 3000, 1, { cx: 0 })
    expect(r.x).toBe(0)
    const r2 = cropRect(4000, 3000, 1, { cx: 1 })
    expect(r2.x).toBe(1000)
  })

  it('zooms and rotates', () => {
    const r = cropRect(4000, 3000, null, { zoom: 2 })
    expect(r).toEqual({ x: 1000, y: 750, w: 2000, h: 1500 })
    expect(rotatedSize(4000, 3000, 1)).toEqual({ w: 3000, h: 4000 })
    expect(cropRect(4000, 3000, null, { rotate: 1 })).toEqual({ x: 0, y: 0, w: 3000, h: 4000 })
  })

  it('scales output to a max edge', () => {
    expect(fitSize(4000, 3000, 2000)).toEqual({ w: 2000, h: 1500 })
    expect(fitSize(800, 600, 2000)).toEqual({ w: 800, h: 600 })
  })
})
