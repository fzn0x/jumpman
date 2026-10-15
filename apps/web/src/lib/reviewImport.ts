import { emptyReview, mergeReview, parseReviewBundle, photoIdMapper } from '@jumpman/core'
import { addFiles, createCollection, setReview, useLibrary } from '../state/library.ts'

const MAX_ASSET_BYTES = 12 * 1024 * 1024

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Opens a review file sent by someone else: creates a collection from its
 * embedded previews and loads the comments and approvals.
 */
export async function openReviewFile(file: File): Promise<string> {
  const raw = JSON.parse(await file.text()) as Record<string, unknown>
  const bundle = parseReviewBundle(raw)
  const assets = (typeof raw.assets === 'object' && raw.assets ? raw.assets : {}) as Record<
    string,
    unknown
  >
  const files: File[] = []
  for (const p of bundle.photos) {
    const data = assets[p.id]
    if (typeof data !== 'string' || data.length > (MAX_ASSET_BYTES * 4) / 3) continue
    try {
      files.push(
        new File([base64ToBytes(data).slice()], p.name || `${p.id}.jpg`, { type: 'image/jpeg' }),
      )
    } catch {
      // skip unreadable previews
    }
  }
  if (!files.length)
    throw new Error(
      'This review file has no photos. Use “Import feedback” inside the collection instead.',
    )
  const id = createCollection(`Review · ${bundle.collectionName || bundle.author}`)
  await addFiles(id, files)
  const c = useLibrary.getState().collections[id]
  if (c) {
    const local = c.photoIds.map((pid) => ({
      id: pid,
      name: useLibrary.getState().photos[pid]?.name ?? '',
    }))
    setReview(id, mergeReview(emptyReview(), bundle, photoIdMapper(bundle, local)))
  }
  return id
}
