import { computeStats, extractRawPreview, isRawFileName, type PhotoStats } from '@jumpman/core'
import exifr from 'exifr'
import { canvasToBlob, decodeBlob, imageDataOf, resizeTo } from './image.ts'
import { decodeRawFile } from './rawDecode.ts'
import type { RawDecoder } from './types.ts'

export interface ImportResult {
  name: string
  type: string
  size: number
  width: number
  height: number
  takenAt: number
  raw?: { format: string; orientation: number }
  stats: PhotoStats
  source: Blob
  preview: Blob
  thumb: Blob
}

export interface ImportOptions {
  rawDecoder: RawDecoder
}

export const PREVIEW_EDGE = 2560
export const THUMB_EDGE = 480
/** JPEG quality for the stored full-size LibRaw decode. */
const RAW_SOURCE_QUALITY = 0.95

async function readTakenAt(input: File | Uint8Array): Promise<number | undefined> {
  try {
    const exif = await exifr.parse(input, ['DateTimeOriginal', 'CreateDate'])
    const d = (exif?.DateTimeOriginal ?? exif?.CreateDate) as Date | undefined
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : undefined
  } catch {
    return undefined
  }
}

/** Frees a full-size image without waiting for garbage collection. */
function release(image: ImageBitmap | OffscreenCanvas): void {
  if (image instanceof ImageBitmap) image.close()
  else {
    image.width = 0
    image.height = 0
  }
}

/** Builds the import result from a decoded, upright image, then releases the image. */
async function finish(
  file: File,
  image: ImageBitmap | OffscreenCanvas,
  source: Blob,
  takenAt: number | undefined,
  raw?: ImportResult['raw'],
): Promise<ImportResult> {
  const { width, height } = image
  let previewCanvas: OffscreenCanvas
  try {
    previewCanvas = resizeTo(image, PREVIEW_EDGE)
  } finally {
    release(image)
  }
  const thumbCanvas = resizeTo(previewCanvas, THUMB_EDGE)
  const statsCanvas = resizeTo(thumbCanvas, 256)
  const stats = computeStats(imageDataOf(statsCanvas))
  return {
    name: file.name,
    type: raw ? 'image/jpeg' : file.type || 'image/jpeg',
    size: file.size,
    width,
    height,
    takenAt: takenAt ?? file.lastModified,
    ...(raw ? { raw } : {}),
    stats,
    source,
    preview: await canvasToBlob(previewCanvas, 'image/jpeg', 0.9),
    thumb: await canvasToBlob(thumbCanvas, 'image/jpeg', 0.82),
  }
}

/**
 * Opens a camera RAW file. With LibRaw the stored source is the full sensor
 * decode, already upright; when LibRaw is off or fails, the embedded preview
 * is used as before.
 */
async function processRaw(file: File, decoder: RawDecoder): Promise<ImportResult> {
  let bytes = new Uint8Array(await file.arrayBuffer())
  const format = file.name.split('.').pop()?.toUpperCase() ?? 'RAW'
  const takenAt = await readTakenAt(bytes)
  let failed = false
  if (decoder === 'libraw') {
    try {
      // LibRaw takes ownership of the buffer; it is read again only on failure.
      const image = await decodeRawFile(bytes)
      const source = await canvasToBlob(image, 'image/jpeg', RAW_SOURCE_QUALITY)
      return await finish(file, image, source, takenAt, { format, orientation: 1 })
    } catch (err) {
      failed = true
      console.warn(`LibRaw could not decode ${file.name}, trying its preview:`, err)
      bytes = new Uint8Array(await file.arrayBuffer())
    }
  }
  const preview = extractRawPreview(bytes)
  if (!preview) {
    throw new Error(
      failed
        ? 'LibRaw could not decode this RAW file and it has no embedded preview.'
        : 'This RAW file has no embedded preview we can read yet.',
    )
  }
  const source = new Blob([preview.jpeg.slice()], { type: 'image/jpeg' })
  const bmp = await decodeBlob(source, preview.orientation)
  return finish(file, bmp, source, takenAt, { format, orientation: preview.orientation })
}

async function processFile(file: File, options: ImportOptions): Promise<ImportResult> {
  if (isRawFileName(file.name)) return processRaw(file, options.rawDecoder)
  const takenAt = await readTakenAt(file)
  return finish(file, await decodeBlob(file), file, takenAt)
}

/** Stats for an arbitrary image (e.g. a sample image for "edit from sample"). */
async function analyzeFile(file: File): Promise<PhotoStats> {
  const bmp = await decodeBlob(file)
  const stats = computeStats(imageDataOf(resizeTo(bmp, 256)))
  bmp.close()
  return stats
}

type Request = { id: number; kind: 'import' | 'analyze'; file: File; options: ImportOptions }

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null
  postMessage(message: unknown): void
}

scope.onmessage = async (e: MessageEvent<Request>) => {
  const { id, kind, file, options } = e.data
  try {
    const result = kind === 'import' ? await processFile(file, options) : await analyzeFile(file)
    scope.postMessage({ id, ok: true, result })
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
