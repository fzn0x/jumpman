import { computeStats, extractRawPreview, isRawFileName, type PhotoStats } from '@jumpman/core'
import exifr from 'exifr'
import { canvasToBlob, decodeBlob, imageDataOf, resizeTo } from './image.ts'

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

export const PREVIEW_EDGE = 2560
export const THUMB_EDGE = 480

async function readTakenAt(input: File | Uint8Array): Promise<number | undefined> {
  try {
    const exif = await exifr.parse(input, ['DateTimeOriginal', 'CreateDate'])
    const d = (exif?.DateTimeOriginal ?? exif?.CreateDate) as Date | undefined
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : undefined
  } catch {
    return undefined
  }
}

async function processFile(file: File): Promise<ImportResult> {
  let source: Blob = file
  let raw: ImportResult['raw']
  let takenAt: number | undefined
  if (isRawFileName(file.name)) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const preview = extractRawPreview(bytes)
    if (!preview) throw new Error('This RAW file has no embedded preview we can read yet.')
    source = new Blob([preview.jpeg.slice()], { type: 'image/jpeg' })
    raw = {
      format: file.name.split('.').pop()?.toUpperCase() ?? 'RAW',
      orientation: preview.orientation,
    }
    takenAt = await readTakenAt(bytes)
  } else {
    takenAt = await readTakenAt(file)
  }
  const bmp = await decodeBlob(source, raw?.orientation)
  const width = bmp.width
  const height = bmp.height
  const previewCanvas = resizeTo(bmp, PREVIEW_EDGE)
  const thumbCanvas = resizeTo(previewCanvas, THUMB_EDGE)
  const statsCanvas = resizeTo(thumbCanvas, 256)
  const stats = computeStats(imageDataOf(statsCanvas))
  bmp.close()
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

/** Stats for an arbitrary image (e.g. a sample image for "edit from sample"). */
async function analyzeFile(file: File): Promise<PhotoStats> {
  const bmp = await decodeBlob(file)
  const stats = computeStats(imageDataOf(resizeTo(bmp, 256)))
  bmp.close()
  return stats
}

type Request = { id: number; kind: 'import' | 'analyze'; file: File }

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null
  postMessage(message: unknown): void
}

scope.onmessage = async (e: MessageEvent<Request>) => {
  const { id, kind, file } = e.data
  try {
    const result = kind === 'import' ? await processFile(file) : await analyzeFile(file)
    scope.postMessage({ id, ok: true, result })
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
