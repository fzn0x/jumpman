/**
 * Batch normalization: auto-match, reference-match, adaptive targets and the
 * consistency score. All corrections are expressed as {@link Norm} values in
 * slider units, so they stay visible and editable.
 */
import { TEMP_K, TINT_K } from '../color/color.ts'
import type { Basic } from '../model/basic.ts'
import { type Norm, zeroNorm } from '../model/edit.ts'
import { clamp, mean, round, stddev } from '../util.ts'
import type { PhotoStats } from './stats.ts'

/** White balance gains are exp(±K·t), so log ratios are linear in slider units. */
const TEMP_LOG_PER_UNIT = (2 * TEMP_K) / 100
const TINT_LOG_PER_UNIT = TINT_K / 100
const CONTRAST_LOG_PER_UNIT = 0.9 / 100

/** Linear-light middle gray, the default adaptive exposure target. */
export const MIDDLE_GRAY_EV = Math.log2(0.18)

export interface Measured {
  ev: number
  /** ln(R/B) of the gray-world mean. Positive = warm. */
  warm: number
  /** ln(G / sqrt(R·B)). Positive = green. */
  green: number
  contrast: number
  saturation: number
}

export interface MatchItem {
  stats: PhotoStats
  norm?: Partial<Norm>
  /** Manual per-photo deltas on the base adjust layer. */
  delta?: Partial<Basic>
}

/** Predicts the measurements of a photo after its auto and manual corrections. */
export function measure(item: MatchItem): Measured {
  const { stats } = item
  const n = item.norm ?? {}
  const d = item.delta ?? {}
  const [r, g, b] = stats.meanLinear
  const eps = 1e-6
  const exposure = (n.exposure ?? 0) + (d.exposure ?? 0)
  const temperature = (n.temperature ?? 0) + (d.temperature ?? 0)
  const tint = (n.tint ?? 0) + (d.tint ?? 0)
  const contrast = (n.contrast ?? 0) + (d.contrast ?? 0)
  const saturation = (n.saturation ?? 0) + (d.saturation ?? 0)
  return {
    ev: stats.logAvgLum + exposure,
    warm: Math.log((r + eps) / (b + eps)) + temperature * TEMP_LOG_PER_UNIT,
    green: Math.log((g + eps) / Math.sqrt((r + eps) * (b + eps))) - tint * TINT_LOG_PER_UNIT,
    contrast: Math.max(1e-3, stats.contrast) * Math.exp(contrast * CONTRAST_LOG_PER_UNIT),
    saturation: stats.saturation * Math.max(0, 1 + saturation / 100),
  }
}

export interface MatchOptions {
  exposure?: boolean
  whiteBalance?: boolean
  contrast?: boolean
  saturation?: boolean
  /** 0..1, how far to move toward the target. */
  strength?: number
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2
}

/** Norm that moves `item` from its current measurements to `target`. */
export function normToward(
  item: MatchItem,
  target: Partial<Measured>,
  opts: MatchOptions = {},
): Norm {
  const {
    exposure = true,
    whiteBalance = true,
    contrast = false,
    saturation = false,
    strength = 1,
  } = opts
  const m = measure(item)
  const base = { ...zeroNorm(), ...item.norm }
  const out = { ...base }
  if (exposure && target.ev !== undefined) {
    out.exposure = round(clamp(base.exposure + (target.ev - m.ev) * strength, -3, 3), 2)
  }
  if (whiteBalance && target.warm !== undefined && target.green !== undefined) {
    out.temperature = round(
      clamp(base.temperature + ((target.warm - m.warm) / TEMP_LOG_PER_UNIT) * strength, -100, 100),
      1,
    )
    out.tint = round(
      clamp(base.tint - ((target.green - m.green) / TINT_LOG_PER_UNIT) * strength, -100, 100),
      1,
    )
  }
  if (contrast && target.contrast !== undefined) {
    const c = Math.log(target.contrast / m.contrast) / CONTRAST_LOG_PER_UNIT
    out.contrast = round(clamp(base.contrast + c * strength, -50, 50), 1)
  }
  if (saturation && target.saturation !== undefined && m.saturation > 1e-3) {
    const s = (target.saturation / m.saturation - 1) * 100
    out.saturation = round(clamp(base.saturation + s * strength, -50, 50), 1)
  }
  return out
}

/** Target measurements: the batch median (robust to outliers). */
export function batchTarget(items: MatchItem[]): Measured {
  const ms = items.map(measure)
  return {
    ev: median(ms.map((m) => m.ev)),
    warm: median(ms.map((m) => m.warm)),
    green: median(ms.map((m) => m.green)),
    contrast: median(ms.map((m) => m.contrast)),
    saturation: median(ms.map((m) => m.saturation)),
  }
}

/** Auto-match: normalizes a mixed-lighting batch toward its own median. */
export function autoMatch(items: MatchItem[], opts: MatchOptions = {}): Norm[] {
  if (!items.length) return []
  const target = batchTarget(items)
  return items.map((item) => normToward(item, target, opts))
}

/** Reference-match: matches every photo to a hero photo's look. */
export function referenceMatch(
  hero: MatchItem,
  items: MatchItem[],
  opts: MatchOptions = {},
): Norm[] {
  const target = measure(hero)
  return items.map((item) =>
    item === hero
      ? { ...zeroNorm(), ...item.norm }
      : normToward(item, target, { contrast: true, ...opts }),
  )
}

/**
 * Adaptive mode: exposure targets middle gray and white balance targets the
 * batch median, so a global +0.6 EV means "bring everything to this
 * brightness" rather than "add 0.6 to each".
 */
export function adaptiveNorms(statsList: PhotoStats[]): Norm[] {
  if (!statsList.length) return []
  const items = statsList.map((stats) => ({ stats }))
  const target = { ...batchTarget(items), ev: MIDDLE_GRAY_EV }
  return items.map((item) => normToward(item, target))
}

export interface ConsistencyMetric {
  /** Standard deviation in human units (EV, temperature slider units, contrast %). */
  spread: number
  score: number
}

export interface Consistency {
  /** 0..100, higher is more uniform. */
  score: number
  exposure: ConsistencyMetric
  temperature: ConsistencyMetric
  contrast: ConsistencyMetric
  /** Indices of the photos furthest from the batch, worst first. */
  outliers: number[]
}

/** Consistency of a batch after corrections: how uniform exposure, color temperature and contrast are. */
export function consistency(items: MatchItem[]): Consistency {
  if (items.length < 2) {
    const perfect = { spread: 0, score: 100 }
    return { score: 100, exposure: perfect, temperature: perfect, contrast: perfect, outliers: [] }
  }
  const ms = items.map(measure)
  const evs = ms.map((m) => m.ev)
  const temps = ms.map((m) => m.warm / TEMP_LOG_PER_UNIT)
  const cons = ms.map((m) => Math.log(m.contrast))
  const exposure = stddev(evs)
  const temperature = stddev(temps)
  const contrastSpread = stddev(cons)
  const es = 100 * Math.exp(-exposure / 0.5)
  const ts = 100 * Math.exp(-temperature / 25)
  const cs = 100 * Math.exp(-contrastSpread / 0.25)
  const me = mean(evs)
  const mt = mean(temps)
  const mc = mean(cons)
  const deviation = ms.map(
    (_, i) =>
      Math.abs((evs[i] as number) - me) / 0.5 +
      Math.abs((temps[i] as number) - mt) / 25 +
      Math.abs((cons[i] as number) - mc) / 0.25,
  )
  const outliers = deviation
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d > 1)
    .sort((a, b) => b.d - a.d)
    .map(({ i }) => i)
  return {
    score: Math.round(0.45 * es + 0.35 * ts + 0.2 * cs),
    exposure: { spread: round(exposure, 2), score: Math.round(es) },
    temperature: { spread: round(temperature, 1), score: Math.round(ts) },
    contrast: { spread: round((Math.exp(contrastSpread) - 1) * 100, 1), score: Math.round(cs) },
    outliers,
  }
}

/** Harmonize: auto-match exposure, white balance, contrast and saturation. */
export function harmonize(items: MatchItem[]): Norm[] {
  return autoMatch(items, { exposure: true, whiteBalance: true, contrast: true, saturation: true })
}
