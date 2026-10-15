import { deepClone } from '../util.ts'
import { type Basic, defaultBasic } from './basic.ts'

export const HUE_BANDS = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta',
] as const
export type HueBand = (typeof HUE_BANDS)[number]

/** Center hue (degrees) of each HSL band. */
export const HUE_BAND_CENTERS: Record<HueBand, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 240,
  purple: 270,
  magenta: 300,
}

/** Per-band shifts, each in -100..100. */
export interface HslShift {
  hue: number
  saturation: number
  luminance: number
}
export type HslParams = Record<HueBand, HslShift>

/** A tone-curve control point; both coordinates in 0..1. */
export interface CurvePoint {
  x: number
  y: number
}
export interface CurvesParams {
  master: CurvePoint[]
  red: CurvePoint[]
  green: CurvePoint[]
  blue: CurvePoint[]
}

export interface SplitParams {
  /** Degrees 0..360. */
  shadowHue: number
  /** 0..100 */
  shadowSaturation: number
  highlightHue: number
  highlightSaturation: number
  /** -100 (favor shadows) .. 100 (favor highlights) */
  balance: number
}

export interface LutParams {
  lutId: string
}

export type Mask =
  | { type: 'linear'; x0: number; y0: number; x1: number; y1: number; invert?: boolean }
  | {
      type: 'radial'
      cx: number
      cy: number
      rx: number
      ry: number
      /** 0..1 portion of the radius that fades out. */
      feather: number
      invert?: boolean
    }
  | { type: 'luminance'; min: number; max: number; feather: number; invert?: boolean }
  | {
      type: 'color'
      /** Degrees 0..360. */
      hue: number
      /** Half-width in degrees. */
      range: number
      feather: number
      invert?: boolean
    }
  /** Heuristic sky detection: vertical prior combined with sky-like colors. */
  | { type: 'sky'; invert?: boolean }
  /** Heuristic subject: radial region around the photo's salient center. */
  | { type: 'subject'; size: number; invert?: boolean }

export type MaskType = Mask['type']

interface LayerBase {
  id: string
  name: string
  enabled: boolean
  /** 0..1 blend strength of the layer. */
  opacity: number
  mask?: Mask
  /** Set on layers suggested by a collaborator and not yet accepted. */
  proposedBy?: string
}

export interface BasicLayer extends LayerBase {
  kind: 'basic'
  params: Basic
}
export interface CurvesLayer extends LayerBase {
  kind: 'curves'
  params: CurvesParams
}
export interface HslLayer extends LayerBase {
  kind: 'hsl'
  params: HslParams
}
export interface SplitLayer extends LayerBase {
  kind: 'split'
  params: SplitParams
}
export interface LutLayer extends LayerBase {
  kind: 'lut'
  params: LutParams
}

export type Layer = BasicLayer | CurvesLayer | HslLayer | SplitLayer | LutLayer
export type LayerKind = Layer['kind']
export type LayerOf<K extends LayerKind> = Extract<Layer, { kind: K }>
export type LayerParamsOf<K extends LayerKind> = LayerOf<K>['params']

/** The id of the base adjustments layer every edit starts with. */
export const BASE_LAYER_ID = 'base'

let counter = 0
export function newId(prefix = 'l'): string {
  counter = (counter + 1) % 1_000_000
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`
}

export function identityCurve(): CurvePoint[] {
  return [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]
}

export function defaultCurves(): CurvesParams {
  return {
    master: identityCurve(),
    red: identityCurve(),
    green: identityCurve(),
    blue: identityCurve(),
  }
}

export function defaultHsl(): HslParams {
  const out = {} as HslParams
  for (const band of HUE_BANDS) out[band] = { hue: 0, saturation: 0, luminance: 0 }
  return out
}

export function defaultSplit(): SplitParams {
  return {
    shadowHue: 220,
    shadowSaturation: 0,
    highlightHue: 40,
    highlightSaturation: 0,
    balance: 0,
  }
}

export const LAYER_LABELS: Record<LayerKind, string> = {
  basic: 'Adjust',
  curves: 'Curves',
  hsl: 'HSL',
  split: 'Split toning',
  lut: 'LUT',
}

export function defaultParams<K extends LayerKind>(kind: K): LayerParamsOf<K> {
  switch (kind) {
    case 'basic':
      return defaultBasic() as LayerParamsOf<K>
    case 'curves':
      return defaultCurves() as LayerParamsOf<K>
    case 'hsl':
      return defaultHsl() as LayerParamsOf<K>
    case 'split':
      return defaultSplit() as LayerParamsOf<K>
    case 'lut':
      return { lutId: '' } as LayerParamsOf<K>
  }
  throw new Error(`Unknown layer kind: ${kind satisfies never}`)
}

export function createLayer<K extends LayerKind>(
  kind: K,
  init: Partial<Omit<LayerOf<K>, 'kind'>> = {},
): LayerOf<K> {
  return {
    id: init.id ?? newId(),
    name: init.name ?? LAYER_LABELS[kind],
    enabled: init.enabled ?? true,
    opacity: init.opacity ?? 1,
    ...(init.mask ? { mask: init.mask } : {}),
    ...(init.proposedBy ? { proposedBy: init.proposedBy } : {}),
    kind,
    params: init.params ?? defaultParams(kind),
  } as LayerOf<K>
}

export function createBaseLayer(params: Partial<Basic> = {}): BasicLayer {
  return createLayer('basic', {
    id: BASE_LAYER_ID,
    name: 'Global adjust',
    params: { ...defaultBasic(), ...params },
  })
}

export function isCurveIdentity(points: CurvePoint[]): boolean {
  return points.every((p) => Math.abs(p.x - p.y) < 1e-6)
}

/** True when a layer would not change any pixel. */
export function isLayerNoop(layer: Layer): boolean {
  if (!layer.enabled || layer.opacity <= 0) return true
  switch (layer.kind) {
    case 'basic':
      return Object.values(layer.params).every((v) => v === 0)
    case 'curves':
      return (
        isCurveIdentity(layer.params.master) &&
        isCurveIdentity(layer.params.red) &&
        isCurveIdentity(layer.params.green) &&
        isCurveIdentity(layer.params.blue)
      )
    case 'hsl':
      return HUE_BANDS.every((b) => {
        const s = layer.params[b]
        return !s.hue && !s.saturation && !s.luminance
      })
    case 'split':
      return !layer.params.shadowSaturation && !layer.params.highlightSaturation
    case 'lut':
      return !layer.params.lutId
  }
}

export function cloneLayer<L extends Layer>(layer: L, freshId = false): L {
  const copy = deepClone(layer)
  if (freshId) copy.id = newId()
  return copy
}
