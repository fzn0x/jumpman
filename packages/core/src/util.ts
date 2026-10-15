/** Deep clone for plain JSON data (edit state is always JSON-serializable). */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function clamp(v: number, lo = 0, hi = 1): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}

export function mean(xs: readonly number[]): number {
  if (!xs.length) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

export function stddev(xs: readonly number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (const x of xs) s += (x - m) * (x - m)
  return Math.sqrt(s / xs.length)
}

export function round(v: number, decimals = 2): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}
