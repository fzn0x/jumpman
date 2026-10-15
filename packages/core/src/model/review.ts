/**
 * Collaborative review, offline-first: a review bundle is a small JSON file
 * (no photos inside) that a client or teammate opens in their own Jumpman,
 * where they comment, approve and suggest edits as proposed layers. Bundles
 * merge back without conflicts.
 */

import type { Layer } from './layers.ts'
import { newId } from './layers.ts'
import { type EditOp, GLOBAL } from './ops.ts'
import { sanitizeLayers, str } from './sanitize.ts'

export const REVIEW_SCHEMA = 'jumpman.review/1'

export const REVIEW_STATUSES = ['pending', 'approved', 'changes', 'rejected'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  changes: 'Needs changes',
  rejected: 'Rejected',
}

export interface StatusEntry {
  status: ReviewStatus
  by: string
  at: number
}

export interface ReviewComment {
  id: string
  /** null for comments on the whole collection. */
  photoId: string | null
  author: string
  text: string
  at: number
}

export interface Proposal {
  id: string
  author: string
  at: number
  /** null proposes for the whole batch, otherwise for one photo. */
  photoId: string | null
  layers: Layer[]
  note?: string
}

export interface Review {
  statuses: Record<string, StatusEntry>
  comments: ReviewComment[]
}

export interface ReviewBundle extends Review {
  schema: typeof REVIEW_SCHEMA
  collectionName: string
  author: string
  createdAt: number
  photos: { id: string; name: string }[]
  proposals: Proposal[]
}

export function emptyReview(): Review {
  return { statuses: {}, comments: [] }
}

export function addComment(
  review: Review,
  author: string,
  text: string,
  photoId: string | null,
): Review {
  const comment: ReviewComment = {
    id: newId('c'),
    photoId,
    author,
    text: text.slice(0, 2000),
    at: Date.now(),
  }
  return { ...review, comments: [...review.comments, comment] }
}

export function setStatus(
  review: Review,
  photoId: string,
  status: ReviewStatus,
  by: string,
): Review {
  return { ...review, statuses: { ...review.statuses, [photoId]: { status, by, at: Date.now() } } }
}

export function createReviewBundle(
  review: Review,
  meta: {
    collectionName: string
    author: string
    photos: { id: string; name: string }[]
    proposals?: Proposal[]
  },
): ReviewBundle {
  return {
    schema: REVIEW_SCHEMA,
    collectionName: meta.collectionName,
    author: meta.author,
    createdAt: Date.now(),
    photos: meta.photos,
    statuses: review.statuses,
    comments: review.comments,
    proposals: meta.proposals ?? [],
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isStatus = (v: unknown): v is ReviewStatus => REVIEW_STATUSES.includes(v as ReviewStatus)
const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Validates an untrusted review bundle. */
export function parseReviewBundle(input: unknown): ReviewBundle {
  const v = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  if (!isObj(v) || v.schema !== REVIEW_SCHEMA) throw new Error('Not a Jumpman review file')
  const photos = (Array.isArray(v.photos) ? v.photos : [])
    .filter(isObj)
    .slice(0, 5000)
    .map((p) => ({ id: str(p.id, 64), name: str(p.name, 255) }))
  const statuses: Record<string, StatusEntry> = {}
  if (isObj(v.statuses)) {
    for (const [id, s] of Object.entries(v.statuses)) {
      if (isObj(s) && isStatus(s.status))
        statuses[str(id, 64)] = { status: s.status, by: str(s.by, 80), at: time(s.at) }
    }
  }
  const comments = (Array.isArray(v.comments) ? v.comments : [])
    .filter(isObj)
    .slice(0, 10_000)
    .map((c) => ({
      id: str(c.id, 64) || newId('c'),
      photoId: typeof c.photoId === 'string' ? str(c.photoId, 64) : null,
      author: str(c.author, 80) || 'Anonymous',
      text: str(c.text, 2000),
      at: time(c.at),
    }))
    .filter((c) => c.text)
  const proposals = (Array.isArray(v.proposals) ? v.proposals : [])
    .filter(isObj)
    .slice(0, 200)
    .map((p) => ({
      id: str(p.id, 64) || newId('pr'),
      author: str(p.author, 80) || 'Anonymous',
      at: time(p.at),
      photoId: typeof p.photoId === 'string' ? str(p.photoId, 64) : null,
      layers: sanitizeLayers(p.layers, 8),
      ...(p.note ? { note: str(p.note, 500) } : {}),
    }))
    .filter((p) => p.layers.length)
  return {
    schema: REVIEW_SCHEMA,
    collectionName: str(v.collectionName, 120),
    author: str(v.author, 80) || 'Anonymous',
    createdAt: time(v.createdAt),
    photos,
    statuses,
    comments,
    proposals,
  }
}

/**
 * Maps bundle photo ids to local ids: same id first, then same file name.
 */
export function photoIdMapper(
  bundle: ReviewBundle,
  local: { id: string; name: string }[],
): (bundleId: string) => string | undefined {
  const ids = new Set(local.map((p) => p.id))
  const byName = new Map(local.map((p) => [p.name, p.id]))
  const names = new Map(bundle.photos.map((p) => [p.id, p.name]))
  return (id) => (ids.has(id) ? id : byName.get(names.get(id) ?? ''))
}

/** Merges a bundle into local review state: comments union, newest status wins. */
export function mergeReview(
  local: Review,
  bundle: ReviewBundle,
  mapId: (id: string) => string | undefined,
): Review {
  const statuses = { ...local.statuses }
  for (const [id, s] of Object.entries(bundle.statuses)) {
    const localId = mapId(id)
    if (!localId) continue
    const cur = statuses[localId]
    if (!cur || s.at >= cur.at) statuses[localId] = s
  }
  const seen = new Set(local.comments.map((c) => c.id))
  const comments = [...local.comments]
  for (const c of bundle.comments) {
    if (seen.has(c.id)) continue
    const photoId = c.photoId === null ? null : mapId(c.photoId)
    if (c.photoId !== null && !photoId) continue
    comments.push({ ...c, photoId: photoId ?? null })
    seen.add(c.id)
  }
  comments.sort((a, b) => a.at - b.at)
  return { statuses, comments }
}

/** Edit ops that add a bundle's suggestions as proposed layers. */
export function proposalOps(
  bundle: ReviewBundle,
  mapId: (id: string) => string | undefined,
): EditOp[] {
  const ops: EditOp[] = []
  for (const p of bundle.proposals) {
    const photoId = p.photoId === null ? null : mapId(p.photoId)
    if (p.photoId !== null && !photoId) continue
    for (const layer of p.layers) {
      const proposed = {
        ...layer,
        id: newId(),
        proposedBy: p.author,
        name: `${layer.name} · ${p.author}`,
      } as Layer
      ops.push({
        type: 'addLayer',
        layer: proposed,
        scope: photoId ? { kind: 'photo', photoId } : GLOBAL,
      })
    }
  }
  return ops
}

export function reviewSummary(review: Review, photoIds: string[]): Record<ReviewStatus, number> {
  const out: Record<ReviewStatus, number> = { pending: 0, approved: 0, changes: 0, rejected: 0 }
  for (const id of photoIds) out[review.statuses[id]?.status ?? 'pending']++
  return out
}
