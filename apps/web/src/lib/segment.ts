/**
 * Subject masks from on-device segmentation. Each photo is segmented once,
 * at most one photo at a time, from its preview and the salient center found
 * at import. Masks are kept in memory and in IndexedDB, and renderers pick
 * them up through a mask raster resolver. Until a mask is ready, or when the
 * model cannot run, subject masks fall back to the quick radial estimate.
 */
import type { Layer, MaskRaster, MaskRasterResolver } from '@jumpman/core'
import { create } from 'zustand'
import { toast } from '../state/editor.ts'
import { useLibrary } from '../state/library.ts'
import { blobDb, photoKeys } from './db.ts'
import { previewBitmap } from './media.ts'
import type { SegmentRequest, SegmentResponse } from './segment.worker.ts'
import type { Photo } from './types.ts'

/** MagicTouch works at 512 x 512; a larger input only costs decode time. */
const INPUT_EDGE = 512
/** Masks kept in memory (each at most 512 x 512 bytes). */
const MEMORY_LIMIT = 64

export type SegmentStatus = 'pending' | 'ready' | 'failed'

/** Per-photo status; components re-render when a mask arrives. */
export const useSegments = create<{ status: Record<string, SegmentStatus> }>(() => ({
  status: {},
}))

const rasters = new Map<string, MaskRaster>()
const pending = new Map<string, Promise<MaskRaster | null>>()
/** Set when the model fails before it ever worked: it cannot run on this device. */
let unavailable = false
let worked = false

function setStatus(id: string, status: SegmentStatus) {
  useSegments.setState((s) => ({ status: { ...s.status, [id]: status } }))
}

function remember(id: string, raster: MaskRaster) {
  rasters.delete(id)
  rasters.set(id, raster)
  while (rasters.size > MEMORY_LIMIT) rasters.delete(rasters.keys().next().value as string)
}

export function aiMasksEnabled(): boolean {
  return useLibrary.getState().settings.aiMasks && !unavailable
}

/** True when a visible layer uses a subject mask. */
export function usesSubjectMask(layers: Layer[]): boolean {
  return layers.some((l) => l.enabled && l.opacity > 0 && l.mask?.type === 'subject')
}

/** The ready subject mask of a photo, if any. */
export function subjectRaster(photoId: string): MaskRaster | undefined {
  return aiMasksEnabled() ? rasters.get(photoId) : undefined
}

/** Resolver for renderers: subject masks use the segmentation when it is ready. */
export function subjectResolver(photoId: string): MaskRasterResolver | undefined {
  const raster = subjectRaster(photoId)
  return raster ? (mask) => (mask.type === 'subject' ? raster : undefined) : undefined
}

/* Worker: one at a time, created on first use. */

let worker: Worker | null = null
let nextId = 1
const calls = new Map<number, (r: SegmentResponse) => void>()
let queue: Promise<unknown> = Promise.resolve()

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./segment.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<SegmentResponse>) => {
    calls.get(e.data.id)?.(e.data)
    calls.delete(e.data.id)
  }
  w.onerror = (e) => {
    for (const [id, done] of calls) done({ id, ok: false, error: e.message || 'Worker failed' })
    calls.clear()
    worker = null
  }
  worker = w
  return w
}

function runModel(image: ImageBitmap, point: { x: number; y: number }): Promise<SegmentResponse> {
  const job = queue.then(
    () =>
      new Promise<SegmentResponse>((resolve) => {
        const id = nextId++
        calls.set(id, resolve)
        const request: SegmentRequest = { id, image, point }
        getWorker().postMessage(request, [image])
      }),
  )
  queue = job.catch(() => undefined)
  return job
}

/* Storage: two uint32 (width, height) followed by the coverage bytes. */

function encode(r: MaskRaster): ArrayBuffer {
  const out = new Uint8Array(8 + r.data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, r.width, true)
  view.setUint32(4, r.height, true)
  out.set(r.data, 8)
  return out.buffer
}

function decode(buf: ArrayBuffer, key: string): MaskRaster | null {
  if (buf.byteLength < 8) return null
  const view = new DataView(buf)
  const width = view.getUint32(0, true)
  const height = view.getUint32(4, true)
  if (!width || !height || buf.byteLength !== 8 + width * height) return null
  return { width, height, data: new Uint8Array(buf, 8), key }
}

async function compute(photo: Photo, key: string): Promise<MaskRaster> {
  const preview = await previewBitmap(photo)
  if (!preview) throw new Error(`No preview for ${photo.name}`)
  const s = Math.min(1, INPUT_EDGE / Math.max(preview.width, preview.height))
  const image = await createImageBitmap(preview, {
    resizeWidth: Math.max(1, Math.round(preview.width * s)),
    resizeHeight: Math.max(1, Math.round(preview.height * s)),
    resizeQuality: 'medium',
  })
  const res = await runModel(image, photo.stats?.subject ?? { x: 0.5, y: 0.5 })
  if (!res.ok) throw new Error(res.error)
  return { width: res.width, height: res.height, data: res.data, key }
}

/**
 * Loads or computes the subject mask of a photo. Resolves to null when AI
 * masks are off or the model cannot run; callers then keep the quick estimate.
 */
export function ensureSubjectMask(photo: Photo): Promise<MaskRaster | null> {
  if (!aiMasksEnabled()) return Promise.resolve(null)
  const hit = rasters.get(photo.id)
  if (hit) return Promise.resolve(hit)
  const running = pending.get(photo.id)
  if (running) return running
  const key = photoKeys.subjectMask(photo.id)
  const job = (async () => {
    setStatus(photo.id, 'pending')
    try {
      const stored = await blobDb.getBuffer(key)
      let raster = stored ? decode(stored, key) : null
      if (!raster) {
        raster = await compute(photo, key)
        await blobDb.set(key, encode(raster))
      }
      worked = true
      remember(photo.id, raster)
      setStatus(photo.id, 'ready')
      return raster
    } catch (err) {
      console.warn(`Subject segmentation failed for ${photo.name}:`, err)
      setStatus(photo.id, 'failed')
      if (!worked && !unavailable) {
        unavailable = true
        toast(
          'On-device subject detection is unavailable here, so subject masks use the quick estimate.',
        )
      }
      return null
    } finally {
      pending.delete(photo.id)
    }
  })()
  pending.set(photo.id, job)
  return job
}
