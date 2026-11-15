/**
 * Sky and subject masks from on-device segmentation. Each photo is segmented
 * once per kind, one job at a time, from its preview (and, for the subject,
 * the salient center found at import). Masks are kept in memory and in
 * IndexedDB, and renderers pick them up through a mask raster resolver. Until
 * a mask is ready, or when a model cannot run, the mask falls back to its
 * quick estimate.
 */
import type { Layer, MaskRaster, MaskRasterResolver } from '@jumpman/core'
import { create } from 'zustand'
import { toast } from '../state/editor.ts'
import { useLibrary } from '../state/library.ts'
import { blobDb, photoKeys } from './db.ts'
import { previewBitmap } from './media.ts'
import type { SegmentKind, SegmentRequest, SegmentResponse } from './segment.worker.ts'
import type { Photo } from './types.ts'

export type { SegmentKind }

/** Both models work at about 512 px; a larger input only costs decode time. */
const INPUT_EDGE = 512
/** Masks kept in memory (each at most 512 x 512 bytes). */
const MEMORY_LIMIT = 96

const KINDS: SegmentKind[] = ['subject', 'sky']
const STORAGE_KEY: Record<SegmentKind, (photoId: string) => string> = {
  subject: photoKeys.subjectMask,
  sky: photoKeys.skyMask,
}

export type SegmentStatus = 'pending' | 'ready' | 'failed'

/** Status per `${kind}:${photoId}`; components re-render when a mask arrives. */
export const useSegments = create<{ status: Record<string, SegmentStatus> }>(() => ({
  status: {},
}))

const id = (kind: SegmentKind, photoId: string) => `${kind}:${photoId}`
const rasters = new Map<string, MaskRaster>()
const pending = new Map<string, Promise<MaskRaster | null>>()
/** A kind whose model failed before it ever worked cannot run on this device. */
const unavailable = new Set<SegmentKind>()
const worked = new Set<SegmentKind>()

function setStatus(key: string, status: SegmentStatus) {
  useSegments.setState((s) => ({ status: { ...s.status, [key]: status } }))
}

function remember(key: string, raster: MaskRaster) {
  rasters.delete(key)
  rasters.set(key, raster)
  while (rasters.size > MEMORY_LIMIT) rasters.delete(rasters.keys().next().value as string)
}

/** True when on-device masks are on and the model for `kind` can run here. */
export function aiMasksEnabled(kind: SegmentKind): boolean {
  return useLibrary.getState().settings.aiMasks && !unavailable.has(kind)
}

/** The segmentation kinds visible layers use. */
export function segmentKinds(layers: Layer[]): SegmentKind[] {
  const used = new Set<string>()
  for (const l of layers) if (l.enabled && l.opacity > 0 && l.mask) used.add(l.mask.type)
  return KINDS.filter((k) => used.has(k))
}

/** The ready mask of a photo, if any. */
export function segmentRaster(photoId: string, kind: SegmentKind): MaskRaster | undefined {
  return aiMasksEnabled(kind) ? rasters.get(id(kind, photoId)) : undefined
}

/** Resolver for renderers: sky and subject masks use segmentation once it is ready. */
export function segmentResolver(photoId: string): MaskRasterResolver | undefined {
  const sky = segmentRaster(photoId, 'sky')
  const subject = segmentRaster(photoId, 'subject')
  if (!sky && !subject) return undefined
  return (mask) => (mask.type === 'sky' ? sky : mask.type === 'subject' ? subject : undefined)
}

/** Content keys of the ready masks, for render caches. */
export function segmentKey(photoId: string): string {
  return KINDS.map((k) => segmentRaster(photoId, k)?.key ?? '').join('|')
}

/* Worker: one job at a time, created on first use. */

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
    for (const [callId, done] of calls)
      done({ id: callId, ok: false, error: e.message || 'Worker failed' })
    calls.clear()
    worker = null
  }
  worker = w
  return w
}

function runModel(request: Omit<SegmentRequest, 'id'>): Promise<SegmentResponse> {
  const job = queue.then(
    () =>
      new Promise<SegmentResponse>((resolve) => {
        const callId = nextId++
        calls.set(callId, resolve)
        getWorker().postMessage({ ...request, id: callId } satisfies SegmentRequest, [
          request.image,
        ])
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

async function compute(photo: Photo, kind: SegmentKind, key: string): Promise<MaskRaster> {
  const preview = await previewBitmap(photo)
  if (!preview) throw new Error(`No preview for ${photo.name}`)
  const s = Math.min(1, INPUT_EDGE / Math.max(preview.width, preview.height))
  const image = await createImageBitmap(preview, {
    resizeWidth: Math.max(1, Math.round(preview.width * s)),
    resizeHeight: Math.max(1, Math.round(preview.height * s)),
    resizeQuality: 'medium',
  })
  const res = await runModel(
    kind === 'subject'
      ? { kind, image, point: photo.stats?.subject ?? { x: 0.5, y: 0.5 } }
      : { kind, image },
  )
  if (!res.ok) throw new Error(res.error)
  return { width: res.width, height: res.height, data: res.data, key }
}

const UNAVAILABLE: Record<SegmentKind, string> = {
  subject:
    'On-device subject detection is unavailable here, so subject masks use the quick estimate.',
  sky: 'On-device sky detection is unavailable here, so sky masks use the quick estimate.',
}

/**
 * Loads or computes a photo's mask of one kind. Resolves to null when AI
 * masks are off or the model cannot run; callers then keep the quick estimate.
 */
export function ensureSegment(photo: Photo, kind: SegmentKind): Promise<MaskRaster | null> {
  if (!aiMasksEnabled(kind)) return Promise.resolve(null)
  const key = id(kind, photo.id)
  const hit = rasters.get(key)
  if (hit) return Promise.resolve(hit)
  const running = pending.get(key)
  if (running) return running
  const storageKey = STORAGE_KEY[kind](photo.id)
  const job = (async () => {
    setStatus(key, 'pending')
    try {
      const stored = await blobDb.getBuffer(storageKey)
      let raster = stored ? decode(stored, storageKey) : null
      if (!raster) {
        raster = await compute(photo, kind, storageKey)
        await blobDb.set(storageKey, encode(raster))
      }
      worked.add(kind)
      remember(key, raster)
      setStatus(key, 'ready')
      return raster
    } catch (err) {
      console.warn(`${kind} segmentation failed for ${photo.name}:`, err)
      setStatus(key, 'failed')
      if (!worked.has(kind) && !unavailable.has(kind)) {
        unavailable.add(kind)
        toast(UNAVAILABLE[kind])
      }
      return null
    } finally {
      pending.delete(key)
    }
  })()
  pending.set(key, job)
  return job
}

/** Loads or computes every mask kind the layers use. */
export async function ensureSegments(photo: Photo, layers: Layer[]): Promise<void> {
  await Promise.all(segmentKinds(layers).map((kind) => ensureSegment(photo, kind)))
}
