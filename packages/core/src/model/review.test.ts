import { describe, expect, it } from 'vitest'
import { createBranch } from './edit.ts'
import { createLayer } from './layers.ts'
import { applyOps } from './ops.ts'
import {
  addComment,
  createReviewBundle,
  emptyReview,
  mergeReview,
  parseReviewBundle,
  photoIdMapper,
  proposalOps,
  reviewSummary,
  setStatus,
} from './review.ts'

describe('collaborative review', () => {
  const photos = [
    { id: 'p1', name: 'IMG_1.jpg' },
    { id: 'p2', name: 'IMG_2.jpg' },
  ]

  it('round-trips a bundle and merges it into another device by id or name', () => {
    let client = setStatus(emptyReview(), 'p1', 'approved', 'Client')
    client = addComment(client, 'Client', 'Love this one', 'p1')
    client = addComment(client, 'Client', 'Warmer overall?', null)
    const bundle = parseReviewBundle(
      JSON.stringify(
        createReviewBundle(client, {
          collectionName: 'Spring Pink',
          author: 'Client',
          photos,
          proposals: [
            {
              id: 'x',
              author: 'Client',
              at: 1,
              photoId: null,
              layers: [createLayer('lut', { params: { lutId: 'builtin:golden-hour' } })],
            },
          ],
        }),
      ),
    )
    // The owner's device knows the photos under different ids but the same names.
    const local = [
      { id: 'a', name: 'IMG_1.jpg' },
      { id: 'b', name: 'IMG_2.jpg' },
    ]
    const map = photoIdMapper(bundle, local)
    const merged = mergeReview(emptyReview(), bundle, map)
    expect(merged.statuses.a?.status).toBe('approved')
    expect(merged.comments.map((c) => c.photoId)).toEqual(['a', null])
    expect(mergeReview(merged, bundle, map).comments).toHaveLength(2)
    expect(reviewSummary(merged, ['a', 'b'])).toEqual({
      pending: 1,
      approved: 1,
      changes: 0,
      rejected: 0,
    })

    const branch = applyOps(createBranch(), proposalOps(bundle, map))
    const proposed = branch.global.layers.find((l) => l.proposedBy)
    expect(proposed?.proposedBy).toBe('Client')
  })

  it('rejects foreign files and sanitizes content', () => {
    expect(() => parseReviewBundle({ schema: 'x' })).toThrow()
    const b = parseReviewBundle({
      schema: 'jumpman.review/1',
      comments: [{ text: '' }, { text: 'ok', author: 5 }],
      statuses: { p1: { status: 'hacked' } },
    })
    expect(b.comments).toHaveLength(1)
    expect(b.comments[0]?.author).toBe('Anonymous')
    expect(b.statuses).toEqual({})
  })
})
