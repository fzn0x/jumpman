import type { Layer } from '@jumpman/core'
import { GLRenderer } from '@jumpman/renderer'
import type { FrameSpec } from './geometry.ts'
import { fit } from './image.ts'
import { resolveLut } from './luts.ts'
import { previewBitmap, thumbBitmap } from './media.ts'
import type { Photo } from './types.ts'

let renderer: GLRenderer | null = null
let chain: Promise<unknown> = Promise.resolve()
const cache = new Map<string, ImageBitmap>()
const CACHE_LIMIT = 300
let generation = 0

function getRenderer(): GLRenderer | null {
  if (renderer && !renderer.isLost) return renderer
  try {
    renderer = new GLRenderer(new OffscreenCanvas(1, 1))
  } catch {
    renderer = null
  }
  return renderer
}

/** Drops cached renders (e.g. after custom LUT data changed). */
export function invalidateThumbs(): void {
  generation++
  for (const b of cache.values()) b.close()
  cache.clear()
}

/** Renders an edited thumbnail off-screen. Calls are queued on one GPU context. */
export function renderEdited(
  photo: Photo,
  layers: Layer[],
  frame: FrameSpec,
  maxEdge: number,
  opts: { original?: boolean } = {},
): Promise<ImageBitmap | null> {
  const key = `${generation}|${photo.id}|${maxEdge}|${opts.original ? 'o' : ''}|${JSON.stringify(frame.rect)}${frame.rotate}${frame.flipH}|${opts.original ? '' : JSON.stringify(layers)}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return Promise.resolve(hit)
  }
  const job = chain.then(async () => {
    const again = cache.get(key)
    if (again) return again
    const src = maxEdge > 480 ? await previewBitmap(photo) : await thumbBitmap(photo)
    const r = getRenderer()
    if (!src || !r) return null
    r.setImage(src, `${photo.id}@${maxEdge > 480 ? 'p' : 't'}`)
    const { w, h } = fit(frame.width, frame.height, maxEdge)
    const ok = r.render({
      layers: opts.original ? [] : layers,
      luts: resolveLut,
      width: w,
      height: h,
      rect: frame.rect,
      rotate: frame.rotate,
      flipH: frame.flipH,
      ...(photo.stats ? { subject: photo.stats.subject } : {}),
    })
    if (!ok) return null
    const bmp = (r.canvas as OffscreenCanvas).transferToImageBitmap()
    cache.set(key, bmp)
    while (cache.size > CACHE_LIMIT) {
      const [k, old] = cache.entries().next().value as [string, ImageBitmap]
      cache.delete(k)
      old.close()
    }
    return bmp
  })
  chain = job.catch(() => null)
  return job
}
