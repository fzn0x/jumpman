import {
  BASIC_KEYS,
  type Basic,
  type BasicKey,
  basicSpec,
  clampBasicValue,
  defaultBasic,
} from '../model/basic.ts'
import {
  defaultHsl,
  defaultSplit,
  type HslParams,
  HUE_BANDS,
  type HueBand,
  type SplitParams,
} from '../model/layers.ts'
import { clamp, round } from '../util.ts'
import {
  FILLERS,
  LEXICON,
  type LexEntry,
  MODIFIERS,
  type Modifier,
  type ResetTarget,
  SOFT_SEPARATORS,
} from './lexicon.ts'

export interface DescribeMatch {
  /** The words that were understood, e.g. "softer highlights". */
  phrase: string
  /** What the phrase contributed, e.g. "Highlights −25". */
  effect: string
}

export interface DescribeResult {
  /** Summed, clamped to slider ranges, zero entries omitted. */
  basic: Partial<Basic>
  /** Only the bands a phrase touched. */
  hsl?: Partial<HslParams>
  /** Present when a look implies toning (teal & orange, golden hour, …). */
  split?: SplitParams
  matched: DescribeMatch[]
  /** Leftover words we did not understand, one entry per run of unknown words. */
  unmatched: string[]
}

const MINUS = '−'
const HSL_FIELDS = ['hue', 'saturation', 'luminance'] as const

interface PhraseIndex<T> {
  byPhrase: ReadonlyMap<string, T>
  maxWords: number
}

function indexPhrases<T>(pairs: Iterable<readonly [string, T]>): PhraseIndex<T> {
  const byPhrase = new Map<string, T>()
  let maxWords = 1
  for (const [phrase, value] of pairs) {
    byPhrase.set(phrase, value)
    maxWords = Math.max(maxWords, phrase.split(' ').length)
  }
  return { byPhrase, maxWords }
}

const LEX = indexPhrases(LEXICON.flatMap((e) => e.phrases.map((p) => [p, e] as const)))
const MODS = indexPhrases(MODIFIERS)

/** Caps stacked intensifiers ("very very extremely") before slider clamping kicks in. */
const MAX_FACTOR = 3

/** Every indexed phrase starting at token `i`, longest first. */
function allMatches<T>(
  index: PhraseIndex<T>,
  tokens: readonly string[],
  i: number,
): { value: T; end: number }[] {
  const out: { value: T; end: number }[] = []
  for (let n = Math.min(index.maxWords, tokens.length - i); n > 0; n--) {
    const value = index.byPhrase.get(tokens.slice(i, i + n).join(' '))
    if (value !== undefined) out.push({ value, end: i + n })
  }
  return out
}

const longestMatch = <T>(index: PhraseIndex<T>, tokens: readonly string[], i: number) =>
  allMatches(index, tokens, i)[0]

/** Lowercases, folds British spellings and splits on hard separators into word lists. */
function clauses(text: string): string[][] {
  const normalized = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`]/g, '')
    .replace(/\bb\s*[&/+]\s*w\b/g, 'bw')
    .replace(/&/g, ' and ')
    .replace(/colour/g, 'color')
    .replace(/\bgrey/g, 'gray')
  return normalized
    .split(/[,;.!?:+/()[\]\n]+/)
    .map((c) => c.replace(/[^a-z0-9]+/g, ' ').trim())
    .filter(Boolean)
    .map((c) => c.split(' '))
}

interface Hit {
  end: number
  entry: LexEntry
  factor: number
  /** "no X": switch off what the entry controls instead of adding to it. */
  reset: boolean
}

/** A phrase reached after at least one modifier, with the modifiers met on the way. */
interface Tail {
  end: number
  entry: LexEntry
  mods: Modifier[]
}

/**
 * Best phrase reachable from token `j` through more modifiers and fillers
 * ("of" in "a bit of grain"). Memoized per clause, so modifier-heavy input stays linear.
 */
function tailFrom(
  tokens: readonly string[],
  j: number,
  memo: Map<number, Tail | undefined>,
): Tail | undefined {
  if (memo.has(j)) return memo.get(j)
  const lex = longestMatch(LEX, tokens, j)
  let best: Tail | undefined = lex && { end: lex.end, entry: lex.value, mods: [] }
  for (const m of allMatches(MODS, tokens, j)) {
    const t = tailFrom(tokens, m.end, memo)
    if (t && (!best || t.end > best.end)) best = { ...t, mods: [m.value, ...t.mods] }
  }
  if (FILLERS.has(tokens[j] ?? '')) {
    const t = tailFrom(tokens, j + 1, memo)
    if (t && (!best || t.end > best.end)) best = t
  }
  memo.set(j, best)
  return best
}

/** Folds modifiers left to right; an intensifier before a softener ("very slightly") sharpens it. */
function combine(mods: readonly Modifier[]): Pick<Hit, 'factor' | 'reset'> {
  let factor = 1
  let reset = false
  for (let k = 0; k < mods.length; k++) {
    const m = mods[k]
    const next = mods[k + 1]
    if (m === undefined) continue
    if (m === 'reset') reset = true
    else if (m > 1 && typeof next === 'number' && next > 0 && next < 1) {
      factor *= next ** m
      k++
    } else factor *= m
  }
  return { factor: clamp(factor, -MAX_FACTOR, MAX_FACTOR), reset }
}

function parseAt(
  tokens: readonly string[],
  i: number,
  memo: Map<number, Tail | undefined>,
): Hit | undefined {
  const plain = longestMatch(LEX, tokens, i)
  let best: Hit | undefined = plain && {
    end: plain.end,
    entry: plain.value,
    factor: 1,
    reset: false,
  }
  // A listed phrase wins ties, so "more blacks" keeps its own meaning (deeper, not lifted).
  for (const m of allMatches(MODS, tokens, i)) {
    const t = tailFrom(tokens, m.end, memo)
    if (t && (!best || t.end > best.end)) {
      best = { end: t.end, entry: t.entry, ...combine([m.value, ...t.mods]) }
    }
  }
  return best
}

/** Running sum of hue vectors, so toning from several phrases blends instead of overwriting. */
interface ToneSum {
  x: number
  y: number
  /** Sum of the positive contributions only. */
  px: number
  py: number
}

interface Acc {
  basic: Basic
  hsl: HslParams
  bands: Set<HueBand>
  shadow: ToneSum
  highlight: ToneSum
  balance: number
  balanceWeight: number
  resets: Set<ResetTarget>
}

const toneSum = (): ToneSum => ({ x: 0, y: 0, px: 0, py: 0 })

function addTone(sum: ToneSum, hue: number, amount: number, positive: boolean): void {
  const rad = (hue * Math.PI) / 180
  const dx = amount * Math.cos(rad)
  const dy = amount * Math.sin(rad)
  sum.x += dx
  sum.y += dy
  if (positive) {
    sum.px += dx
    sum.py += dy
  }
}

function resolveTone(sum: ToneSum): { hue: number; saturation: number } {
  // Negative phrases ("less teal and orange") only weaken toning, never flip it to the complement.
  if (sum.x * sum.px + sum.y * sum.py <= 0) return { hue: 0, saturation: 0 }
  const saturation = Math.round(Math.min(100, Math.hypot(sum.x, sum.y)))
  const hue = Math.round(((Math.atan2(sum.y, sum.x) * 180) / Math.PI + 360) % 360) % 360
  return { hue, saturation }
}

function formatSigned(v: number, precision: number): string {
  const n = round(v, precision)
  if (n === 0) return ''
  return `${n > 0 ? '+' : MINUS}${Math.abs(n).toFixed(precision)}`
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** What "no X" switches off: explicit `clears`, else the slider X moves most. */
function clearsOf(entry: LexEntry): readonly ResetTarget[] {
  if (entry.clears) return entry.clears
  let best: BasicKey | undefined
  let bestWeight = 0
  for (const key of BASIC_KEYS) {
    const v = entry.basic?.[key] ?? 0
    // Roughly one EV stop per 50 slider units, so exposure competes fairly.
    const weight = Math.abs(key === 'exposure' ? v * 50 : v)
    if (weight > bestWeight) {
      best = key
      bestWeight = weight
    }
  }
  if (best) return [best]
  if (entry.split) return ['split']
  return HUE_BANDS.filter((b) => entry.hsl?.[b])
}

function resetLabel(target: ResetTarget): string {
  const key = BASIC_KEYS.find((k) => k === target)
  if (key) return `${basicSpec(key).label} 0`
  return target === 'split' ? 'Split toning off' : `${capitalize(target)} HSL 0`
}

/** Adds one phrase to the running totals and describes its contribution. */
function apply(acc: Acc, hit: Hit): string {
  const { entry, factor } = hit
  const targets = entry.resets ?? (hit.reset ? clearsOf(entry) : undefined)
  if (targets) {
    for (const t of targets) acc.resets.add(t)
    return targets.map(resetLabel).join(', ')
  }
  const parts: string[] = []
  for (const key of BASIC_KEYS) {
    const v = (entry.basic?.[key] ?? 0) * factor
    if (!v) continue
    acc.basic[key] += v
    const { label, precision } = basicSpec(key)
    const shown = formatSigned(v, precision)
    if (shown) parts.push(`${label} ${shown}`)
  }
  for (const band of HUE_BANDS) {
    const shift = entry.hsl?.[band]
    if (!shift) continue
    acc.bands.add(band)
    for (const field of HSL_FIELDS) {
      const v = (shift[field] ?? 0) * factor
      acc.hsl[band][field] += v
      const shown = formatSigned(v, 0)
      if (shown) parts.push(`${capitalize(band)} ${field} ${shown}`)
    }
  }
  const split = entry.split
  if (split) {
    addTone(acc.shadow, split.shadowHue, split.shadowSaturation * factor, factor > 0)
    addTone(acc.highlight, split.highlightHue, split.highlightSaturation * factor, factor > 0)
    if (factor > 0) {
      const weight = (split.shadowSaturation + split.highlightSaturation) * factor
      acc.balance += split.balance * weight
      acc.balanceWeight += weight
    }
    const shadow = formatSigned(split.shadowSaturation * factor, 0)
    const highlight = formatSigned(split.highlightSaturation * factor, 0)
    if (shadow) parts.push(`Shadow tone ${split.shadowHue}° ${shadow}`)
    if (highlight) parts.push(`Highlight tone ${split.highlightHue}° ${highlight}`)
  }
  return parts.join(', ') || 'No change'
}

function resolveBasic(acc: Acc): Partial<Basic> {
  const out: Partial<Basic> = {}
  for (const key of BASIC_KEYS) {
    if (acc.resets.has(key)) continue
    const v = round(clampBasicValue(key, acc.basic[key]), basicSpec(key).precision) + 0
    if (v !== 0) out[key] = v
  }
  return out
}

function resolveHsl(acc: Acc): Partial<HslParams> | undefined {
  const out: Partial<HslParams> = {}
  const shift = (v: number) => Math.round(clamp(v, -100, 100)) + 0
  for (const band of HUE_BANDS) {
    if (!acc.bands.has(band) || acc.resets.has(band)) continue
    const s = acc.hsl[band]
    const rounded = {
      hue: shift(s.hue),
      saturation: shift(s.saturation),
      luminance: shift(s.luminance),
    }
    if (rounded.hue || rounded.saturation || rounded.luminance) out[band] = rounded
  }
  return Object.keys(out).length ? out : undefined
}

function resolveSplit(acc: Acc): SplitParams | undefined {
  if (acc.resets.has('split')) return undefined
  const shadow = resolveTone(acc.shadow)
  const highlight = resolveTone(acc.highlight)
  if (!shadow.saturation && !highlight.saturation) return undefined
  const fallback = defaultSplit()
  const balance = acc.balanceWeight ? acc.balance / acc.balanceWeight : 0
  return {
    shadowHue: shadow.saturation ? shadow.hue : fallback.shadowHue,
    shadowSaturation: shadow.saturation,
    highlightHue: highlight.saturation ? highlight.hue : fallback.highlightHue,
    highlightSaturation: highlight.saturation,
    balance: Math.round(clamp(balance, -100, 100)) + 0,
  }
}

/**
 * Turns a free-text description ("warmer, softer highlights, slightly faded") into
 * adjustments. Fully offline and deterministic; unknown words are reported, not guessed.
 */
export function describeToEdit(text: string): DescribeResult {
  const acc: Acc = {
    basic: defaultBasic(),
    hsl: defaultHsl(),
    bands: new Set(),
    shadow: toneSum(),
    highlight: toneSum(),
    balance: 0,
    balanceWeight: 0,
    resets: new Set(),
  }
  const matched: DescribeMatch[] = []
  const unmatched: string[] = []

  for (const tokens of clauses(text)) {
    // Unknown words are grouped into runs; fillers inside a run are kept for readability.
    const memo = new Map<number, Tail | undefined>()
    let runStart = -1
    let runEnd = -1
    const flush = () => {
      if (runStart >= 0) unmatched.push(tokens.slice(runStart, runEnd).join(' '))
      runStart = -1
    }
    let i = 0
    while (i < tokens.length) {
      const hit = parseAt(tokens, i, memo)
      if (hit) {
        flush()
        matched.push({ phrase: tokens.slice(i, hit.end).join(' '), effect: apply(acc, hit) })
        i = hit.end
        continue
      }
      const token = tokens[i] ?? ''
      if (SOFT_SEPARATORS.has(token)) flush()
      else if (!FILLERS.has(token)) {
        if (runStart < 0) runStart = i
        runEnd = i + 1
      }
      i++
    }
    flush()
  }

  const hsl = resolveHsl(acc)
  const split = resolveSplit(acc)
  return {
    basic: resolveBasic(acc),
    ...(hsl ? { hsl } : {}),
    ...(split ? { split } : {}),
    matched,
    unmatched,
  }
}

/** Slight, plain and strong wording for one direction of a slider. */
type Forms = readonly [string, string, string]
type Describer = (b: Partial<Basic>) => string | undefined

/** Below this share of a plain word's change, a slider is not worth mentioning. */
const MIN_RATIO = 0.3

/** `unit` is the change a plain word makes, so words read back roughly as they were typed. */
const graded =
  (value: (b: Partial<Basic>) => number, unit: number, up: Forms, down?: Forms): Describer =>
  (b) => {
    const v = value(b)
    const ratio = Math.abs(v) / unit
    if (!(ratio >= MIN_RATIO)) return undefined
    return (v > 0 ? up : down)?.[ratio < 0.65 ? 0 : ratio < 1.5 ? 1 : 2]
  }

const colorfulness = graded(
  (b) => (b.saturation ?? 0) + (b.vibrance ?? 0) * 0.5,
  20,
  ['slightly vivid', 'vivid', 'very vivid'],
  ['slightly muted', 'muted', 'very muted'],
)

const DESCRIBERS: readonly Describer[] = [
  graded(
    (b) => b.temperature ?? 0,
    20,
    ['slightly warm', 'warm', 'very warm'],
    ['slightly cool', 'cool', 'very cool'],
  ),
  graded(
    (b) => b.tint ?? 0,
    15,
    ['slight magenta tint', 'magenta tint', 'strong magenta tint'],
    ['slight green tint', 'green tint', 'strong green tint'],
  ),
  graded(
    (b) => (b.exposure ?? 0) * 50 + (b.brightness ?? 0) * 0.5,
    15,
    ['slightly bright', 'bright', 'very bright'],
    ['slightly dark', 'dark', 'very dark'],
  ),
  graded(
    (b) => b.contrast ?? 0,
    20,
    ['slightly punchy', 'high contrast', 'very high contrast'],
    ['slightly flat', 'low contrast', 'very low contrast'],
  ),
  (b) => ((b.saturation ?? 0) <= -90 ? 'black and white' : colorfulness(b)),
  graded(
    (b) => b.highlights ?? 0,
    20,
    ['slightly bright highlights', 'bright highlights', 'very bright highlights'],
    ['slightly soft highlights', 'soft highlights', 'very soft highlights'],
  ),
  graded(
    (b) => b.shadows ?? 0,
    20,
    ['slightly lifted shadows', 'lifted shadows', 'strongly lifted shadows'],
    ['slightly deep shadows', 'deep shadows', 'very deep shadows'],
  ),
  graded(
    (b) => b.whites ?? 0,
    20,
    ['slightly bright whites', 'bright whites', 'very bright whites'],
    ['slightly dim whites', 'dim whites', 'very dim whites'],
  ),
  graded(
    (b) => b.blacks ?? 0,
    20,
    ['slightly lifted blacks', 'lifted blacks', 'strongly lifted blacks'],
    ['slightly crushed blacks', 'crushed blacks', 'heavily crushed blacks'],
  ),
  graded((b) => b.fade ?? 0, 15, ['slightly faded', 'faded', 'heavily faded']),
  graded((b) => b.grain ?? 0, 20, ['fine grain', 'grainy', 'very grainy']),
  graded(
    (b) => b.vignette ?? 0,
    20,
    ['subtle white vignette', 'white vignette', 'strong white vignette'],
    ['subtle vignette', 'vignette', 'strong vignette'],
  ),
]

/**
 * Describes basic adjustments in a few words ("warm, bright, low contrast, slightly faded"),
 * roughly the inverse of `describeToEdit`. Returns an empty string for a default edit.
 */
export function describeEditInWords(basic: Partial<Basic>): string {
  return DESCRIBERS.map((d) => d(basic))
    .filter((w): w is string => !!w)
    .join(', ')
}
