/**
 * Per-photo statistics computed once from a small thumbnail. They power
 * auto-match, reference-match, consistency scoring, smart selection and
 * scene-aware edits.
 */
import {
  linearToOklab,
  linearToSrgb,
  oklabToLinear,
  rgbToHex,
  rgbToHsl,
  srgbToLinear,
} from '../color/color.ts'
import type { RGB } from '../color/lut.ts'
import type { ImageDataLike } from '../color/pipeline.ts'
import { clamp } from '../util.ts'

export interface SceneScores {
  /** Fraction of pixels that look like sky in the upper half. */
  sky: number
  foliage: number
  skin: number
  /** 0..1, how dark the photo is overall. */
  lowLight: number
  /** -1 (cool) .. 1 (warm) cast of the gray-world mean. */
  warmth: number
  /** Fraction of near-neutral pixels (architecture, overcast, monochrome). */
  neutral: number
}

export interface PhotoStats {
  version: 1
  /** log2 of the geometric mean linear luminance (EV relative to white). */
  logAvgLum: number
  /** Gray-world mean color in linear light. */
  meanLinear: RGB
  /** Display-referred luminance percentiles. */
  p05: number
  p50: number
  p95: number
  /** Standard deviation of log2 luminance (a robust contrast measure). */
  contrast: number
  /** Mean HSL saturation. */
  saturation: number
  /** 32-bin display luminance histogram, sums to 1. */
  lumHist: number[]
  /** 12 hue buckets of 30°, weighted by saturation, sums to <= 1. */
  hueHist: number[]
  /** Dominant colors (hex) ordered by weight. */
  palette: string[]
  paletteWeights: number[]
  /** 64-bit difference hash as 16 hex chars. */
  dhash: string
  oklabMean: RGB
  oklabStd: RGB
  scene: SceneScores
  /** Salient center, normalized coordinates. */
  subject: { x: number; y: number }
}

const MAX_SAMPLES = 90_000

const bump = (a: number[], i: number, v = 1) => {
  a[i] = (a[i] ?? 0) + v
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-filter downsample to a w×h grayscale (display luminance) grid. */
export function grayGrid(img: ImageDataLike, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h)
  const cnt = new Float64Array(w * h)
  const { width, height, data } = img
  for (let y = 0; y < height; y++) {
    const gy = Math.min(h - 1, Math.floor((y * h) / height))
    for (let x = 0; x < width; x++) {
      const gx = Math.min(w - 1, Math.floor((x * w) / width))
      const i = (y * width + x) * 4
      const l =
        0.2126 * (data[i] as number) +
        0.7152 * (data[i + 1] as number) +
        0.0722 * (data[i + 2] as number)
      out[gy * w + gx] = (out[gy * w + gx] as number) + l
      cnt[gy * w + gx] = (cnt[gy * w + gx] as number) + 1
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / Math.max(1, cnt[i] as number)
  return out
}

/** 64-bit difference hash: compares horizontally adjacent cells of a 9×8 grid. */
export function differenceHash(img: ImageDataLike): string {
  const g = grayGrid(img, 9, 8)
  let hex = ''
  for (let y = 0; y < 8; y++) {
    let byte = 0
    for (let x = 0; x < 8; x++) {
      byte = (byte << 1) | ((g[y * 9 + x] as number) > (g[y * 9 + x + 1] as number) ? 1 : 0)
    }
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

function kmeansPalette(
  samples: RGB[],
  k: number,
  iterations = 10,
): { colors: RGB[]; weights: number[] } {
  if (!samples.length) return { colors: [], weights: [] }
  const rand = mulberry32(42)
  const centers: RGB[] = [samples[Math.floor(rand() * samples.length)] as RGB]
  const dist2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  while (centers.length < Math.min(k, samples.length)) {
    const d = samples.map((s) => Math.min(...centers.map((c) => dist2(s, c))))
    const total = d.reduce((a, b) => a + b, 0)
    if (total <= 0) break
    let r = rand() * total
    let idx = 0
    for (; idx < d.length - 1; idx++) {
      r -= d[idx] as number
      if (r <= 0) break
    }
    centers.push(samples[idx] as RGB)
  }
  const assign = new Int32Array(samples.length)
  for (let it = 0; it < iterations; it++) {
    samples.forEach((s, i) => {
      let best = 0
      let bd = Number.POSITIVE_INFINITY
      centers.forEach((c, j) => {
        const dd = dist2(s, c)
        if (dd < bd) {
          bd = dd
          best = j
        }
      })
      assign[i] = best
    })
    const sums = centers.map(() => [0, 0, 0, 0])
    samples.forEach((s, i) => {
      const acc = sums[assign[i] as number] as number[]
      acc[0] = (acc[0] as number) + s[0]
      acc[1] = (acc[1] as number) + s[1]
      acc[2] = (acc[2] as number) + s[2]
      acc[3] = (acc[3] as number) + 1
    })
    sums.forEach((acc, j) => {
      const n = acc[3] as number
      if (n) centers[j] = [(acc[0] as number) / n, (acc[1] as number) / n, (acc[2] as number) / n]
    })
  }
  const counts = centers.map(() => 0)
  for (const a of assign) counts[a] = (counts[a] as number) + 1
  const order = centers
    .map((_, i) => i)
    .sort((a, b) => (counts[b] as number) - (counts[a] as number))
  return {
    colors: order.map((i) => centers[i] as RGB),
    weights: order.map((i) => (counts[i] as number) / samples.length),
  }
}

/** Computes statistics from an RGBA thumbnail (≈256px long edge is plenty). */
export function computeStats(img: ImageDataLike): PhotoStats {
  const { width, height, data } = img
  const total = width * height
  const stride = Math.max(1, Math.floor(total / MAX_SAMPLES))
  let n = 0
  let logSum = 0
  let logSqSum = 0
  const mean: RGB = [0, 0, 0]
  let grayN = 0
  const gray: RGB = [0, 0, 0]
  let satSum = 0
  const lumHist = new Array<number>(32).fill(0)
  const fine = new Array<number>(256).fill(0)
  const hueHist = new Array<number>(12).fill(0)
  const labSum: RGB = [0, 0, 0]
  const labSq: RGB = [0, 0, 0]
  let sky = 0
  let foliage = 0
  let skin = 0
  let neutral = 0
  let dark = 0
  let upper = 0
  const paletteSamples: RGB[] = []
  const paletteEvery = Math.max(1, Math.floor(total / stride / 2500))
  const G = 12
  const cellLab = Array.from({ length: G * G }, () => [0, 0, 0, 0, 0])

  for (let p = 0, s = 0; p < total; p += stride, s++) {
    const i = p * 4
    const r = (data[i] as number) / 255
    const g = (data[i + 1] as number) / 255
    const b = (data[i + 2] as number) / 255
    const lin: RGB = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
    const Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    const L = linearToSrgb(Y)
    const lg = Math.log2(Y + 1e-4)
    logSum += lg
    logSqSum += lg * lg
    mean[0] += lin[0]
    mean[1] += lin[1]
    mean[2] += lin[2]
    bump(lumHist, Math.min(31, Math.floor(L * 32)))
    bump(fine, Math.min(255, Math.floor(L * 256)))
    const [h, sat, l] = rgbToHsl([r, g, b])
    satSum += sat
    if (L > 0.08 && L < 0.92 && sat < 0.6) {
      gray[0] += lin[0]
      gray[1] += lin[1]
      gray[2] += lin[2]
      grayN++
    }
    if (sat > 0.1 && l > 0.08 && l < 0.92) bump(hueHist, Math.floor(h / 30) % 12, sat)
    if (sat < 0.1) neutral++
    if (L < 0.18) dark++
    const x = p % width
    const y = Math.floor(p / width)
    const v = (y + 0.5) / height
    if (v < 0.5) {
      upper++
      const blueSky = h >= 185 && h <= 250 && sat > 0.15 && l > 0.35
      const overcast = l > 0.75 && sat < 0.15 && v < 0.4
      if (blueSky || overcast) sky++
    }
    if (h >= 60 && h <= 160 && sat > 0.2 && l > 0.12 && l < 0.8) foliage++
    if (h >= 5 && h <= 45 && sat > 0.2 && sat < 0.7 && l > 0.25 && l < 0.85) skin++
    const lab = linearToOklab(lin)
    for (let c = 0; c < 3; c++) {
      labSum[c] = (labSum[c] as number) + (lab[c] as number)
      labSq[c] = (labSq[c] as number) + (lab[c] as number) ** 2
    }
    const cell =
      cellLab[
        Math.min(G - 1, Math.floor((y * G) / height)) * G +
          Math.min(G - 1, Math.floor((x * G) / width))
      ]
    if (cell) {
      cell[0] = (cell[0] as number) + lab[0]
      cell[1] = (cell[1] as number) + lab[1]
      cell[2] = (cell[2] as number) + lab[2]
      cell[3] = (cell[3] as number) + lab[0] * lab[0]
      cell[4] = (cell[4] as number) + 1
    }
    if (s % paletteEvery === 0) paletteSamples.push(lab)
    n++
  }

  const N = Math.max(1, n)
  const logAvg = logSum / N
  const contrast = Math.sqrt(Math.max(0, logSqSum / N - logAvg * logAvg))
  const meanLinear: RGB =
    grayN > N * 0.1
      ? [gray[0] / grayN, gray[1] / grayN, gray[2] / grayN]
      : [mean[0] / N, mean[1] / N, mean[2] / N]
  const pct = (q: number) => {
    let acc = 0
    for (let i = 0; i < 256; i++) {
      acc += fine[i] as number
      if (acc >= q * N) return (i + 0.5) / 256
    }
    return 1
  }
  const oklabMean = labSum.map((v) => v / N) as RGB
  const oklabStd = labSq.map((v, c) =>
    Math.sqrt(Math.max(0, v / N - (oklabMean[c] as number) ** 2)),
  ) as RGB

  // Saliency: cells that differ from the global mean color or have local
  // contrast, weighted toward the frame center.
  const saliency = cellLab.map((c, idx) => {
    const cn = c[4] as number
    if (!cn) return 0
    const m: RGB = [(c[0] as number) / cn, (c[1] as number) / cn, (c[2] as number) / cn]
    const std = Math.sqrt(Math.max(0, (c[3] as number) / cn - m[0] * m[0]))
    const d = Math.hypot(m[0] - oklabMean[0], (m[1] - oklabMean[1]) * 2, (m[2] - oklabMean[2]) * 2)
    const cx = ((idx % G) + 0.5) / G
    const cy = (Math.floor(idx / G) + 0.5) / G
    const prior = Math.exp(-((cx - 0.5) ** 2 + (cy - 0.5) ** 2) / 0.18)
    return (d + std * 0.5) * prior
  })
  const sorted = [...saliency].sort((a, b) => a - b)
  const cut = sorted[Math.floor(sorted.length * 0.75)] ?? 0
  let sx = 0
  let sy = 0
  let sw = 0
  saliency.forEach((w, idx) => {
    if (w < cut || w <= 0) return
    sx += (((idx % G) + 0.5) / G) * w
    sy += ((Math.floor(idx / G) + 0.5) / G) * w
    sw += w
  })

  const { colors, weights } = kmeansPalette(paletteSamples, 5)
  return {
    version: 1,
    logAvgLum: logAvg,
    meanLinear,
    p05: pct(0.05),
    p50: pct(0.5),
    p95: pct(0.95),
    contrast,
    saturation: satSum / N,
    lumHist: lumHist.map((v) => v / N),
    hueHist: hueHist.map((v) => v / N),
    palette: colors.map((c) =>
      rgbToHex(oklabToLinear(c).map((v) => linearToSrgb(clamp(v))) as RGB),
    ),
    paletteWeights: weights,
    dhash: differenceHash(img),
    oklabMean,
    oklabStd,
    scene: {
      sky: upper ? sky / upper : 0,
      foliage: foliage / N,
      skin: skin / N,
      lowLight: clamp((-logAvg - 3) / 3) * 0.5 + (dark / N) * 0.5,
      warmth: clamp(
        (meanLinear[0] - meanLinear[2]) / (meanLinear[0] + meanLinear[2] + 1e-6),
        -1,
        1,
      ),
      neutral: neutral / N,
    },
    subject: sw > 0 ? { x: sx / sw, y: sy / sw } : { x: 0.5, y: 0.5 },
  }
}
