/** Series mode: tools for sequences (time-lapses, bursts, story sets). */
import { TEMP_K } from '../color/color.ts'
import { BASIC_KEYS, type Basic, compactBasic } from '../model/basic.ts'
import type { PhotoOverride } from '../model/edit.ts'
import { LAYER_LABELS, type Layer } from '../model/layers.ts'
import { round } from '../util.ts'
import type { PhotoStats } from './stats.ts'

/** Centered moving average of a series. */
export function smooth(values: number[], radius: number): number[] {
  if (radius <= 0) return [...values]
  return values.map((_, i) => {
    let s = 0
    let n = 0
    for (let j = Math.max(0, i - radius); j <= Math.min(values.length - 1, i + radius); j++) {
      s += values[j] as number
      n++
    }
    return s / n
  })
}

/**
 * Deflicker: exposure offsets (EV) that flatten frame-to-frame brightness
 * jumps while keeping the slow natural trend (e.g. a sunset getting darker).
 * `radius` is the smoothing window half-width in frames.
 */
export function deflicker(ordered: PhotoStats[], radius = 3): number[] {
  const evs = ordered.map((s) => s.logAvgLum)
  const trend = smooth(evs, radius)
  return evs.map((ev, i) => round((trend[i] as number) - ev, 2))
}

/** Same as deflicker for white balance, in temperature slider units. */
export function deflickerTemperature(ordered: PhotoStats[], radius = 3): number[] {
  const warm = ordered.map(
    (s) => Math.log((s.meanLinear[0] + 1e-6) / (s.meanLinear[2] + 1e-6)) / ((2 * TEMP_K) / 100),
  )
  const trend = smooth(warm, radius)
  return warm.map((w, i) => round((trend[i] as number) - w, 1))
}

/**
 * Gradual shift: interpolates per-photo overrides between the first and the
 * last photo of an ordered sequence, so a look evolves across the series.
 * Basic deltas are interpolated numerically; photo-only layers fade in/out
 * via opacity.
 */
export function gradualShift(
  first: PhotoOverride,
  last: PhotoOverride,
  count: number,
): PhotoOverride[] {
  if (count <= 0) return []
  if (count === 1) return [first]
  const layerIds = new Set([
    ...Object.keys(first.basicDeltas ?? {}),
    ...Object.keys(last.basicDeltas ?? {}),
  ])
  const out: PhotoOverride[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const basicDeltas: Record<string, Partial<Basic>> = {}
    for (const id of layerIds) {
      const a = first.basicDeltas?.[id] ?? {}
      const b = last.basicDeltas?.[id] ?? {}
      const d: Partial<Basic> = {}
      for (const k of BASIC_KEYS) {
        const v = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t
        if (v) d[k] = round(v, k === 'exposure' ? 2 : 1)
      }
      const c = compactBasic(d)
      if (Object.keys(c).length) basicDeltas[id] = c
    }
    const layers: Layer[] = [
      ...(first.layers ?? []).map((l) => ({ ...l, opacity: round(l.opacity * (1 - t), 3) })),
      ...(last.layers ?? []).map((l) => ({
        ...l,
        id: `${l.id}~end`,
        opacity: round(l.opacity * t, 3),
      })),
    ].filter((l) => l.opacity > 0) as Layer[]
    const o: PhotoOverride = {}
    if (Object.keys(basicDeltas).length) o.basicDeltas = basicDeltas
    if (layers.length) o.layers = layers
    out.push(o)
  }
  return out
}

/** Human summary of a gradual shift for the UI. */
export function describeShift(first: PhotoOverride, last: PhotoOverride): string {
  const keys = new Set<string>()
  for (const o of [first, last]) {
    for (const d of Object.values(o.basicDeltas ?? {}))
      for (const k of Object.keys(compactBasic(d))) keys.add(k)
    for (const l of o.layers ?? []) keys.add(LAYER_LABELS[l.kind])
  }
  return [...keys].join(', ')
}
