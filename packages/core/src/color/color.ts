import { clamp } from '../util.ts'
import type { RGB } from './lut.ts'

/** Rec. 709 / sRGB luminance weights (linear light). */
export const LUMA: RGB = [0.2126, 0.7152, 0.0722]

export function luma(c: RGB): number {
  return c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2]
}

/** sRGB transfer → linear. Values above 1 continue the power segment. */
export function srgbToLinear(v: number): number {
  if (v <= 0.04045) return v / 12.92
  return ((v + 0.055) / 1.055) ** 2.4
}

/** Linear → sRGB transfer. Accepts values above 1 (for headroom before tone mapping). */
export function linearToSrgb(v: number): number {
  if (v <= 0.0031308) return v * 12.92
  return 1.055 * v ** (1 / 2.4) - 0.055
}

export function toLinear(c: RGB): RGB {
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])]
}

export function toSrgb(c: RGB): RGB {
  return [linearToSrgb(c[0]), linearToSrgb(c[1]), linearToSrgb(c[2])]
}

/** HSL with hue in degrees [0, 360), saturation and lightness in 0..1. */
export function rgbToHsl(c: RGB): RGB {
  const [r, g, b] = c
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d < 1e-7) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1) + 1e-7)
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return [h, clamp(s), l]
}

export function hslToRgb(hsl: RGB): RGB {
  const [h, s, l] = hsl
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return [r + m, g + m, b + m]
}

/** Linear sRGB → Oklab (L, a, b). */
export function linearToOklab(c: RGB): RGB {
  const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2])
  const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2])
  const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2])
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Oklab → linear sRGB. */
export function oklabToLinear(lab: RGB): RGB {
  const l = (lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2]) ** 3
  const m = (lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2]) ** 3
  const s = (lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2]) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const TEMP_K = 0.32
const TINT_K = 0.22

/**
 * Linear-light channel gains for the temperature/tint sliders (-100..100).
 * Gains are normalized to keep luminance constant, which makes the mapping
 * analytically invertible (see {@link solveWhiteBalance}).
 */
export function wbGains(temperature: number, tint: number): RGB {
  const t = temperature / 100
  const g = tint / 100
  const r = Math.exp(TEMP_K * t)
  const b = Math.exp(-TEMP_K * t)
  const gg = Math.exp(-TINT_K * g)
  const n = r * LUMA[0] + gg * LUMA[1] + b * LUMA[2]
  return [r / n, gg / n, b / n]
}

/**
 * Finds temperature/tint slider values whose gains move a linear mean color
 * `from` to have the same chromaticity as `to`.
 */
export function solveWhiteBalance(from: RGB, to: RGB): { temperature: number; tint: number } {
  const eps = 1e-6
  const R = (to[0] + eps) / (from[0] + eps)
  const G = (to[1] + eps) / (from[1] + eps)
  const B = (to[2] + eps) / (from[2] + eps)
  const t = Math.log(R / B) / (2 * TEMP_K)
  const g = -Math.log(G / Math.sqrt(R * B)) / TINT_K
  return { temperature: clamp(t * 100, -100, 100), tint: clamp(g * 100, -100, 100) }
}

/** Fully saturated mid-lightness color for a hue in degrees. */
export function hueColor(hue: number): RGB {
  return hslToRgb([hue, 1, 0.5])
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const n = Number.parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function rgbToHex(c: RGB): string {
  const to = (v: number) =>
    Math.round(clamp(v) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`
}
