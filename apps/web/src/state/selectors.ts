import {
  adaptiveNorms,
  type Branch,
  consistency,
  type Layer,
  type MatchItem,
  type Norm,
  type PhotoState,
  resolveLayers,
} from '@jumpman/core'
import type { Batch, Photo } from '../lib/types.ts'
import { activeBranch } from './library.ts'

const adaptiveCache = new WeakMap<Branch, Map<string, Norm>>()

/** Adaptive-mode targets for every photo of a batch (memoized per branch state). */
export function adaptiveNormMap(batch: Batch, photos: Record<string, Photo>): Map<string, Norm> {
  const branch = activeBranch(batch)
  const hit = adaptiveCache.get(branch)
  if (hit) return hit
  const map = new Map<string, Norm>()
  if (branch.global.adaptive) {
    const withStats = batch.photoIds.map((id) => photos[id]).filter((p): p is Photo => !!p?.stats)
    const norms = adaptiveNorms(withStats.map((p) => p.stats as NonNullable<Photo['stats']>))
    withStats.forEach((p, i) => {
      const n = norms[i]
      if (n) map.set(p.id, n)
    })
  }
  adaptiveCache.set(branch, map)
  return map
}

export function photoStateOf(branch: Branch, photoId: string): PhotoState | undefined {
  return branch.photos[photoId]
}

/** The concrete layer stack to render for one photo of a batch. */
export function layersFor(
  batch: Batch,
  photos: Record<string, Photo>,
  photoId: string,
  branch = activeBranch(batch),
): Layer[] {
  const extra = branch.global.adaptive ? adaptiveNormMap(batch, photos).get(photoId) : undefined
  return resolveLayers(branch.global, branch.photos[photoId], extra)
}

/** Items for consistency scoring, including auto and manual corrections. */
export function matchItems(
  batch: Batch,
  photos: Record<string, Photo>,
  branch = activeBranch(batch),
): (MatchItem & { id: string })[] {
  const adaptive = branch.global.adaptive ? adaptiveNormMap(batch, photos) : null
  return batch.photoIds.flatMap((id) => {
    const p = photos[id]
    if (!p?.stats) return []
    const s = branch.photos[id]
    const norm = { ...s?.norm }
    const a = adaptive?.get(id)
    if (a) for (const k of Object.keys(a) as (keyof Norm)[]) norm[k] = (norm[k] ?? 0) + a[k]
    return [{ id, stats: p.stats, norm, delta: s?.override.basicDeltas?.base ?? {} }]
  })
}

export function batchConsistency(batch: Batch, photos: Record<string, Photo>) {
  return consistency(matchItems(batch, photos))
}
