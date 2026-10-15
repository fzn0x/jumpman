/**
 * Basic (tonal + color) adjustments. All sliders are expressed in UI units:
 * exposure in EV stops, everything else on a -100..100 (or 0..100) scale.
 */
export interface Basic {
  exposure: number
  brightness: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  temperature: number
  tint: number
  vibrance: number
  saturation: number
  fade: number
  vignette: number
  grain: number
}

export type BasicKey = keyof Basic

export interface SliderSpec {
  key: BasicKey
  label: string
  min: number
  max: number
  step: number
  /** Number of decimals shown in the UI. */
  precision: number
  group: 'light' | 'color' | 'effects'
}

const spec = (
  key: BasicKey,
  label: string,
  min: number,
  max: number,
  group: SliderSpec['group'],
  step = 1,
  precision = 0,
): SliderSpec => ({ key, label, min, max, step, precision, group })

export const BASIC_SPECS: readonly SliderSpec[] = [
  spec('brightness', 'Brightness', -100, 100, 'light'),
  spec('exposure', 'Exposure', -5, 5, 'light', 0.05, 2),
  spec('highlights', 'Highlights', -100, 100, 'light'),
  spec('shadows', 'Shadows', -100, 100, 'light'),
  spec('contrast', 'Contrast', -100, 100, 'light'),
  spec('whites', 'Whites', -100, 100, 'light'),
  spec('blacks', 'Blacks', -100, 100, 'light'),
  spec('temperature', 'Temperature', -100, 100, 'color'),
  spec('tint', 'Tint', -100, 100, 'color'),
  spec('vibrance', 'Vibrance', -100, 100, 'color'),
  spec('saturation', 'Saturation', -100, 100, 'color'),
  spec('fade', 'Fade', 0, 100, 'effects'),
  spec('vignette', 'Vignette', -100, 100, 'effects'),
  spec('grain', 'Grain', 0, 100, 'effects'),
]

export const BASIC_KEYS: readonly BasicKey[] = BASIC_SPECS.map((s) => s.key)

const SPEC_BY_KEY = new Map(BASIC_SPECS.map((s) => [s.key, s]))

export function basicSpec(key: BasicKey): SliderSpec {
  const spec = SPEC_BY_KEY.get(key)
  if (!spec) throw new Error(`Unknown basic key: ${key}`)
  return spec
}

export function defaultBasic(): Basic {
  return {
    exposure: 0,
    brightness: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    fade: 0,
    vignette: 0,
    grain: 0,
  }
}

export function clampBasicValue(key: BasicKey, value: number): number {
  const { min, max } = basicSpec(key)
  if (Number.isNaN(value)) return 0
  return Math.min(max, Math.max(min, value))
}

/** Adds partial deltas to a full Basic, clamping each result to its slider range. */
export function addBasic(base: Basic, delta: Partial<Basic> | undefined): Basic {
  if (!delta) return base
  const out = { ...base }
  for (const key of BASIC_KEYS) {
    const d = delta[key]
    if (d) out[key] = clampBasicValue(key, out[key] + d)
  }
  return out
}

export function isBasicDefault(b: Partial<Basic>): boolean {
  return BASIC_KEYS.every((k) => !b[k])
}

/** Removes zero entries so overrides stay compact when serialized. */
export function compactBasic(b: Partial<Basic>): Partial<Basic> {
  const out: Partial<Basic> = {}
  for (const key of BASIC_KEYS) {
    const v = b[key]
    if (v) out[key] = v
  }
  return out
}

export function formatBasicValue(key: BasicKey, value: number): string {
  const { precision } = basicSpec(key)
  const fixed = value.toFixed(precision)
  const n = Number(fixed)
  if (n === 0) return precision ? (0).toFixed(precision) : '0'
  return n > 0 ? `+${fixed}` : fixed
}
