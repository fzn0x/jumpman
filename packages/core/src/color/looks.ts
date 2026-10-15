/**
 * Built-in LUT library. Every look is a small recipe of layers that is baked
 * into a 3D LUT on demand, so the repository ships no binary LUT files.
 */
import { type Basic, defaultBasic } from '../model/basic.ts'
import {
  type CurvePoint,
  createLayer,
  defaultCurves,
  defaultHsl,
  defaultSplit,
  type HslParams,
  type Layer,
  type SplitParams,
} from '../model/layers.ts'
import type { Lut3D } from './lut.ts'
import { bakeLut } from './pipeline.ts'

export interface LookRecipe {
  id: string
  name: string
  description: string
  /** Accent color for UI swatches. */
  swatch: string
  layers: () => Layer[]
}

const basic = (p: Partial<Basic>) => createLayer('basic', { params: { ...defaultBasic(), ...p } })
const split = (p: Partial<SplitParams>) =>
  createLayer('split', { params: { ...defaultSplit(), ...p } })
const hsl = (p: Partial<HslParams>) => createLayer('hsl', { params: { ...defaultHsl(), ...p } })
const curve = (
  master: CurvePoint[],
  red?: CurvePoint[],
  green?: CurvePoint[],
  blue?: CurvePoint[],
) => {
  const c = defaultCurves()
  c.master = master
  if (red) c.red = red
  if (green) c.green = green
  if (blue) c.blue = blue
  return createLayer('curves', { params: c })
}
const pts = (...xy: number[]): CurvePoint[] => {
  const out: CurvePoint[] = []
  for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i] as number, y: xy[i + 1] as number })
  return out
}
const band = (hue: number, saturation: number, luminance: number) => ({
  hue,
  saturation,
  luminance,
})

export const LOOKS: readonly LookRecipe[] = [
  {
    id: 'spring-pink',
    name: 'Spring Pink',
    description: 'Soft coral highlights, lifted blacks and gentle warmth.',
    swatch: '#FFA0A0',
    layers: () => [
      basic({ temperature: 8, tint: 14, contrast: -12, fade: 22, saturation: -6, highlights: -10 }),
      split({
        highlightHue: 350,
        highlightSaturation: 45,
        shadowHue: 330,
        shadowSaturation: 20,
        balance: 20,
      }),
      hsl({ red: band(-10, 10, 8), orange: band(-12, -8, 10), green: band(25, -35, 0) }),
    ],
  },
  {
    id: 'teal-orange',
    name: 'Teal & Orange',
    description: 'Blockbuster complementary grade: teal shadows, warm skin.',
    swatch: '#2EC4B6',
    layers: () => [
      basic({ contrast: 18, vibrance: 15, highlights: -12 }),
      split({
        shadowHue: 190,
        shadowSaturation: 60,
        highlightHue: 32,
        highlightSaturation: 45,
        balance: -10,
      }),
      hsl({ blue: band(-20, 10, -10), aqua: band(10, 15, -5), orange: band(-4, 12, 6) }),
    ],
  },
  {
    id: 'warm-film',
    name: 'Warm Film',
    description: 'Creamy negative-film warmth with soft roll-off.',
    swatch: '#E9B872',
    layers: () => [
      basic({
        temperature: 18,
        contrast: -8,
        fade: 14,
        saturation: -8,
        highlights: -18,
        shadows: 10,
      }),
      curve(pts(0, 0.05, 0.25, 0.24, 0.75, 0.8, 1, 0.96)),
      hsl({ green: band(-20, -20, 0), orange: band(-3, 6, 4), blue: band(-10, -15, 0) }),
    ],
  },
  {
    id: 'green-film',
    name: 'Green Film',
    description: 'Cool, green-leaning shadows inspired by classic slide stock.',
    swatch: '#7BAE7F',
    layers: () => [
      basic({ temperature: -6, tint: -8, contrast: 10, saturation: -4 }),
      curve(
        pts(0, 0.03, 0.5, 0.5, 1, 0.97),
        undefined,
        pts(0, 0.04, 0.5, 0.52, 1, 1),
        pts(0, 0.06, 1, 0.94),
      ),
      split({ shadowHue: 150, shadowSaturation: 30 }),
    ],
  },
  {
    id: 'vivid-slide',
    name: 'Vivid Slide',
    description: 'Punchy, saturated colors with deep blues and greens.',
    swatch: '#3A86FF',
    layers: () => [
      basic({ contrast: 25, vibrance: 30, saturation: 10, blacks: -10 }),
      hsl({ blue: band(-5, 20, -12), green: band(5, 15, -5) }),
    ],
  },
  {
    id: 'matte',
    name: 'Matte',
    description: 'Flat, airy matte finish with faded blacks.',
    swatch: '#C9C2B8',
    layers: () => [basic({ contrast: -15, fade: 40, saturation: -12, shadows: 15 })],
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    description: 'Late-afternoon glow: warm highlights, amber midtones.',
    swatch: '#F4A259',
    layers: () => [
      basic({ temperature: 30, tint: 6, highlights: -15, vibrance: 12, exposure: 0.1 }),
      split({ highlightHue: 40, highlightSaturation: 40, shadowHue: 20, shadowSaturation: 15 }),
    ],
  },
  {
    id: 'nordic',
    name: 'Nordic',
    description: 'Cool, clean and desaturated with crisp whites.',
    swatch: '#9DB4C0',
    layers: () => [
      basic({ temperature: -20, saturation: -25, contrast: 6, whites: 12, fade: 8 }),
      hsl({ blue: band(0, -10, 10), orange: band(0, -15, 5) }),
    ],
  },
  {
    id: 'pastel',
    name: 'Pastel',
    description: 'Light, low-contrast candy tones.',
    swatch: '#CDB4DB',
    layers: () => [
      basic({ exposure: 0.25, contrast: -25, saturation: -15, fade: 25, highlights: -20 }),
      split({ highlightHue: 300, highlightSaturation: 20, shadowHue: 200, shadowSaturation: 20 }),
    ],
  },
  {
    id: 'cross-process',
    name: 'Cross Process',
    description: 'Yellow-green highlights and cyan shadows of cross-processed film.',
    swatch: '#C5D86D',
    layers: () => [
      basic({ contrast: 20, saturation: 10 }),
      curve(
        pts(0, 0, 1, 1),
        pts(0, 0, 0.25, 0.2, 0.75, 0.85, 1, 1),
        pts(0, 0, 0.5, 0.56, 1, 1),
        pts(0, 0.12, 1, 0.82),
      ),
    ],
  },
  {
    id: 'bleach-bypass',
    name: 'Bleach Bypass',
    description: 'Gritty, desaturated, high-contrast silver retention look.',
    swatch: '#8D99AE',
    layers: () => [basic({ saturation: -55, contrast: 35, highlights: -10, blacks: -10 })],
  },
  {
    id: 'cyber',
    name: 'Neon Night',
    description: 'Magenta and cyan city-night grade.',
    swatch: '#F72585',
    layers: () => [
      basic({ tint: 18, contrast: 15, vibrance: 20 }),
      split({ shadowHue: 200, shadowSaturation: 55, highlightHue: 315, highlightSaturation: 50 }),
    ],
  },
  {
    id: 'mono',
    name: 'Mono',
    description: 'Neutral black and white with gentle contrast.',
    swatch: '#9E9E9E',
    layers: () => [basic({ saturation: -100, contrast: 12 })],
  },
  {
    id: 'noir',
    name: 'Noir',
    description: 'Hard, inky black and white.',
    swatch: '#2B2B2B',
    layers: () => [basic({ saturation: -100, contrast: 45, blacks: -25, highlights: -10 })],
  },
  {
    id: 'sepia',
    name: 'Sepia',
    description: 'Antique brown toning.',
    swatch: '#A47551',
    layers: () => [
      basic({ saturation: -100, fade: 15 }),
      split({ shadowHue: 30, shadowSaturation: 45, highlightHue: 40, highlightSaturation: 35 }),
    ],
  },
]

export const BUILTIN_LUT_PREFIX = 'builtin:'

export function builtinLutId(lookId: string): string {
  return `${BUILTIN_LUT_PREFIX}${lookId}`
}

const cache = new Map<string, Lut3D>()

/** Returns the baked LUT for a built-in look id (with or without prefix). */
export function builtinLut(id: string, size = 33): Lut3D | undefined {
  const lookId = id.startsWith(BUILTIN_LUT_PREFIX) ? id.slice(BUILTIN_LUT_PREFIX.length) : id
  const key = `${lookId}@${size}`
  const hit = cache.get(key)
  if (hit) return hit
  const look = LOOKS.find((l) => l.id === lookId)
  if (!look) return undefined
  const lut = bakeLut(look.layers(), () => undefined, size, look.name)
  cache.set(key, lut)
  return lut
}
