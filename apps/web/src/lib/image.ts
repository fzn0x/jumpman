/** Image decoding and resizing helpers that work on the main thread and in workers. */

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

export function makeCanvas(w: number, h: number): OffscreenCanvas {
  return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
}

export function fit(w: number, h: number, maxEdge: number): { w: number; h: number } {
  if (Math.max(w, h) <= maxEdge) return { w, h }
  const s = maxEdge / Math.max(w, h)
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

/** Applies an EXIF orientation (1–8) to a decoded image. */
export function orient(img: ImageBitmap, orientation: number): OffscreenCanvas | ImageBitmap {
  if (orientation <= 1 || orientation > 8) return img
  const { width: w, height: h } = img
  const swap = orientation >= 5
  const c = makeCanvas(swap ? h : w, swap ? w : h)
  const ctx = c.getContext('2d')
  if (!ctx) return img
  switch (orientation) {
    case 2:
      ctx.transform(-1, 0, 0, 1, w, 0)
      break
    case 3:
      ctx.transform(-1, 0, 0, -1, w, h)
      break
    case 4:
      ctx.transform(1, 0, 0, -1, 0, h)
      break
    case 5:
      ctx.transform(0, 1, 1, 0, 0, 0)
      break
    case 6:
      ctx.transform(0, 1, -1, 0, h, 0)
      break
    case 7:
      ctx.transform(0, -1, -1, 0, h, w)
      break
    case 8:
      ctx.transform(0, -1, 1, 0, 0, w)
      break
  }
  ctx.drawImage(img, 0, 0)
  return c
}

type Drawable = ImageBitmap | OffscreenCanvas | HTMLCanvasElement | HTMLImageElement

function sizeOf(src: Drawable): { w: number; h: number } {
  if ('naturalWidth' in src) return { w: src.naturalWidth, h: src.naturalHeight }
  return { w: src.width, h: src.height }
}

/** Downscales in halving steps for quality, then draws at the exact size. */
export function resizeTo(src: Drawable, maxEdge: number): OffscreenCanvas {
  const { w, h } = sizeOf(src)
  const target = fit(w, h, maxEdge)
  let cur: Drawable = src
  let cw = w
  let ch = h
  while (cw / 2 >= target.w * 1.5 && ch / 2 >= target.h * 1.5) {
    const half = makeCanvas(cw / 2, ch / 2)
    const hctx = half.getContext('2d')
    if (!hctx) break
    hctx.imageSmoothingQuality = 'high'
    hctx.drawImage(cur, 0, 0, half.width, half.height)
    cur = half
    cw = half.width
    ch = half.height
  }
  const out = makeCanvas(target.w, target.h)
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(cur, 0, 0, out.width, out.height)
  return out
}

export async function canvasToBlob(
  c: OffscreenCanvas,
  type = 'image/jpeg',
  quality = 0.88,
): Promise<Blob> {
  return c.convertToBlob({ type, quality })
}

export function imageDataOf(c: OffscreenCanvas): ImageData {
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable')
  return ctx.getImageData(0, 0, c.width, c.height)
}

/** Decodes a stored blob, applying an explicit orientation for RAW previews. */
export async function decodeBlob(
  blob: Blob,
  orientation?: number,
  maxEdge?: number,
): Promise<ImageBitmap> {
  const bmp = await createImageBitmap(blob, {
    imageOrientation: orientation ? 'none' : 'from-image',
  })
  let out: ImageBitmap | OffscreenCanvas = orientation ? orient(bmp, orientation) : bmp
  if (maxEdge && Math.max(out.width, out.height) > maxEdge) out = resizeTo(out, maxEdge)
  if (out === bmp) return bmp
  const result = await createImageBitmap(out)
  bmp.close()
  return result
}
