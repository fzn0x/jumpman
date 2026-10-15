/**
 * Validation for edit data coming from untrusted places (shared preset links,
 * community presets, review bundles). Everything is rebuilt from defaults so
 * unknown keys are dropped and numbers are clamped.
 */
import { clamp } from '../util.ts'
import { BASIC_KEYS, type Basic, clampBasicValue, defaultBasic } from './basic.ts'
import {
  type CurvePoint,
  createLayer,
  defaultCurves,
  defaultHsl,
  defaultSplit,
  HUE_BANDS,
  type Layer,
  type Mask,
} from './layers.ts'

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, lo: number, hi: number, fallback = 0) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback
}
export const str = (v: unknown, max = 200, fallback = ''): string =>
  typeof v === 'string' ? v.slice(0, max) : fallback

export function sanitizeBasic(v: unknown): Basic {
  const out = defaultBasic()
  if (!isObj(v)) return out
  for (const k of BASIC_KEYS) if (k in v) out[k] = clampBasicValue(k, num(v[k], -1e6, 1e6))
  return out
}

export function sanitizePartialBasic(v: unknown): Partial<Basic> {
  const out: Partial<Basic> = {}
  if (!isObj(v)) return out
  for (const k of BASIC_KEYS) if (k in v) out[k] = num(v[k], -200, 200)
  return out
}

function sanitizeCurve(v: unknown): CurvePoint[] {
  if (!Array.isArray(v)) return defaultCurves().master
  const pts = v
    .slice(0, 16)
    .filter(isObj)
    .map((p) => ({ x: num(p.x, 0, 1), y: num(p.y, 0, 1) }))
  return pts.length >= 2 ? pts : defaultCurves().master
}

export function sanitizeMask(v: unknown): Mask | undefined {
  if (!isObj(v)) return undefined
  const invert = v.invert === true
  const extra = invert ? { invert } : {}
  switch (v.type) {
    case 'linear':
      return {
        type: 'linear',
        x0: num(v.x0, -1, 2),
        y0: num(v.y0, -1, 2),
        x1: num(v.x1, -1, 2),
        y1: num(v.y1, -1, 2),
        ...extra,
      }
    case 'radial':
      return {
        type: 'radial',
        cx: num(v.cx, -1, 2, 0.5),
        cy: num(v.cy, -1, 2, 0.5),
        rx: num(v.rx, 0.01, 3, 0.3),
        ry: num(v.ry, 0.01, 3, 0.3),
        feather: num(v.feather, 0, 1, 0.5),
        ...extra,
      }
    case 'luminance':
      return {
        type: 'luminance',
        min: num(v.min, 0, 1),
        max: num(v.max, 0, 1, 1),
        feather: num(v.feather, 0, 1, 0.1),
        ...extra,
      }
    case 'color':
      return {
        type: 'color',
        hue: num(v.hue, 0, 360),
        range: num(v.range, 1, 180, 20),
        feather: num(v.feather, 0, 1, 0.5),
        ...extra,
      }
    case 'sky':
      return { type: 'sky', ...extra }
    case 'subject':
      return { type: 'subject', size: num(v.size, 0.05, 1.5, 0.5), ...extra }
    default:
      return undefined
  }
}

/** Rebuilds a layer from untrusted JSON, or returns null if it is unusable. */
export function sanitizeLayer(v: unknown): Layer | null {
  if (!isObj(v)) return null
  const p = isObj(v.params) ? v.params : {}
  const mask = sanitizeMask(v.mask)
  const common = {
    id: str(v.id, 64) || undefined,
    name: str(v.name, 80) || undefined,
    enabled: v.enabled !== false,
    opacity: num(v.opacity, 0, 1, 1),
    ...(mask ? { mask } : {}),
    ...(typeof v.proposedBy === 'string' ? { proposedBy: str(v.proposedBy, 80) } : {}),
  }
  switch (v.kind) {
    case 'basic':
      return createLayer('basic', { ...common, params: sanitizeBasic(p) })
    case 'curves':
      return createLayer('curves', {
        ...common,
        params: {
          master: sanitizeCurve(p.master),
          red: sanitizeCurve(p.red),
          green: sanitizeCurve(p.green),
          blue: sanitizeCurve(p.blue),
        },
      })
    case 'hsl': {
      const params = defaultHsl()
      for (const band of HUE_BANDS) {
        const b = p[band]
        if (isObj(b)) {
          params[band] = {
            hue: num(b.hue, -100, 100),
            saturation: num(b.saturation, -100, 100),
            luminance: num(b.luminance, -100, 100),
          }
        }
      }
      return createLayer('hsl', { ...common, params })
    }
    case 'split': {
      const d = defaultSplit()
      return createLayer('split', {
        ...common,
        params: {
          shadowHue: num(p.shadowHue, 0, 360, d.shadowHue),
          shadowSaturation: num(p.shadowSaturation, 0, 100),
          highlightHue: num(p.highlightHue, 0, 360, d.highlightHue),
          highlightSaturation: num(p.highlightSaturation, 0, 100),
          balance: num(p.balance, -100, 100),
        },
      })
    }
    case 'lut': {
      const lutId = str(p.lutId, 120)
      return lutId ? createLayer('lut', { ...common, params: { lutId } }) : null
    }
    default:
      return null
  }
}

export function sanitizeLayers(v: unknown, max = 32): Layer[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: Layer[] = []
  for (const item of v.slice(0, max)) {
    const layer = sanitizeLayer(item)
    if (!layer || seen.has(layer.id)) continue
    seen.add(layer.id)
    out.push(layer)
  }
  return out
}
