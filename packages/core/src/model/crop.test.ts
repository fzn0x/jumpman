import { describe, expect, it } from 'vitest'
import {
  cropRect,
  fitSize,
  frameToImage,
  frameToSource,
  rotatedSize,
  sourceToFrame,
} from './crop.ts'

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

describe('frame geometry', () => {
  it('maps frame corners to the source like the renderer geometry pass', () => {
    // A quarter turn clockwise puts the source's bottom-left in the top-left corner.
    expect(frameToSource(0, 0, { rotate: 1 })).toEqual({ x: 0, y: 1 })
    expect(frameToSource(1, 0, { rotate: 1 })).toEqual({ x: 0, y: 0 })
    expect(frameToSource(0, 0, { rotate: 2 })).toEqual({ x: 1, y: 1 })
    expect(frameToSource(0, 0, { rotate: 3 })).toEqual({ x: 1, y: 0 })
    expect(frameToSource(0.25, 0.5, { flipH: true })).toEqual({ x: 0.75, y: 0.5 })
    const rect = { x: 0.5, y: 0.25, w: 0.5, h: 0.5 }
    expect(frameToImage(0.5, 0.5, { rect })).toEqual({ x: 0.75, y: 0.5 })
    expect(frameToSource(0, 0, { rect })).toEqual({ x: 0.5, y: 0.25 })
  })

  it('inverts with sourceToFrame for every turn, flip and crop', () => {
    const rect = { x: 0.1, y: 0.2, w: 0.6, h: 0.5 }
    for (const rotate of [0, 1, 2, 3, -1, 5])
      for (const flipH of [false, true]) {
        const g = { rotate, flipH, rect }
        for (const [u, v] of [
          [0.1, 0.9],
          [0.5, 0.5],
          [0.8, 0.3],
        ] as const) {
          const s = frameToSource(u, v, g)
          const back = sourceToFrame(s.x, s.y, g)
          expect(back.x).toBeCloseTo(u, 9)
          expect(back.y).toBeCloseTo(v, 9)
        }
      }
  })
})
