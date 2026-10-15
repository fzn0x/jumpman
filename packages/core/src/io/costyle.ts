import { type Basic, type BasicKey, clampBasicValue, compactBasic } from '../model/basic.ts'
import { clamp, round } from '../util.ts'
import { escapeXml, tokenizeXml } from './xml.ts'

interface KeyMapping {
  key: string
  field: BasicKey
  toBasic: (v: number) => number
  /** Returns undefined when the Basic value has no Capture One equivalent. */
  fromBasic: (v: number) => number | undefined
}

/**
 * Approximate mapping between Capture One style keys and Basic sliders:
 * - Exposure (EV) 1:1; Capture One's slider stops at ±4 EV.
 * - Brightness and Contrast run −50..50 in Capture One, so they are doubled.
 * - Saturation 1:1.
 * - The recovery sliders are one-sided (0..100): HighlightRecoveryEx and
 *   WhiteRecovery pull down (highlights / whites = −value), ShadowRecovery and
 *   BlackRecovery lift (shadows / blacks = +value). The opposite direction
 *   cannot be expressed.
 * - Vignetting (≈ −4..4 EV) scaled by 25 onto the −100..100 vignette slider.
 */
const MAPPINGS: readonly KeyMapping[] = [
  { key: 'Exposure', field: 'exposure', toBasic: (v) => v, fromBasic: (v) => clamp(v, -4, 4) },
  { key: 'Brightness', field: 'brightness', toBasic: (v) => v * 2, fromBasic: (v) => v / 2 },
  { key: 'Contrast', field: 'contrast', toBasic: (v) => v * 2, fromBasic: (v) => v / 2 },
  { key: 'Saturation', field: 'saturation', toBasic: (v) => v, fromBasic: (v) => v },
  {
    key: 'HighlightRecoveryEx',
    field: 'highlights',
    toBasic: (v) => -v,
    fromBasic: (v) => (v < 0 ? -v : undefined),
  },
  {
    key: 'ShadowRecovery',
    field: 'shadows',
    toBasic: (v) => v,
    fromBasic: (v) => (v > 0 ? v : undefined),
  },
  {
    key: 'WhiteRecovery',
    field: 'whites',
    toBasic: (v) => -v,
    fromBasic: (v) => (v < 0 ? -v : undefined),
  },
  {
    key: 'BlackRecovery',
    field: 'blacks',
    toBasic: (v) => v,
    fromBasic: (v) => (v > 0 ? v : undefined),
  },
  { key: 'Vignetting', field: 'vignette', toBasic: (v) => v * 25, fromBasic: (v) => v / 25 },
]

const BY_KEY = new Map(MAPPINGS.map((m) => [m.key, m]))
/** Older Capture One versions wrote highlight recovery without the "Ex" suffix. */
const ALIASES: Record<string, string> = { HighlightRecovery: 'HighlightRecoveryEx' }
/** Metadata keys that carry no adjustment. */
const METADATA = new Set(['Name', 'UUID', 'StyleSource'])

export interface CostyleImport {
  basic: Partial<Basic>
  /** Style name, when the file has a `Name` entry. */
  name?: string
  warnings: string[]
}

/** Reads the global adjustments of a Capture One `.costyle` / `.copreset` file. */
export function parseCostyle(xml: string): CostyleImport {
  const warnings: string[] = []
  const entries: [string, string][] = []
  let depth = 0
  let inRoot = false
  let sawRoot = false
  let nested = 0
  for (const t of tokenizeXml(xml)) {
    if (t.type === 'open') {
      if (depth === 0 && t.name === 'SL') {
        sawRoot = true
        inRoot = !t.selfClosing
      } else if (inRoot && t.name === 'E') {
        const key = t.attrs.get('K')
        if (key && depth === 1) entries.push([key, t.attrs.get('V') ?? ''])
        else if (key) nested++
      }
      if (!t.selfClosing) depth++
    } else if (t.type === 'close') {
      depth = Math.max(0, depth - 1)
      if (depth === 0) inRoot = false
    }
  }
  if (!sawRoot) {
    return { basic: {}, warnings: ['Not a Capture One style: missing <SL> root element'] }
  }

  const basic: Partial<Basic> = {}
  const unknown = new Set<string>()
  let name: string | undefined
  for (const [rawKey, value] of entries) {
    const key = ALIASES[rawKey] ?? rawKey
    if (key === 'Name') name = value.trim() || undefined
    if (METADATA.has(key)) continue
    const m = BY_KEY.get(key)
    if (!m) {
      unknown.add(rawKey)
      continue
    }
    const v = value.trim() ? Number(value) : Number.NaN
    if (!Number.isFinite(v)) {
      warnings.push(`Ignored ${rawKey}: ${JSON.stringify(value)} is not a number`)
      continue
    }
    basic[m.field] = clampBasicValue(m.field, m.toBasic(v))
  }
  if (unknown.size) {
    warnings.push(`Unsupported Capture One settings ignored: ${[...unknown].join(', ')}`)
  }
  if (nested) warnings.push(`Ignored ${nested} settings inside style layers`)
  const out: CostyleImport = { basic: compactBasic(basic), warnings }
  if (name) out.name = name
  return out
}

function fmt(v: number): string {
  return String(round(v, 2) || 0)
}

/**
 * Writes Basic values as a Capture One style. Only sliders with a Capture One
 * counterpart are written (see the mapping notes above); temperature, tint,
 * vibrance, fade and grain, positive highlights / whites and negative
 * shadows / blacks are left out.
 */
export function basicToCostyle(basic: Partial<Basic>, name?: string): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8" standalone="no" ?>', '<SL Engine="1300">']
  const title = name?.trim()
  if (title) lines.push(`\t<E K="Name" V="${escapeXml(title)}" />`)
  for (const m of MAPPINGS) {
    const v = basic[m.field]
    if (!v) continue
    const out = m.fromBasic(v)
    if (out === undefined || !round(out, 2)) continue
    lines.push(`\t<E K="${m.key}" V="${fmt(out)}" />`)
  }
  lines.push('</SL>', '')
  return lines.join('\n')
}
