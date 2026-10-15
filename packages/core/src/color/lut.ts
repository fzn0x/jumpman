import { clamp } from '../util.ts'

export type RGB = [number, number, number]

/**
 * A 3D color lookup table. `data` holds `size^3` RGB triplets (values 0..1)
 * laid out with red changing fastest, then green, then blue — the same order
 * as the Adobe .cube format and WebGL `texImage3D` (x = r, y = g, z = b).
 */
export interface Lut3D {
  size: number
  data: Float32Array
  title?: string
}

export function lutIndex(size: number, r: number, g: number, b: number): number {
  return ((b * size + g) * size + r) * 3
}

/** Builds a LUT by evaluating `fn` at every lattice point. */
export function createLut(size: number, fn: (rgb: RGB) => RGB, title?: string): Lut3D {
  const data = new Float32Array(size * size * size * 3)
  const step = 1 / (size - 1)
  let i = 0
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = fn([r * step, g * step, b * step])
        data[i++] = clamp(out[0])
        data[i++] = clamp(out[1])
        data[i++] = clamp(out[2])
      }
    }
  }
  return title ? { size, data, title } : { size, data }
}

export function identityLut(size = 17): Lut3D {
  return createLut(size, (c) => c, 'Identity')
}

/** Trilinear lookup of a color in a LUT. */
export function sampleLut(lut: Lut3D, rgb: RGB): RGB {
  const { size, data } = lut
  const max = size - 1
  const fr = clamp(rgb[0]) * max
  const fg = clamp(rgb[1]) * max
  const fb = clamp(rgb[2]) * max
  const r0 = Math.min(Math.floor(fr), max - 1)
  const g0 = Math.min(Math.floor(fg), max - 1)
  const b0 = Math.min(Math.floor(fb), max - 1)
  const dr = fr - r0
  const dg = fg - g0
  const db = fb - b0
  const out: RGB = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const at = (r: number, g: number, b: number) => data[lutIndex(size, r, g, b) + c] ?? 0
    const c00 = at(r0, g0, b0) * (1 - dr) + at(r0 + 1, g0, b0) * dr
    const c10 = at(r0, g0 + 1, b0) * (1 - dr) + at(r0 + 1, g0 + 1, b0) * dr
    const c01 = at(r0, g0, b0 + 1) * (1 - dr) + at(r0 + 1, g0, b0 + 1) * dr
    const c11 = at(r0, g0 + 1, b0 + 1) * (1 - dr) + at(r0 + 1, g0 + 1, b0 + 1) * dr
    const c0 = c00 * (1 - dg) + c10 * dg
    const c1 = c01 * (1 - dg) + c11 * dg
    out[c] = c0 * (1 - db) + c1 * db
  }
  return out
}
