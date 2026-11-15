/**
 * Raster masks: per-photo coverage maps sampled in source-photo space
 * (before crop, rotation and flip). Brush masks rasterize into one; other
 * producers (e.g. on-device segmentation) can supply their own through a
 * `MaskRasterResolver`. The CPU pipeline and the WebGL renderer sample them
 * the same way: bilinear, clamped to the edge.
 */
import type { Mask } from '../model/layers.ts'
import { brushMaskRaster } from './brush.ts'

/**
 * Long edge of rasterized masks in pixels. Painted masks are soft, so 1024
 * keeps live painting and undo fast on phones while an export samples the
 * mask with linear filtering. Every WebGL2 device supports this size.
 */
export const MASK_RASTER_MAX_EDGE = 1024

/** Single-channel coverage in source-photo space. */
export interface MaskRaster {
  width: number
  height: number
  /** Coverage 0..255, row-major, top row first. Treat as immutable. */
  data: Uint8Array
  /** Content key: equal keys mean equal pixels. Renderers cache uploads by it. */
  key: string
}

export interface SourceSize {
  width: number
  height: number
}

/**
 * Supplies the raster for a mask on a photo of `source` size. Return nothing
 * to fall back to the built-in behavior (rasterized brush, analytic others).
 */
export type MaskRasterResolver = (mask: Mask, source: SourceSize) => MaskRaster | null | undefined

/** Zero coverage, used when a mask that needs a raster has none. */
export const EMPTY_MASK_RASTER: MaskRaster = {
  width: 1,
  height: 1,
  data: new Uint8Array(1),
  key: 'empty',
}

/** Raster size for a photo: its aspect ratio, long edge capped at `maxEdge`. */
export function maskRasterSize(
  width: number,
  height: number,
  maxEdge = MASK_RASTER_MAX_EDGE,
): SourceSize {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const s = Math.min(1, maxEdge / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

/** True for masks that only exist as a raster (no analytic formula). */
export function needsRaster(mask: Mask): boolean {
  return mask.type === 'brush'
}

/** The built-in rasters: brush masks, rasterized and cached by content. */
export function defaultMaskRaster(mask: Mask, source: SourceSize): MaskRaster | null {
  if (mask.type !== 'brush') return null
  const size = maskRasterSize(source.width, source.height)
  return brushMaskRaster(mask, size.width, size.height)
}

/**
 * The raster a renderer should sample for a mask, or null to evaluate the
 * analytic mask. A custom resolver wins over the built-in one.
 */
export function resolveMaskRaster(
  mask: Mask,
  source: SourceSize,
  resolver?: MaskRasterResolver,
): MaskRaster | null {
  const r = resolver?.(mask, source) ?? defaultMaskRaster(mask, source)
  return r ?? (needsRaster(mask) ? EMPTY_MASK_RASTER : null)
}

/**
 * Coverage (0..1) at a source position (0..1, y down). Bilinear with
 * clamp-to-edge and texel centers at +0.5, like GPU linear filtering.
 */
export function sampleMaskRaster(r: MaskRaster, x: number, y: number): number {
  const { width: w, height: h, data } = r
  const fx = x * w - 0.5
  const fy = y * h - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const cx0 = x0 < 0 ? 0 : x0 >= w ? w - 1 : x0
  const cx1 = x0 + 1 < 0 ? 0 : x0 + 1 >= w ? w - 1 : x0 + 1
  const cy0 = y0 < 0 ? 0 : y0 >= h ? h - 1 : y0
  const cy1 = y0 + 1 < 0 ? 0 : y0 + 1 >= h ? h - 1 : y0 + 1
  const a = data[cy0 * w + cx0] as number
  const b = data[cy0 * w + cx1] as number
  const c = data[cy1 * w + cx0] as number
  const d = data[cy1 * w + cx1] as number
  const top = a + (b - a) * tx
  const bottom = c + (d - c) * tx
  return (top + (bottom - top) * ty) / 255
}
