import type { RGB } from '../color/lut.ts'
import type { ImageDataLike } from '../color/pipeline.ts'

/** Builds an RGBA test image from a function of normalized coordinates. */
export function makeImage(
  width: number,
  height: number,
  fn: (u: number, v: number) => RGB,
): ImageDataLike {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = fn((x + 0.5) / width, (y + 0.5) / height)
      const i = (y * width + x) * 4
      data[i] = Math.round(c[0] * 255)
      data[i + 1] = Math.round(c[1] * 255)
      data[i + 2] = Math.round(c[2] * 255)
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

/** A synthetic landscape: blue sky on top, green field below, optional cast and gain. */
export function landscape(
  opts: { gain?: number; cast?: RGB; w?: number; h?: number } = {},
): ImageDataLike {
  const { gain = 1, cast = [1, 1, 1], w = 64, h = 48 } = opts
  return makeImage(w, h, (u, v) => {
    const base: RGB = v < 0.45 ? [0.45, 0.65, 0.95 - v * 0.3] : [0.25 + u * 0.1, 0.55, 0.2]
    return base.map((c, i) => Math.min(1, c * gain * (cast[i] as number))) as RGB
  })
}
