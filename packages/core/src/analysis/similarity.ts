/** Smart selection: by visual similarity, time, scene type and color palette. */
import { hexToRgb, rgbToHsl } from '../color/color.ts'
import { classifyScene, type SceneType } from './scene.ts'
import type { PhotoStats } from './stats.ts'

export interface SelectablePhoto {
  id: string
  stats?: PhotoStats
  /** Capture time (ms since epoch), from EXIF or file date. */
  takenAt?: number
}

export function hammingHex(a: string, b: string): number {
  let d = 0
  for (let i = 0; i < Math.min(a.length, b.length); i += 4) {
    let x = Number.parseInt(a.slice(i, i + 4), 16) ^ Number.parseInt(b.slice(i, i + 4), 16)
    while (x) {
      d += x & 1
      x >>>= 1
    }
  }
  return d
}

function l1(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    s += Math.abs((a[i] as number) - (b[i] as number))
  return s
}

/** Earth mover's distance between two 1D histograms, normalized to 0..1. */
export function histogramEmd(a: number[], b: number[]): number {
  let ca = 0
  let cb = 0
  let d = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    ca += a[i] as number
    cb += b[i] as number
    d += Math.abs(ca - cb)
  }
  return n ? d / n : 0
}

/** 0 (different) .. 1 (near-identical) visual similarity of two photos. */
export function similarity(a: PhotoStats, b: PhotoStats): number {
  const structure = 1 - hammingHex(a.dhash, b.dhash) / 64
  const tone = 1 - Math.min(1, histogramEmd(a.lumHist, b.lumHist) * 3)
  const sumA = a.hueHist.reduce((s, v) => s + v, 0) || 1
  const sumB = b.hueHist.reduce((s, v) => s + v, 0) || 1
  const color =
    1 -
    l1(
      a.hueHist.map((v) => v / sumA),
      b.hueHist.map((v) => v / sumB),
    ) /
      2
  return structure * 0.5 + tone * 0.25 + color * 0.25
}

export function selectSimilar(
  seed: SelectablePhoto,
  photos: SelectablePhoto[],
  threshold = 0.72,
): string[] {
  if (!seed.stats) return [seed.id]
  const s = seed.stats
  return photos
    .filter((p) => p.id === seed.id || (p.stats && similarity(s, p.stats) >= threshold))
    .map((p) => p.id)
}

export function selectTimeRange(photos: SelectablePhoto[], from: number, to: number): string[] {
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  return photos
    .filter((p) => p.takenAt !== undefined && p.takenAt >= lo && p.takenAt <= hi)
    .map((p) => p.id)
}

/** Groups photos into "moments": runs with less than `gapMs` between shots. */
export function groupByMoment(photos: SelectablePhoto[], gapMs = 10 * 60_000): string[][] {
  const timed = photos
    .filter((p) => p.takenAt !== undefined)
    .sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0))
  const groups: string[][] = []
  let last = Number.NEGATIVE_INFINITY
  for (const p of timed) {
    const t = p.takenAt as number
    if (t - last > gapMs || !groups.length) groups.push([])
    groups[groups.length - 1]?.push(p.id)
    last = t
  }
  return groups
}

/** Selects the moment (burst) a seed photo belongs to. */
export function selectSameMoment(
  seed: SelectablePhoto,
  photos: SelectablePhoto[],
  gapMs?: number,
): string[] {
  return groupByMoment(photos, gapMs).find((g) => g.includes(seed.id)) ?? [seed.id]
}

export function selectByScene(scene: SceneType, photos: SelectablePhoto[]): string[] {
  return photos.filter((p) => p.stats && classifyScene(p.stats).primary === scene).map((p) => p.id)
}

function hueOf(hex: string): { hue: number; sat: number; light: number } {
  const [hue, sat, light] = rgbToHsl(hexToRgb(hex))
  return { hue, sat, light }
}

/** How strongly a palette color is present in a photo (0..1). */
export function paletteAffinity(stats: PhotoStats, hex: string): number {
  const target = hueOf(hex)
  let best = 0
  stats.palette.forEach((c, i) => {
    const h = hueOf(c)
    const w = stats.paletteWeights[i] ?? 0
    const neutralBoth = target.sat < 0.12 && h.sat < 0.12
    const dh = Math.min(Math.abs(h.hue - target.hue), 360 - Math.abs(h.hue - target.hue))
    const hueMatch = neutralBoth
      ? 1 - Math.abs(h.light - target.light)
      : target.sat < 0.12 || h.sat < 0.12
        ? 0
        : 1 - dh / 40
    const lightMatch = 1 - Math.abs(h.light - target.light) * 0.8
    best = Math.max(best, Math.max(0, hueMatch) * Math.max(0, lightMatch) * Math.min(1, w * 3))
  })
  return best
}

export function selectByColor(hex: string, photos: SelectablePhoto[], threshold = 0.35): string[] {
  return photos
    .filter((p) => p.stats && paletteAffinity(p.stats, hex) >= threshold)
    .map((p) => p.id)
}

/** A compact palette for the whole batch, for color-chip selection. */
export function batchPalette(photos: SelectablePhoto[], max = 8): string[] {
  const weighted = new Map<string, number>()
  for (const p of photos) {
    p.stats?.palette.forEach((c, i) => {
      weighted.set(c, (weighted.get(c) ?? 0) + (p.stats?.paletteWeights[i] ?? 0))
    })
  }
  const out: string[] = []
  for (const [hex] of [...weighted].sort((a, b) => b[1] - a[1])) {
    const h = hueOf(hex)
    const dup = out.some((o) => {
      const k = hueOf(o)
      const dh = Math.min(Math.abs(k.hue - h.hue), 360 - Math.abs(k.hue - h.hue))
      return (
        (k.sat < 0.12 && h.sat < 0.12 && Math.abs(k.light - h.light) < 0.2) ||
        (dh < 25 && Math.abs(k.light - h.light) < 0.25)
      )
    })
    if (!dup) out.push(hex)
    if (out.length >= max) break
  }
  return out
}
