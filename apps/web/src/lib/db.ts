/**
 * Local persistence. Metadata (JSON) and binary blobs live in two IndexedDB
 * stores; everything stays on the device.
 */
import {
  clear,
  createStore,
  del,
  delMany,
  entries,
  get,
  getMany,
  set,
  setMany,
  type UseStore,
} from 'idb-keyval'

let metaStore: UseStore | null = null
let blobStore: UseStore | null = null

const meta = () => {
  metaStore ??= createStore('jumpman-meta', 'kv')
  return metaStore
}
const blobs = () => {
  blobStore ??= createStore('jumpman-blobs', 'blobs')
  return blobStore
}

export const metaDb = {
  get: <T>(key: string) => get<T>(key, meta()),
  set: (key: string, value: unknown) => set(key, value, meta()),
  setMany: (items: [string, unknown][]) => setMany(items, meta()),
  delMany: (keys: string[]) => delMany(keys, meta()),
  entries: <T>() => entries<string, T>(meta()),
  clear: () => clear(meta()),
}

export const blobDb = {
  get: (key: string) => get<Blob>(key, blobs()),
  getMany: (keys: string[]) => getMany<Blob>(keys, blobs()),
  set: (key: string, value: Blob | ArrayBuffer) => set(key, value, blobs()),
  setMany: (items: [string, Blob | ArrayBuffer][]) => setMany(items, blobs()),
  del: (key: string) => del(key, blobs()),
  delMany: (keys: string[]) => delMany(keys, blobs()),
  getBuffer: (key: string) => get<ArrayBuffer>(key, blobs()),
  clear: () => clear(blobs()),
}

/** Blob keys for a photo. */
export const photoKeys = {
  source: (id: string) => `src:${id}`,
  preview: (id: string) => `preview:${id}`,
  thumb: (id: string) => `thumb:${id}`,
  all: (id: string) => [`src:${id}`, `preview:${id}`, `thumb:${id}`],
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null
  } catch {
    return null
  }
}
