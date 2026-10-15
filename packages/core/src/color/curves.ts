import type { CurvePoint, CurvesParams } from '../model/layers.ts'
import { clamp } from '../util.ts'

/**
 * Monotone cubic (Fritsch–Carlson) interpolation through curve points, so
 * dragging a point never makes the curve overshoot and invert tones.
 */
export function curveEvaluator(input: CurvePoint[]): (x: number) => number {
  const pts = [...input].sort((a, b) => a.x - b.x)
  if (pts.length === 0) return (x) => x
  if (pts.length === 1) {
    const y = pts[0]?.y ?? 0
    return () => y
  }
  const n = pts.length
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1] as number) - (xs[i] as number)
    d.push(dx > 1e-9 ? ((ys[i + 1] as number) - (ys[i] as number)) / dx : 0)
  }
  const m: number[] = new Array(n).fill(0)
  m[0] = d[0] ?? 0
  m[n - 1] = d[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) {
    const a = d[i - 1] as number
    const b = d[i] as number
    m[i] = a * b <= 0 ? 0 : (a + b) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    const di = d[i] as number
    if (Math.abs(di) < 1e-9) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = (m[i] as number) / di
    const b = (m[i + 1] as number) / di
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * di
      m[i + 1] = t * b * di
    }
  }
  return (x: number) => {
    if (x <= (xs[0] as number)) return ys[0] as number
    if (x >= (xs[n - 1] as number)) return ys[n - 1] as number
    let i = 0
    while (i < n - 2 && x > (xs[i + 1] as number)) i++
    const x0 = xs[i] as number
    const h = (xs[i + 1] as number) - x0
    const t = (x - x0) / h
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * (ys[i] as number) +
      (t3 - 2 * t2 + t) * h * (m[i] as number) +
      (-2 * t3 + 3 * t2) * (ys[i + 1] as number) +
      (t3 - t2) * h * (m[i + 1] as number)
    )
  }
}

export const CURVE_TABLE_SIZE = 256

/**
 * Bakes curves into an RGBA float table (size × 4): each channel's curve is
 * composed with the master curve. Alpha is unused (1).
 */
export function curvesTable(params: CurvesParams, size = CURVE_TABLE_SIZE): Float32Array {
  const master = curveEvaluator(params.master)
  const channels = [params.red, params.green, params.blue].map(curveEvaluator)
  const out = new Float32Array(size * 4)
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1)
    const mv = clamp(master(x))
    for (let c = 0; c < 3; c++) out[i * 4 + c] = clamp((channels[c] as (x: number) => number)(mv))
    out[i * 4 + 3] = 1
  }
  return out
}

/** Linear lookup into one channel of a curves table. */
export function lookupCurve(table: Float32Array, channel: number, v: number): number {
  const size = table.length / 4
  const f = clamp(v) * (size - 1)
  const i = Math.min(Math.floor(f), size - 2)
  const t = f - i
  const a = table[i * 4 + channel] as number
  const b = table[(i + 1) * 4 + channel] as number
  return a + (b - a) * t
}
