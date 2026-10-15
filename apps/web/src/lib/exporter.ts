import { fitSize, formatFilename, layersToXmp, stripExtension } from '@jumpman/core'
import { GLRenderer } from '@jumpman/renderer'
import { zip } from 'fflate'
import { activeBranch, useLibrary } from '../state/library.ts'
import { layersFor } from '../state/selectors.ts'
import { frameOf } from './geometry.ts'
import { makeCanvas } from './image.ts'
import { resolveLut } from './luts.ts'
import { sourceBitmap } from './media.ts'
import type { Batch, Settings } from './types.ts'

export interface ExportOptions {
  format: Settings['exportFormat']
  quality: number
  /** Longest edge in pixels; 0 keeps the full resolution. */
  maxEdge: number
  pattern: string
  watermark: string
  watermarkPosition: Settings['watermarkPosition']
  watermarkOpacity: number
  includeXmp: boolean
  /** Overrides the batch aspect ratio (platform exports). */
  aspect?: string
}

export interface ExportedFile {
  name: string
  blob: Blob
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

let renderer: GLRenderer | null = null
function getRenderer(): GLRenderer {
  if (!renderer || renderer.isLost) renderer = new GLRenderer(new OffscreenCanvas(1, 1))
  return renderer
}

/** Encoders differ per browser; AVIF/WebP fall back to JPEG when unavailable. */
export async function supportedFormats(): Promise<Settings['exportFormat'][]> {
  const c = makeCanvas(2, 2)
  c.getContext('2d')?.fillRect(0, 0, 2, 2)
  const out: Settings['exportFormat'][] = ['image/jpeg', 'image/png']
  for (const type of ['image/webp', 'image/avif'] as const) {
    try {
      const b = await c.convertToBlob({ type })
      if (b.type === type) out.push(type)
    } catch {
      // unsupported
    }
  }
  return out
}

function drawWatermark(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  opts: ExportOptions,
) {
  const text = opts.watermark.trim()
  if (!text) return
  const size = Math.max(12, Math.round(Math.min(w, h) * 0.032))
  const pad = Math.round(size * 1.1)
  ctx.font = `600 ${size}px "Inter Variable", system-ui, sans-serif`
  ctx.globalAlpha = opts.watermarkOpacity
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = size * 0.4
  const metrics = ctx.measureText(text)
  let x = w - pad - metrics.width
  let y = h - pad
  switch (opts.watermarkPosition) {
    case 'bottom-left':
      x = pad
      break
    case 'bottom-center':
      x = (w - metrics.width) / 2
      break
    case 'top-right':
      y = pad + size
      break
    case 'center':
      x = (w - metrics.width) / 2
      y = h / 2 + size / 3
      break
  }
  ctx.fillText(text, x, y)
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
}

/** Renders photos at full quality and encodes them. */
export async function exportBatch(
  batch: Batch,
  photoIds: string[],
  opts: ExportOptions,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ExportedFile[]> {
  const { photos, collections } = useLibrary.getState()
  const branch = activeBranch(batch)
  const global = opts.aspect ? { ...branch.global, aspect: opts.aspect } : branch.global
  const collection = collections[batch.collectionId]
  const r = getRenderer()
  const limit = Math.min(r.info.maxTextureSize, 16384)
  const files: ExportedFile[] = []
  const used = new Set<string>()
  let i = 0
  for (const id of photoIds) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError')
    const photo = photos[id]
    if (!photo) continue
    i++
    onProgress?.(i - 1, photoIds.length)
    const frame = frameOf(photo, global, branch.photos[id])
    const src = await sourceBitmap(photo, limit)
    // The decoded source can be smaller than the original (GPU texture limit).
    const scale = Math.min(1, src.width / photo.width)
    const { w, h } = fitSize(frame.width * scale, frame.height * scale, opts.maxEdge || limit)
    r.setImage(src, `export:${id}`)
    const layers = layersFor(batch, photos, id)
    const ok = r.render({
      layers,
      luts: resolveLut,
      width: w,
      height: h,
      rect: frame.rect,
      rotate: frame.rotate,
      flipH: frame.flipH,
      ...(photo.stats ? { subject: photo.stats.subject } : {}),
    })
    src.close()
    if (!ok) throw new Error('The GPU context was lost during export. Try a smaller size.')
    const out = makeCanvas(w, h)
    const ctx = out.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    ctx.drawImage(r.canvas as OffscreenCanvas, 0, 0)
    drawWatermark(ctx, w, h, opts)
    let blob = await out.convertToBlob({ type: opts.format, quality: opts.quality })
    if (blob.type !== opts.format)
      blob = await out.convertToBlob({ type: 'image/jpeg', quality: opts.quality })
    const base = formatFilename(opts.pattern || '{name}', {
      name: stripExtension(photo.name),
      index: i,
      ...(collection ? { collection: collection.name } : {}),
      branch: branch.name,
      ...(photo.takenAt !== undefined ? { takenAt: photo.takenAt } : {}),
      width: w,
      height: h,
    })
    let unique = base
    for (let n = 2; used.has(unique.toLowerCase()); n++) unique = `${base}-${n}`
    used.add(unique.toLowerCase())
    files.push({ name: `${unique}.${EXT[blob.type] ?? 'jpg'}`, blob })
    if (opts.includeXmp) {
      const { xml } = layersToXmp(layers, { creatorTool: 'Jumpman' })
      files.push({ name: `${unique}.xmp`, blob: new Blob([xml], { type: 'application/rdf+xml' }) })
    }
    // Let the UI breathe between photos.
    await new Promise((res) => setTimeout(res, 0))
  }
  onProgress?.(photoIds.length, photoIds.length)
  return files
}

/** Packs files into a ZIP (images are stored, not recompressed). */
export function zipFiles(files: ExportedFile[]): Promise<Blob> {
  return Promise.all(
    files.map(async (f) => [f.name, new Uint8Array(await f.blob.arrayBuffer())] as const),
  ).then(
    (entries) =>
      new Promise<Blob>((resolve, reject) => {
        const input: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
        for (const [name, data] of entries)
          input[name] = [data, { level: name.endsWith('.xmp') ? 6 : 0 }]
        zip(input, (err, out) =>
          err ? reject(err) : resolve(new Blob([out.slice()], { type: 'application/zip' })),
        )
      }),
  )
}
