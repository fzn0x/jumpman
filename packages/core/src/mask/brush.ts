/**
 * Brush masks: painted strokes rasterized into a coverage map.
 *
 * Each stroke is a round brush swept along its polyline: a pixel's stroke
 * coverage is `flow` times the feathered falloff of its distance to the
 * path (exact, so dab spacing never shows). Strokes then composite in
 * order: paint `m + s * (1 - m)`, erase `m * (1 - s)`, so low-flow strokes
 * build up.
 */
import type { BrushMask, BrushStroke } from '../model/layers.ts'
import type { MaskRaster } from './raster.ts'

/** Validation limits for untrusted brush masks and the painting UI. */
export const BRUSH_LIMITS = {
  /** Strokes per mask. */
  maxStrokes: 256,
  /** x,y pairs per mask, across all strokes. */
  maxPoints: 16_384,
  /** Brush radius as a fraction of the photo's shorter side. */
  minSize: 0.002,
  maxSize: 0.5,
  minFlow: 0.01,
} as const

/** Stored coordinates and settings keep 4 decimals (1/10000 of the photo). */
export function quantizeBrushValue(v: number): number {
  return Math.round(v * 10_000) / 10_000
}

/** Number of x,y pairs across all strokes. */
export function brushPointCount(mask: Pick<BrushMask, 'strokes'>): number {
  let n = 0
  for (const s of mask.strokes) n += s.points.length >> 1
  return n
}

/** Inner (fully covered) and outer radius of a stroke in raster pixels. */
function radii(stroke: BrushStroke, w: number, h: number): [number, number] {
  const r = Math.max(0, stroke.size) * Math.min(w, h)
  const inner = r * (1 - Math.min(1, Math.max(0, stroke.feather)))
  // Hard brushes still get one pixel of antialiasing.
  return r - inner < 1 ? [Math.max(0, r - 0.5), r + 0.5] : [inner, r]
}

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

const emptyBox = (): Box => ({
  x0: Number.POSITIVE_INFINITY,
  y0: Number.POSITIVE_INFINITY,
  x1: -1,
  y1: -1,
})

/** Max-stamps the capsule a..b (in pixels) into the stroke buffer. */
function stampSegment(
  s: Float32Array,
  w: number,
  h: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  inner: number,
  outer: number,
  flow: number,
  box: Box,
) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - outer))
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + outer))
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - outer))
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + outer))
  if (x0 > x1 || y0 > y1 || flow <= 0) return
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const o2 = outer * outer
  const i2 = inner * inner
  const span = outer - inner
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5 - ay
    const row = y * w
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - ax
      let t = len2 > 0 ? (px * dx + py * dy) / len2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const ex = px - t * dx
      const ey = py - t * dy
      const d2 = ex * ex + ey * ey
      if (d2 >= o2) continue
      let a = flow
      if (d2 > i2) {
        const k = (outer - Math.sqrt(d2)) / span
        a = k * k * (3 - 2 * k) * flow
      }
      const i = row + x
      if (a > (s[i] as number)) s[i] = a
    }
  }
  if (x0 < box.x0) box.x0 = x0
  if (y0 < box.y0) box.y0 = y0
  if (x1 > box.x1) box.x1 = x1
  if (y1 > box.y1) box.y1 = y1
}

/**
 * Stamps a stroke's path from pair `from` on. Pair 0 is always stamped as a
 * dot first so a stroke rasterized in one go or while it grows gives the
 * exact same buffer.
 */
function stampStroke(
  s: Float32Array,
  w: number,
  h: number,
  stroke: BrushStroke,
  from: number,
  box: Box,
) {
  const p = stroke.points
  const n = p.length >> 1
  if (!n) return
  const [inner, outer] = radii(stroke, w, h)
  const flow = Math.min(1, Math.max(0, stroke.flow))
  const X = (k: number) => (p[k * 2] as number) * w
  const Y = (k: number) => (p[k * 2 + 1] as number) * h
  if (from <= 0) stampSegment(s, w, h, X(0), Y(0), X(0), Y(0), inner, outer, flow, box)
  for (let k = Math.max(1, from); k < n; k++)
    stampSegment(s, w, h, X(k - 1), Y(k - 1), X(k), Y(k), inner, outer, flow, box)
}

/** Writes `cover = f(base, stroke)` and its bytes inside the box. */
function composite(
  cover: Float32Array,
  base: Float32Array,
  s: Float32Array,
  bytes: Uint8Array | null,
  w: number,
  erase: boolean,
  box: Box,
) {
  for (let y = box.y0; y <= box.y1; y++) {
    for (let i = y * w + box.x0, end = y * w + box.x1; i <= end; i++) {
      const m = base[i] as number
      const k = s[i] as number
      const v = erase ? m * (1 - k) : m + k * (1 - m)
      cover[i] = v
      if (bytes) bytes[i] = (v * 255 + 0.5) | 0
    }
  }
}

function writeBytes(cover: Float32Array, out: Uint8Array): Uint8Array {
  for (let i = 0; i < cover.length; i++) out[i] = ((cover[i] as number) * 255 + 0.5) | 0
  return out
}

/**
 * Rasterizes a brush mask's coverage (before `invert`) at `width` x `height`,
 * which should have the photo's aspect ratio. Pure: same input, same bytes.
 */
export function rasterizeBrushMask(
  mask: Pick<BrushMask, 'strokes'>,
  width: number,
  height: number,
): Uint8Array {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const cover = new Float32Array(w * h)
  const s = new Float32Array(w * h)
  for (const stroke of mask.strokes) {
    const box = emptyBox()
    stampStroke(s, w, h, stroke, 0, box)
    if (box.x1 < 0) continue
    composite(cover, cover, s, null, w, stroke.mode === 'erase', box)
    for (let y = box.y0; y <= box.y1; y++) s.fill(0, y * w + box.x0, y * w + box.x1 + 1)
  }
  return writeBytes(cover, new Uint8Array(w * h))
}

function sameSettings(a: BrushStroke, b: BrushStroke): boolean {
  return a.mode === b.mode && a.size === b.size && a.feather === b.feather && a.flow === b.flow
}

function samePoints(a: number[], b: number[], count: number): boolean {
  if (a === b) return true
  if (a.length < count || b.length < count) return false
  for (let i = 0; i < count; i++) if (a[i] !== b[i]) return false
  return true
}

function sameStroke(a: BrushStroke, b: BrushStroke): boolean {
  return (
    a === b ||
    (sameSettings(a, b) &&
      a.points.length === b.points.length &&
      samePoints(a.points, b.points, a.points.length))
  )
}

function samePrefix(a: BrushStroke[], b: BrushStroke[], count: number): boolean {
  for (let i = 0; i < count; i++)
    if (!sameStroke(a[i] as BrushStroke, b[i] as BrushStroke)) return false
  return true
}

/**
 * Working buffers of one size. Remembers the last rasterized stroke list so
 * a stroke that grows (live painting) or a new stroke on top only stamps the
 * new segments instead of the whole mask.
 */
class BrushCanvas {
  readonly w: number
  readonly h: number
  readonly cover: Float32Array
  readonly base: Float32Array
  readonly stroke: Float32Array
  readonly bytes: Uint8Array
  private strokes: BrushStroke[] = []
  /** Pairs of the last stroke already stamped. */
  private done = 0

  constructor(w: number, h: number) {
    this.w = w
    this.h = h
    this.cover = new Float32Array(w * h)
    this.base = new Float32Array(w * h)
    this.stroke = new Float32Array(w * h)
    this.bytes = new Uint8Array(w * h)
  }

  update(strokes: BrushStroke[]): void {
    const prev = this.strokes
    const n = prev.length
    const last = strokes[strokes.length - 1]
    const prevLast = prev[n - 1]
    if (
      last &&
      prevLast &&
      strokes.length === n &&
      sameSettings(prevLast, last) &&
      samePoints(prevLast.points, last.points, this.done * 2) &&
      samePrefix(prev, strokes, n - 1)
    ) {
      this.grow(last)
    } else if (last && strokes.length === n + 1 && samePrefix(prev, strokes, n)) {
      this.begin(last)
    } else {
      this.full(strokes)
    }
    this.strokes = strokes.slice()
  }

  private grow(last: BrushStroke) {
    const box = emptyBox()
    stampStroke(this.stroke, this.w, this.h, last, this.done, box)
    this.done = last.points.length >> 1
    if (box.x1 >= 0)
      composite(this.cover, this.base, this.stroke, this.bytes, this.w, last.mode === 'erase', box)
  }

  private begin(last: BrushStroke) {
    this.base.set(this.cover)
    this.stroke.fill(0)
    this.done = 0
    this.grow(last)
  }

  private full(strokes: BrushStroke[]) {
    const { w, h } = this
    this.cover.fill(0)
    this.stroke.fill(0)
    for (let i = 0; i < strokes.length - 1; i++) {
      const stroke = strokes[i] as BrushStroke
      const box = emptyBox()
      stampStroke(this.stroke, w, h, stroke, 0, box)
      if (box.x1 < 0) continue
      composite(this.cover, this.cover, this.stroke, null, w, stroke.mode === 'erase', box)
      for (let y = box.y0; y <= box.y1; y++) this.stroke.fill(0, y * w + box.x0, y * w + box.x1 + 1)
    }
    const last = strokes[strokes.length - 1]
    this.base.set(this.cover)
    this.done = 0
    if (last) this.grow(last)
    writeBytes(this.cover, this.bytes)
  }
}

/* Content keys: two 32-bit murmur-style hashes over every value's bits. */
const f64 = new Float64Array(1)
const u32 = new Uint32Array(f64.buffer)

function mix(h: number, k: number): number {
  let x = Math.imul(k, 0xcc9e2d51)
  x = (x << 15) | (x >>> 17)
  x = Math.imul(x, 0x1b873593)
  const y = h ^ x
  return (Math.imul((y << 13) | (y >>> 19), 5) + 0xe6546b64) | 0
}

function finish(h: number, n: number): number {
  let x = h ^ n
  x ^= x >>> 16
  x = Math.imul(x, 0x85ebca6b)
  x ^= x >>> 13
  x = Math.imul(x, 0xc2b2ae35)
  x ^= x >>> 16
  return x >>> 0
}

/** Content key of a brush raster: stroke data and raster size. */
export function brushMaskKey(strokes: BrushStroke[], width: number, height: number): string {
  let a = 0x2f6b9d1
  let b = 0x51ed27a3
  let n = 0
  const add = (v: number) => {
    f64[0] = v
    const lo = u32[0] as number
    const hi = u32[1] as number
    a = mix(mix(a, lo), hi)
    b = mix(mix(b, hi), lo)
    n++
  }
  for (const s of strokes) {
    add(s.mode === 'erase' ? 1 : 0)
    add(s.size)
    add(s.feather)
    add(s.flow)
    add(s.points.length)
    for (const p of s.points) add(p)
  }
  return `brush:${width}x${height}:${finish(a, n).toString(36)}${finish(b, n).toString(36)}`
}

const CACHE_LIMIT = 8
const LIVE_LIMIT = 2
const cache = new Map<string, MaskRaster>()
const live = new Map<string, BrushCanvas>()
const byMask = new WeakMap<BrushMask, MaskRaster>()

function liveCanvas(w: number, h: number): BrushCanvas {
  const id = `${w}x${h}`
  let c = live.get(id)
  if (c) {
    live.delete(id)
  } else {
    c = new BrushCanvas(w, h)
    while (live.size >= LIVE_LIMIT) live.delete(live.keys().next().value as string)
  }
  live.set(id, c)
  return c
}

/**
 * The cached raster of a brush mask. Unchanged masks are a lookup; a mask
 * that extends the last one rasterized at this size (a stroke being painted)
 * only stamps its new segments.
 */
export function brushMaskRaster(mask: BrushMask, width: number, height: number): MaskRaster {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const fast = byMask.get(mask)
  if (fast && fast.width === w && fast.height === h) return fast
  const key = brushMaskKey(mask.strokes, w, h)
  let r = cache.get(key)
  if (r) {
    cache.delete(key)
  } else {
    const c = liveCanvas(w, h)
    c.update(mask.strokes)
    r = { width: w, height: h, data: c.bytes.slice(), key }
    while (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  }
  cache.set(key, r)
  byMask.set(mask, r)
  return r
}

/** Drops cached brush rasters and working buffers (tests, memory pressure). */
export function clearBrushCache(): void {
  cache.clear()
  live.clear()
}
