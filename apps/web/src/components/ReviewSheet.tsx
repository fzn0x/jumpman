import {
  addComment,
  createReviewBundle,
  emptyReview,
  mergeReview,
  NORM_LAYER_ID,
  type Proposal,
  parseReviewBundle,
  photoIdMapper,
  proposalOps,
  REVIEW_LABELS,
  REVIEW_STATUSES,
  type ReviewStatus,
  resolveLayers,
  reviewSummary,
  setStatus,
  slugify,
} from '@jumpman/core'
import { FileDown, FileUp, Lightbulb, Send } from 'lucide-react'
import { useState } from 'react'
import { blobDb, photoKeys } from '../lib/db.ts'
import { timeAgo } from '../lib/format.ts'
import { pickFiles } from '../lib/hooks.ts'
import { saveFile } from '../lib/platform.ts'
import { toast } from '../state/editor.ts'
import {
  activeBranch,
  dispatchMany,
  setReview,
  updateSettings,
  useLibrary,
} from '../state/library.ts'
import { Button, Chip, cx, SectionTitle, Sheet } from '../ui/primitives.tsx'
import { EditedThumb } from './EditedThumb.tsx'

const STATUS_STYLE: Record<ReviewStatus, string> = {
  pending: 'bg-white/10',
  approved: 'bg-emerald-500 text-white',
  changes: 'bg-amber-300 text-ink',
  rejected: 'bg-brand text-white',
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000)
    s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

/**
 * Offline-first collaboration: a review file carries comments, approvals and
 * suggested edits (shown as proposed layers). The first file a client receives
 * also embeds small previews so they can review without the originals.
 */
export function ReviewSheet({
  collectionId,
  open,
  onClose,
  batchId,
  photoId,
}: {
  collectionId: string
  open: boolean
  onClose: () => void
  batchId?: string
  photoId?: string
}) {
  const collection = useLibrary((s) => s.collections[collectionId])
  const photos = useLibrary((s) => s.photos)
  const batches = useLibrary((s) => s.batches)
  const author = useLibrary((s) => s.settings.author)
  const [text, setText] = useState('')
  const [scope, setScope] = useState<'photo' | 'all'>(photoId ? 'photo' : 'all')
  const [busy, setBusy] = useState(false)
  if (!collection) return null
  const review = collection.review ?? emptyReview()
  const me = author || 'Me'
  const focus = scope === 'photo' && photoId ? photoId : null
  const comments = review.comments.filter((c) => (focus ? c.photoId === focus : true))
  const summary = reviewSummary(review, collection.photoIds)
  const batch = batchId
    ? batches[batchId]
    : Object.values(batches)
        .filter((b) => b.collectionId === collectionId)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]

  const list = collection.photoIds.map((id) => photos[id]).filter((p) => !!p)

  const exportBundle = async (withPreviews: boolean, proposals: Proposal[] = []) => {
    setBusy(true)
    try {
      const bundle: Record<string, unknown> = {
        ...createReviewBundle(review, {
          collectionName: collection.name,
          author: me,
          photos: list.map((p) => ({ id: p.id, name: p.name })),
          proposals,
        }),
      }
      if (withPreviews) {
        const assets: Record<string, string> = {}
        for (const p of list) {
          const blob = await blobDb.get(photoKeys.preview(p.id))
          if (blob) assets[p.id] = await blobToBase64(blob)
        }
        bundle.assets = assets
      }
      const file = new Blob([JSON.stringify(bundle)], { type: 'application/json' })
      toast(await saveFile(`${slugify(collection.name) || 'review'}.jumpman-review.json`, file))
    } finally {
      setBusy(false)
    }
  }

  const suggestCurrent = async () => {
    if (!batch) return toast('Open the photos in the editor first')
    const branch = activeBranch(batch)
    const proposals: Proposal[] = [
      {
        id: `pr_${Date.now()}`,
        author: me,
        at: Date.now(),
        photoId: null,
        layers: resolveLayers(branch.global, undefined).filter((l) => l.id !== NORM_LAYER_ID),
      },
    ]
    for (const id of batch.photoIds) {
      const s = branch.photos[id]
      if (s?.override.layers?.length) {
        proposals.push({
          id: `pr_${id}`,
          author: me,
          at: Date.now(),
          photoId: id,
          layers: s.override.layers,
        })
      }
    }
    await exportBundle(false, proposals)
  }

  const importFeedback = async () => {
    const [file] = await pickFiles('.json,application/json', false)
    if (!file) return
    try {
      const bundle = parseReviewBundle(await file.text())
      const map = photoIdMapper(
        bundle,
        list.map((p) => ({ id: p.id, name: p.name })),
      )
      setReview(collection.id, mergeReview(review, bundle, map))
      const ops = proposalOps(bundle, map)
      if (ops.length && batch) dispatchMany(batch.id, ops)
      toast(
        `Merged feedback from ${bundle.author}: ${bundle.comments.length} comments${ops.length ? `, ${ops.length} suggested layers (see Layers)` : ''}`,
      )
    } catch (e) {
      toast((e as Error).message)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Review & approvals">
      <div className="flex flex-wrap gap-1.5">
        {REVIEW_STATUSES.map((s) => (
          <span
            key={s}
            className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', STATUS_STYLE[s])}
          >
            {REVIEW_LABELS[s]} {summary[s]}
          </span>
        ))}
      </div>

      {photoId && photos[photoId] && (
        <>
          <SectionTitle>This photo</SectionTitle>
          <div className="flex items-center gap-3">
            <EditedThumb photo={photos[photoId]} maxEdge={160} className="size-16 rounded-xl" />
            <div className="flex flex-wrap gap-1.5">
              {REVIEW_STATUSES.map((s) => (
                <Chip
                  key={s}
                  active={(review.statuses[photoId]?.status ?? 'pending') === s}
                  onClick={() => setReview(collection.id, setStatus(review, photoId, s, me))}
                >
                  {REVIEW_LABELS[s]}
                </Chip>
              ))}
            </div>
          </div>
        </>
      )}

      <SectionTitle
        action={
          photoId && (
            <div className="flex gap-1">
              <Chip active={scope === 'photo'} onClick={() => setScope('photo')} className="h-7">
                Photo
              </Chip>
              <Chip active={scope === 'all'} onClick={() => setScope('all')} className="h-7">
                All
              </Chip>
            </div>
          )
        }
      >
        Comments
      </SectionTitle>
      {!author && (
        <label className="mb-2 block text-xs text-mute">
          Your name (shown on comments)
          <input
            className="mt-1 w-full rounded-xl bg-ink-2 px-3 py-2 text-sm text-white"
            placeholder="e.g. Ana"
            onBlur={(e) =>
              e.target.value.trim() && updateSettings({ author: e.target.value.trim() })
            }
          />
        </label>
      )}
      <ul className="max-h-64 space-y-2 overflow-y-auto">
        {comments.map((c) => (
          <li key={c.id} className="rounded-2xl bg-ink-2 px-3 py-2">
            <div className="flex justify-between text-xs text-mute">
              <span className="font-semibold text-white">{c.author}</span>
              <span>
                {c.photoId && !focus ? `${photos[c.photoId]?.name ?? 'photo'} · ` : ''}
                {timeAgo(c.at)}
              </span>
            </div>
            <p className="mt-0.5 text-sm">{c.text}</p>
          </li>
        ))}
        {!comments.length && <li className="text-sm text-mute">No comments yet.</li>}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          setReview(collection.id, addComment(review, me, text.trim(), focus))
          setText('')
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={focus ? 'Comment on this photo' : 'Comment on the collection'}
          aria-label="New comment"
          className="h-10 min-w-0 flex-1 rounded-2xl bg-ink-2 px-4 text-sm outline-none focus:ring-2 focus:ring-salmon"
        />
        <Button type="submit" variant="primary" icon={Send} aria-label="Post comment" />
      </form>

      <SectionTitle>Share</SectionTitle>
      <div className="grid gap-2">
        <Button icon={FileDown} disabled={busy} onClick={() => void exportBundle(true)}>
          {busy ? 'Packing…' : 'Send for review (with previews)'}
        </Button>
        <Button icon={Lightbulb} disabled={busy} onClick={() => void suggestCurrent()}>
          Send feedback with my edit as a suggestion
        </Button>
        <Button icon={FileUp} onClick={() => void importFeedback()}>
          Import feedback
        </Button>
      </div>
      <p className="mt-3 mb-2 text-xs leading-relaxed text-mute">
        No account or server: send the file by any messenger or email. Clients open it in Jumpman to
        see the photos, comment, approve and suggest edits. Suggestions arrive as proposed layers
        you can accept or reject.
      </p>
    </Sheet>
  )
}
