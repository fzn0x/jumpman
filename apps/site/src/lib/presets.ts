/**
 * Community presets, read from `community/presets/*.json` at build time and validated with the
 * same parser the app uses. A broken preset fails the build instead of shipping silently.
 */
import {
  builtinLutId,
  describeEditInWords,
  type Layer,
  LOOKS,
  type LookRecipe,
  type Preset,
  parsePreset,
  presetToShareString,
} from '@jumpman/core'
import { withBase } from './site'

const files = import.meta.glob<unknown>('../../../../community/presets/*.json', {
  eager: true,
  import: 'default',
})

export const GALLERY_SCHEMA = 'jumpman.gallery/1'

export function loadCommunityPresets(): Preset[] {
  const presets = Object.entries(files).map(([path, raw]) => {
    try {
      return parsePreset(raw)
    } catch (err) {
      throw new Error(`Invalid community preset ${path}: ${(err as Error).message}`)
    }
  })
  return presets.sort((a, b) => a.name.localeCompare(b.name))
}

/** Deep link that opens the preset in the web app (`#preset=<share string>`). */
export function tryInAppUrl(preset: Preset): string {
  return `${withBase('app/')}#preset=${presetToShareString(preset)}`
}

function lookFor(layer: Layer): LookRecipe | undefined {
  if (layer.kind !== 'lut') return undefined
  return LOOKS.find((look) => builtinLutId(look.id) === layer.params.lutId)
}

const LAYER_LABELS: Record<Layer['kind'], string> = {
  basic: 'Adjust',
  curves: 'Curves',
  hsl: 'HSL',
  split: 'Split toning',
  lut: 'LUT',
}

/** Short, human labels for a preset's layer stack, e.g. ["Adjust", "LUT · Spring Pink", "HSL"]. */
export function layerLabels(preset: Preset): string[] {
  return preset.layers.map((layer) => {
    if (layer.kind !== 'lut') return LAYER_LABELS[layer.kind]
    return `LUT · ${lookFor(layer)?.name ?? 'Custom'}`
  })
}

/** The base adjustments in a few words ("warm, bright, soft highlights"). */
export function presetInWords(preset: Preset): string {
  const basic = preset.layers.find((l) => l.kind === 'basic')
  return basic ? describeEditInWords(basic.params) : ''
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  const out = ca.map((v, i) => Math.round(v + ((cb[i] as number) - v) * t))
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * CSS gradient for a preset's color strip: from the swatch of its built-in LUT when it has one,
 * otherwise a neutral ramp nudged warm or cool by the preset's temperature.
 */
export function presetStrip(preset: Preset): string {
  const look = preset.layers.map(lookFor).find(Boolean)
  if (look) {
    const s = look.swatch
    return `linear-gradient(100deg, ${mix(s, '#1c1c1e', 0.6)}, ${s} 55%, ${mix(s, '#ffffff', 0.6)})`
  }
  const basic = preset.layers.find((l) => l.kind === 'basic')
  const temperature = basic?.params.temperature ?? 0
  const tint = temperature >= 0 ? '#e9b872' : '#9db4c0'
  const k = Math.min(Math.abs(temperature) / 60, 1) * 0.5
  return `linear-gradient(100deg, ${mix('#3a3a3c', tint, k * 0.5)}, ${mix('#8e8e93', tint, k)} 55%, ${mix('#e5e5ea', tint, k)})`
}
