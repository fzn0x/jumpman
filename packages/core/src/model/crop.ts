export interface AspectRatio {
  id: string
  label: string
  /** width / height, or null to keep the photo's own ratio. */
  ratio: number | null
  /** Where this ratio is commonly used, shown as a hint. */
  hint?: string
}

export const ASPECT_RATIOS: readonly AspectRatio[] = [
  { id: 'original', label: 'Original', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1, hint: 'Square post' },
  { id: '4:5', label: '4:5', ratio: 4 / 5, hint: 'Instagram portrait' },
  { id: '3:4', label: '3:4', ratio: 3 / 4, hint: 'Instagram grid' },
  { id: '9:16', label: '9:16', ratio: 9 / 16, hint: 'Stories, Reels, TikTok' },
  { id: '2:3', label: '2:3', ratio: 2 / 3, hint: 'Print 4x6 portrait' },
  { id: '3:2', label: '3:2', ratio: 3 / 2, hint: 'Print 6x4' },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '16:9', label: '16:9', ratio: 16 / 9, hint: 'Widescreen, YouTube' },
  { id: '1.91:1', label: '1.91:1', ratio: 1.91, hint: 'Link preview' },
]

export type AspectId = string

export function aspectRatioOf(id: AspectId): number | null {
  return ASPECT_RATIOS.find((a) => a.id === id)?.ratio ?? null
}

/** Per-photo placement of the crop window. */
export interface CropPlacement {
  /** Center of the crop window, 0..1 of the (rotated) image. */
  cx: number
  cy: number
  /** >= 1; 1 means the largest window of the target ratio that fits. */
  zoom: number
  /** Quarter turns clockwise, 0..3. */
  rotate: number
  flipH: boolean
}

export function defaultPlacement(): CropPlacement {
  return { cx: 0.5, cy: 0.5, zoom: 1, rotate: 0, flipH: false }
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Image dimensions after applying quarter-turn rotation. */
export function rotatedSize(w: number, h: number, rotate: number): { w: number; h: number } {
  return rotate % 2 === 0 ? { w, h } : { w: h, h: w }
}

/**
 * Computes the crop window (in rotated-image pixels) for a ratio and placement.
 * The window is always fully inside the image.
 */
export function cropRect(
  imgW: number,
  imgH: number,
  ratio: number | null,
  placement: Partial<CropPlacement> = {},
): Rect {
  const p = { ...defaultPlacement(), ...placement }
  const { w: W, h: H } = rotatedSize(imgW, imgH, p.rotate)
  const r = ratio ?? W / H
  let w = W
  let h = W / r
  if (h > H) {
    h = H
    w = H * r
  }
  const zoom = Math.max(1, p.zoom)
  w /= zoom
  h /= zoom
  const x = Math.min(Math.max(p.cx * W - w / 2, 0), W - w)
  const y = Math.min(Math.max(p.cy * H - h / 2, 0), H - h)
  return { x, y, w, h }
}

/** Output size for a crop rect scaled so its long edge is at most `maxEdge`. */
export function fitSize(w: number, h: number, maxEdge?: number): { w: number; h: number } {
  if (!maxEdge || Math.max(w, h) <= maxEdge) return { w: Math.round(w), h: Math.round(h) }
  const s = maxEdge / Math.max(w, h)
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}
