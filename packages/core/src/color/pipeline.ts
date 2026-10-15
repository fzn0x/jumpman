/**
 * Reference (CPU) implementation of every layer operation. The WebGL
 * renderer mirrors these formulas in GLSL; keep the two in sync.
 *
 * Layers operate on display-referred sRGB values in 0..1.
 */
import type { Basic } from '../model/basic.ts'
import {
  type HslParams,
  HUE_BAND_CENTERS,
  HUE_BANDS,
  type Layer,
  type Mask,
  type SplitParams,
} from '../model/layers.ts'
import { clamp, smoothstep } from '../util.ts'
import {
  hslToRgb,
  hueColor,
  LUMA,
  linearToSrgb,
  luma,
  rgbToHsl,
  srgbToLinear,
  wbGains,
} from './color.ts'
import { curvesTable, lookupCurve } from './curves.ts'
import { createLut, type Lut3D, type RGB, sampleLut } from './lut.ts'

/** Per-pixel context for spatial operations. */
export interface PixelContext {
  /** Normalized position, x to the right, y downward. */
  u: number
  v: number
  /** Image width / height. */
  aspect: number
  /** Salient center used by subject masks (normalized). */
  subject?: { x: number; y: number }
  seed?: number
}

export const CONTRAST_PIVOT = 0.46

export function toneCurve(L0: number, p: Basic): number {
  const h = p.highlights / 100
  const s = p.shadows / 100
  const w = p.whites / 100
  const b = p.blacks / 100
  const c = p.contrast / 100
  const br = p.brightness / 100
  let L = L0
  L += w * 0.3 * L * L
  let t = clamp(L)
  L += h * 0.25 * 6.75 * t * t * (1 - t)
  if (h < 0) L += h * 0.6 * Math.max(L - 0.85, 0)
  t = clamp(L)
  L += s * 0.25 * 6.75 * t * (1 - t) * (1 - t)
  t = clamp(L)
  L += b * 0.12 * (1 - t) ** 3
  L = clamp(L)
  if (c !== 0) {
    const k = Math.exp(c * 0.9)
    const pv = CONTRAST_PIVOT
    L = L < pv ? pv * (L / pv) ** k : 1 - (1 - pv) * ((1 - L) / (1 - pv)) ** k
  }
  if (br !== 0) L = L ** Math.exp(-br * 0.6)
  return L
}

/** 32-bit integer hash shared with the shader (lowbias32). */
export function hash32(x: number): number {
  let h = x >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b) >>> 0
  h ^= h >>> 16
  return h >>> 0
}

function cellNoise(ix: number, iy: number, seed: number): number {
  return hash32((Math.imul(ix, 1973) + hash32(Math.imul(iy, 9277) + seed)) >>> 0) / 4294967295
}

/** Smooth value noise in 0..1 used for film grain. */
export function grainNoise(u: number, v: number, aspect: number, seed = 7): number {
  const sx = aspect >= 1 ? 1 : aspect
  const sy = aspect >= 1 ? 1 / aspect : 1
  const x = u * sx * GRAIN_CELLS
  const y = v * sy * GRAIN_CELLS
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = cellNoise(ix, iy, seed)
  const b = cellNoise(ix + 1, iy, seed)
  const c = cellNoise(ix, iy + 1, seed)
  const d = cellNoise(ix + 1, iy + 1, seed)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

/** Grain cells across the long edge of the image. */
export const GRAIN_CELLS = 1400

export function applyBasic(input: RGB, p: Basic, ctx: PixelContext): RGB {
  let lin: RGB = [srgbToLinear(input[0]), srgbToLinear(input[1]), srgbToLinear(input[2])]
  if (p.temperature || p.tint) {
    const g = wbGains(p.temperature, p.tint)
    lin = [lin[0] * g[0], lin[1] * g[1], lin[2] * g[2]]
  }
  if (p.exposure) {
    const e = 2 ** p.exposure
    lin = [lin[0] * e, lin[1] * e, lin[2] * e]
  }
  const Y = luma(lin)
  const L = linearToSrgb(Math.max(Y, 0))
  const L2 = toneCurve(L, p)
  const Y2 = srgbToLinear(L2)
  if (Y > 1e-6) {
    const r = Y2 / Y
    lin = [lin[0] * r, lin[1] * r, lin[2] * r]
  } else {
    lin = [Y2, Y2, Y2]
  }
  let d: RGB = [
    clamp(linearToSrgb(Math.max(lin[0], 0))),
    clamp(linearToSrgb(Math.max(lin[1], 0))),
    clamp(linearToSrgb(Math.max(lin[2], 0))),
  ]

  if (p.saturation || p.vibrance) {
    const l = d[0] * LUMA[0] + d[1] * LUMA[1] + d[2] * LUMA[2]
    const s = Math.max(d[0], d[1], d[2]) - Math.min(d[0], d[1], d[2])
    const f = Math.max(0, 1 + p.saturation / 100 + (p.vibrance / 100) * (1 - s))
    d = [l + (d[0] - l) * f, l + (d[1] - l) * f, l + (d[2] - l) * f]
  }
  if (p.fade) {
    const f = p.fade / 100
    d = [
      d[0] * (1 - 0.18 * f) + 0.1 * f,
      d[1] * (1 - 0.18 * f) + 0.1 * f,
      d[2] * (1 - 0.18 * f) + 0.09 * f,
    ]
  }
  if (p.vignette) {
    const v = p.vignette / 100
    const dx = (ctx.u - 0.5) * ctx.aspect
    const dy = ctx.v - 0.5
    const dist = Math.sqrt(dx * dx + dy * dy) / Math.sqrt(0.25 * ctx.aspect * ctx.aspect + 0.25)
    const w = smoothstep(0.35, 1, dist)
    if (v < 0) {
      const k = 1 + v * 0.8 * w
      d = [d[0] * k, d[1] * k, d[2] * k]
    } else {
      const k = v * 0.6 * w
      d = [d[0] + (1 - d[0]) * k, d[1] + (1 - d[1]) * k, d[2] + (1 - d[2]) * k]
    }
  }
  if (p.grain) {
    const l = d[0] * LUMA[0] + d[1] * LUMA[1] + d[2] * LUMA[2]
    const n = (grainNoise(ctx.u, ctx.v, ctx.aspect, ctx.seed ?? 7) - 0.5) * (p.grain / 100) * 0.16
    const k = n * (1 - Math.abs(l - 0.5))
    d = [d[0] + k, d[1] + k, d[2] + k]
  }
  return [clamp(d[0]), clamp(d[1]), clamp(d[2])]
}

const BAND_ORDER = HUE_BANDS.map((b) => ({ band: b, center: HUE_BAND_CENTERS[b] }))

/** Partition-of-unity weights of each hue band for a hue in degrees. */
export function hueBandWeights(hue: number): number[] {
  const w = new Array<number>(HUE_BANDS.length).fill(0)
  const h = ((hue % 360) + 360) % 360
  for (let i = 0; i < BAND_ORDER.length; i++) {
    const a = BAND_ORDER[i]?.center as number
    const next = i + 1 < BAND_ORDER.length ? (BAND_ORDER[i + 1]?.center as number) : 360
    if (h >= a && h < next) {
      const t = smoothstep(0, 1, (h - a) / (next - a))
      w[i] = 1 - t
      w[(i + 1) % BAND_ORDER.length] = t
      break
    }
  }
  return w
}

export function applyHsl(input: RGB, params: HslParams): RGB {
  const [h, s, l] = rgbToHsl(input)
  const gate = smoothstep(0, 0.25, s)
  if (gate <= 0) return input
  const weights = hueBandWeights(h)
  let dh = 0
  let ds = 0
  let dl = 0
  HUE_BANDS.forEach((band, i) => {
    const wi = weights[i] as number
    if (!wi) return
    dh += wi * params[band].hue
    ds += wi * params[band].saturation
    dl += wi * params[band].luminance
  })
  if (!dh && !ds && !dl) return input
  const out = hslToRgb([h + (dh / 100) * 30 * gate, clamp(s * (1 + (ds / 100) * gate)), l])
  const k = 1 + (dl / 100) * 0.6 * gate
  return [clamp(out[0] * k), clamp(out[1] * k), clamp(out[2] * k)]
}

export function applySplit(input: RGB, p: SplitParams): RGB {
  const l = input[0] * LUMA[0] + input[1] * LUMA[1] + input[2] * LUMA[2]
  const pivot = 0.5 - 0.3 * (p.balance / 100)
  const ws = 1 - smoothstep(pivot - 0.35, pivot + 0.15, l)
  const wh = smoothstep(pivot - 0.15, pivot + 0.35, l)
  const sc = hueColor(p.shadowHue)
  const hc = hueColor(p.highlightHue)
  const sl = luma(sc)
  const hl = luma(hc)
  const ks = (p.shadowSaturation / 100) * ws * 0.35
  const kh = (p.highlightSaturation / 100) * wh * 0.35
  return [
    clamp(input[0] + (sc[0] - sl) * ks + (hc[0] - hl) * kh),
    clamp(input[1] + (sc[1] - sl) * ks + (hc[1] - hl) * kh),
    clamp(input[2] + (sc[2] - sl) * ks + (hc[2] - hl) * kh),
  ]
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

/** Mask coverage (0..1) of a pixel. */
export function maskValue(mask: Mask, rgb: RGB, ctx: PixelContext): number {
  let m: number
  switch (mask.type) {
    case 'linear': {
      const dx = (mask.x1 - mask.x0) * ctx.aspect
      const dy = mask.y1 - mask.y0
      const len2 = dx * dx + dy * dy || 1e-6
      const t = ((ctx.u - mask.x0) * ctx.aspect * dx + (ctx.v - mask.y0) * dy) / len2
      m = 1 - smoothstep(0, 1, t)
      break
    }
    case 'radial': {
      const qx = (ctx.u - mask.cx) / Math.max(mask.rx, 1e-4)
      const qy = (ctx.v - mask.cy) / Math.max(mask.ry, 1e-4)
      const d = Math.sqrt(qx * qx + qy * qy)
      m = 1 - smoothstep(1 - Math.max(mask.feather, 0.001), 1, d)
      break
    }
    case 'luminance': {
      const l = luma(rgb)
      const f = Math.max(mask.feather, 0.001)
      m = smoothstep(mask.min - f, mask.min, l) * (1 - smoothstep(mask.max, mask.max + f, l))
      break
    }
    case 'color': {
      const [h, s] = rgbToHsl(rgb)
      const fd = 10 + mask.feather * 60
      m =
        (1 - smoothstep(mask.range, mask.range + fd, hueDistance(h, mask.hue))) *
        smoothstep(0.08, 0.2, s)
      break
    }
    case 'sky': {
      const [h, s, l] = rgbToHsl(rgb)
      const vertical = 1 - smoothstep(0.3, 0.7, ctx.v)
      const blue = (1 - smoothstep(30, 60, hueDistance(h, 215))) * smoothstep(0.1, 0.25, s)
      const overcast = smoothstep(0.65, 0.85, l) * (1 - smoothstep(0.15, 0.35, s))
      m = vertical * Math.max(blue, overcast)
      break
    }
    case 'subject': {
      const c = ctx.subject ?? { x: 0.5, y: 0.5 }
      const r = Math.max(mask.size, 0.05) * 0.5
      const qx = ((ctx.u - c.x) * ctx.aspect) / r
      const qy = (ctx.v - c.y) / r
      m = 1 - smoothstep(0.5, 1, Math.sqrt(qx * qx + qy * qy))
      break
    }
  }
  return mask.invert ? 1 - m : m
}

export type LutResolver = (id: string) => Lut3D | undefined

/** A layer prepared for repeated per-pixel evaluation. */
export interface CompiledLayer {
  layer: Layer
  apply: (rgb: RGB, ctx: PixelContext) => RGB
}

export function compileLayer(layer: Layer, luts: LutResolver): CompiledLayer | null {
  switch (layer.kind) {
    case 'basic':
      return { layer, apply: (c, ctx) => applyBasic(c, layer.params, ctx) }
    case 'hsl':
      return { layer, apply: (c) => applyHsl(c, layer.params) }
    case 'split':
      return { layer, apply: (c) => applySplit(c, layer.params) }
    case 'curves': {
      const table = curvesTable(layer.params)
      return {
        layer,
        apply: (c) => [
          lookupCurve(table, 0, c[0]),
          lookupCurve(table, 1, c[1]),
          lookupCurve(table, 2, c[2]),
        ],
      }
    }
    case 'lut': {
      const lut = luts(layer.params.lutId)
      if (!lut) return null
      return { layer, apply: (c) => sampleLut(lut, c) }
    }
  }
}

export function compileLayers(layers: Layer[], luts: LutResolver): CompiledLayer[] {
  return layers
    .filter((l) => l.enabled && l.opacity > 0)
    .map((l) => compileLayer(l, luts))
    .filter((l): l is CompiledLayer => l !== null)
}

export function applyCompiled(input: RGB, compiled: CompiledLayer[], ctx: PixelContext): RGB {
  let c = input
  for (const { layer, apply } of compiled) {
    const out = apply(c, ctx)
    const k = layer.opacity * (layer.mask ? maskValue(layer.mask, c, ctx) : 1)
    if (k >= 1) c = out
    else if (k > 0)
      c = [c[0] + (out[0] - c[0]) * k, c[1] + (out[1] - c[1]) * k, c[2] + (out[2] - c[2]) * k]
  }
  return c
}

export interface ImageDataLike {
  width: number
  height: number
  data: Uint8ClampedArray | Uint8Array
}

/** Renders layers onto an RGBA image on the CPU. */
export function renderImage(
  src: ImageDataLike,
  layers: Layer[],
  luts: LutResolver,
  opts: { subject?: { x: number; y: number }; seed?: number } = {},
): ImageDataLike {
  const { width, height } = src
  const out = new Uint8ClampedArray(width * height * 4)
  const compiled = compileLayers(layers, luts)
  const ctx: PixelContext = { u: 0, v: 0, aspect: width / height, ...opts }
  for (let y = 0; y < height; y++) {
    ctx.v = (y + 0.5) / height
    for (let x = 0; x < width; x++) {
      ctx.u = (x + 0.5) / width
      const i = (y * width + x) * 4
      const c = applyCompiled(
        [
          (src.data[i] as number) / 255,
          (src.data[i + 1] as number) / 255,
          (src.data[i + 2] as number) / 255,
        ],
        compiled,
        ctx,
      )
      out[i] = c[0] * 255 + 0.5
      out[i + 1] = c[1] * 255 + 0.5
      out[i + 2] = c[2] * 255 + 0.5
      out[i + 3] = src.data[i + 3] as number
    }
  }
  return { width, height, data: out }
}

const SPATIAL_MASKS = new Set<Mask['type']>(['linear', 'radial', 'sky', 'subject'])

/**
 * Bakes the color-only part of a layer stack into a 3D LUT (for .cube export
 * and "edit from sample"). Vignette, grain and spatial masks are skipped
 * because a LUT cannot express them.
 */
export function bakeLut(layers: Layer[], luts: LutResolver, size = 33, title?: string): Lut3D {
  const colorOnly = layers
    .filter((l) => !(l.mask && SPATIAL_MASKS.has(l.mask.type)))
    .map((l) => (l.kind === 'basic' ? { ...l, params: { ...l.params, vignette: 0, grain: 0 } } : l))
  const compiled = compileLayers(colorOnly, luts)
  const ctx: PixelContext = { u: 0.5, v: 0.5, aspect: 1 }
  return createLut(size, (c) => applyCompiled(c, compiled, ctx), title)
}
