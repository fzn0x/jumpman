import { blobDb, photoKeys } from './db.ts'
import { decodeBlob } from './image.ts'
import type { Photo } from './types.ts'

/** Small LRU of decoded bitmaps so flipping between photos is instant. */
class BitmapCache {
  private map = new Map<string, Promise<ImageBitmap | null>>()
  private limit: number
  constructor(limit: number) {
    this.limit = limit
  }

  get(key: string, load: () => Promise<ImageBitmap | null>): Promise<ImageBitmap | null> {
    const hit = this.map.get(key)
    if (hit) {
      this.map.delete(key)
      this.map.set(key, hit)
      return hit
    }
    const p = load().catch(() => null)
    this.map.set(key, p)
    while (this.map.size > this.limit) {
      const [oldKey, old] = this.map.entries().next().value as [string, Promise<ImageBitmap | null>]
      this.map.delete(oldKey)
      void old.then((b) => b?.close())
    }
    return p
  }

  drop(prefix: string) {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k)
  }
}

const previews = new BitmapCache(8)
const thumbs = new BitmapCache(400)

export function previewBitmap(photo: Photo): Promise<ImageBitmap | null> {
  return previews.get(photo.id, async () => {
    const blob = await blobDb.get(photoKeys.preview(photo.id))
    return blob ? decodeBlob(blob) : null
  })
}

export function thumbBitmap(photo: Photo): Promise<ImageBitmap | null> {
  return thumbs.get(photo.id, async () => {
    const blob = await blobDb.get(photoKeys.thumb(photo.id))
    return blob ? decodeBlob(blob) : null
  })
}

/** Full-resolution decode for export (respects the GPU texture limit). */
export async function sourceBitmap(photo: Photo, maxEdge: number): Promise<ImageBitmap> {
  const blob = await blobDb.get(photoKeys.source(photo.id))
  if (!blob) throw new Error(`Missing original for ${photo.name}`)
  return decodeBlob(blob, photo.raw?.orientation, maxEdge)
}

export async function thumbUrl(photoId: string): Promise<string | null> {
  const blob = await blobDb.get(photoKeys.thumb(photoId))
  return blob ? URL.createObjectURL(blob) : null
}
