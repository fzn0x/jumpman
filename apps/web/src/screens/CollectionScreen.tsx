import {
  batchPalette,
  classifyScene,
  groupByMoment,
  hasOverride,
  REVIEW_LABELS,
  SCENE_LABELS,
  type SceneType,
  selectByColor,
  selectByScene,
  selectSameMoment,
  selectSimilar,
  selectTimeRange,
} from '@jumpman/core'
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  ImagePlus,
  Layers3,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { TopBar } from '../components/Chrome.tsx'
import { EditedThumb } from '../components/EditedThumb.tsx'
import { ReviewSheet } from '../components/ReviewSheet.tsx'
import { dateTime, plural } from '../lib/format.ts'
import { pickFiles } from '../lib/hooks.ts'
import { ACCEPTED_TYPES } from '../lib/importer.ts'
import type { Photo } from '../lib/types.ts'
import { toast } from '../state/editor.ts'
import {
  activeBranch,
  addFiles,
  deleteCollection,
  openBatch,
  removePhotos,
  renameCollection,
  revertCollection,
  useLibrary,
} from '../state/library.ts'
import { navigate } from '../state/router.ts'
import { Menu } from '../ui/Menu.tsx'
import { Button, Chip, cx, Empty, IconButton, Sheet } from '../ui/primitives.tsx'

function toLocalInput(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function TimeSheet({
  open,
  onClose,
  photos,
  onSelect,
}: {
  open: boolean
  onClose: () => void
  photos: Photo[]
  onSelect: (ids: string[]) => void
}) {
  const times = photos.map((p) => p.takenAt ?? p.addedAt)
  const [from, setFrom] = useState(() => toLocalInput(Math.min(...times)))
  const [to, setTo] = useState(() => toLocalInput(Math.max(...times)))
  const moments = groupByMoment(photos.map((p) => ({ id: p.id, takenAt: p.takenAt ?? p.addedAt })))
  const byId = new Map(photos.map((p) => [p.id, p]))
  return (
    <Sheet open={open} onClose={onClose} title="Select by time">
      <p className="mb-3 text-sm text-mute">
        Moments are runs of shots taken less than 10 minutes apart.
      </p>
      <div className="space-y-2">
        {moments.map((m) => {
          const first = byId.get(m[0] as string)
          const last = byId.get(m[m.length - 1] as string)
          return (
            <button
              key={m[0]}
              type="button"
              onClick={() => {
                onSelect(m)
                onClose()
              }}
              className="flex w-full items-center gap-3 rounded-2xl bg-ink-2 p-2 text-left hover:bg-ink-3"
            >
              <div className="flex -space-x-3">
                {m.slice(0, 3).map((id) => {
                  const p = byId.get(id)
                  return p ? (
                    <EditedThumb
                      key={id}
                      photo={p}
                      maxEdge={160}
                      className="size-11 rounded-xl ring-2 ring-ink-2"
                    />
                  ) : null
                })}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">{plural(m.length, 'photo')}</div>
                <div className="truncate text-xs text-mute">
                  {first && dateTime(first.takenAt ?? first.addedAt)}
                  {last &&
                    m.length > 1 &&
                    ` → ${new Date(last.takenAt ?? last.addedAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}`}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold text-mute">
          From
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 w-full rounded-xl bg-ink-2 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
        </label>
        <label className="text-xs font-semibold text-mute">
          To
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 w-full rounded-xl bg-ink-2 px-3 py-2 text-sm text-white [color-scheme:dark]"
          />
        </label>
      </div>
      <Button
        variant="primary"
        className="mt-4 w-full"
        onClick={() => {
          onSelect(
            selectTimeRange(
              photos.map((p) => ({ id: p.id, takenAt: p.takenAt ?? p.addedAt })),
              new Date(from).getTime(),
              new Date(to).getTime() + 59_999,
            ),
          )
          onClose()
        }}
      >
        Select range
      </Button>
    </Sheet>
  )
}

export function CollectionScreen({ id }: { id: string }) {
  const collection = useLibrary((s) => s.collections[id])
  const photosById = useLibrary((s) => s.photos)
  const batches = useLibrary((s) => s.batches)
  const [selected, setSelected] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [sceneOpen, setSceneOpen] = useState(false)

  const photos = useMemo(
    () => (collection?.photoIds ?? []).map((pid) => photosById[pid]).filter((p): p is Photo => !!p),
    [collection?.photoIds, photosById],
  )
  const selectable = useMemo(
    () =>
      photos.map((p) => ({
        id: p.id,
        ...(p.stats ? { stats: p.stats } : {}),
        takenAt: p.takenAt ?? p.addedAt,
      })),
    [photos],
  )
  const palette = useMemo(() => batchPalette(selectable, 7), [selectable])
  const scenes = useMemo(() => {
    const counts = new Map<SceneType, number>()
    for (const p of photos) {
      if (!p.stats) continue
      const s = classifyScene(p.stats).primary
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1])
  }, [photos])

  if (!collection) {
    return (
      <div className="grid h-full place-items-center">
        <Empty icon={Layers3} title="This collection no longer exists">
          <a className="font-semibold text-salmon" href="#/">
            Back to collections
          </a>
        </Empty>
      </div>
    )
  }

  const selectedSet = new Set(selected)
  const seed = selectable.find((p) => p.id === (anchor ?? selected[selected.length - 1]))
  const toggle = (pid: string) => {
    setAnchor(pid)
    setSelected((s) => (s.includes(pid) ? s.filter((x) => x !== pid) : [...s, pid]))
  }
  const apply = (ids: string[], what: string) => {
    setSelected(ids)
    toast(`${plural(ids.length, 'photo')} selected · ${what}`)
  }
  const edit = () => {
    const batchId = openBatch(collection.id, selected)
    navigate({ name: 'editor', batchId, view: 'single' })
  }

  return (
    <div className="min-h-full pb-32">
      <TopBar
        left={
          <>
            <IconButton
              icon={ArrowLeft}
              label="Back to collections"
              onClick={() => navigate({ name: 'library' })}
            />
            <div className="min-w-0 pl-1">
              {renaming ? (
                <input
                  // biome-ignore lint/a11y/noAutofocus: rename starts from an explicit action
                  autoFocus
                  defaultValue={collection.name}
                  aria-label="Collection name"
                  onBlur={(e) => {
                    renameCollection(collection.id, e.target.value.trim() || collection.name)
                    setRenaming(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setRenaming(false)
                  }}
                  className="w-full rounded-lg bg-ink-2 px-2 py-1 font-display text-lg font-bold outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  className="block max-w-full truncate text-left"
                  title="Rename"
                >
                  <span className="font-display text-lg font-bold tracking-tight">
                    {collection.name}
                  </span>
                </button>
              )}
            </div>
          </>
        }
        right={
          <>
            <Button
              size="sm"
              icon={ImagePlus}
              onClick={async () => {
                const files = await pickFiles(ACCEPTED_TYPES)
                if (files.length) await addFiles(collection.id, files)
              }}
            >
              <span className="hidden sm:inline">Add photos</span>
            </Button>
            <Menu
              label="Collection actions"
              trigger={(p) => <IconButton icon={MoreHorizontal} label="More" {...p} />}
              items={[
                { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(true) },
                {
                  label: 'Review & approvals',
                  icon: MessageSquare,
                  onSelect: () => setReviewOpen(true),
                },
                {
                  label: 'Revert all to original',
                  icon: RotateCcw,
                  onSelect: () => {
                    revertCollection(collection.id)
                    toast('Reverted to original. Undo is available in the editor.')
                  },
                },
                'divider',
                {
                  label: selected.length
                    ? `Remove ${plural(selected.length, 'photo')}`
                    : 'Remove selected photos',
                  icon: Trash2,
                  danger: true,
                  disabled: !selected.length,
                  onSelect: () => {
                    if (confirm(`Remove ${plural(selected.length, 'photo')} from this device?`)) {
                      void removePhotos(selected)
                      setSelected([])
                    }
                  },
                },
                {
                  label: 'Delete collection',
                  icon: Trash2,
                  danger: true,
                  onSelect: () => {
                    if (
                      confirm(
                        `Delete “${collection.name}” and its ${plural(photos.length, 'photo')}?`,
                      )
                    ) {
                      void deleteCollection(collection.id)
                      navigate({ name: 'library' }, true)
                    }
                  },
                },
              ]}
            />
          </>
        }
      />

      <div className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-20 border-b border-white/5 bg-ink/85 backdrop-blur-xl">
        <div className="scrollbar-none mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-3 py-2.5 sm:px-5">
          <Chip
            onClick={() =>
              setSelected(selected.length === photos.length ? [] : photos.map((p) => p.id))
            }
          >
            <CheckCircle2 className="size-4" />
            {selected.length === photos.length && photos.length ? 'None' : 'All'}
          </Chip>
          <Chip
            disabled={!seed}
            onClick={() =>
              seed && apply(selectSimilar(seed, selectable), 'similar to the last one you tapped')
            }
            title="Select photos that look like the last photo you tapped"
          >
            <ScanSearch className="size-4" />
            Similar
          </Chip>
          <Chip
            disabled={!seed}
            onClick={() => seed && apply(selectSameMoment(seed, selectable), 'same moment')}
          >
            <Copy className="size-4" />
            Same moment
          </Chip>
          <Chip onClick={() => setTimeOpen(true)}>
            <Clock className="size-4" />
            Time
          </Chip>
          <div className="relative">
            <Chip onClick={() => setSceneOpen((o) => !o)} aria-expanded={sceneOpen}>
              <Sparkles className="size-4" />
              Scene
            </Chip>
            {sceneOpen && (
              <div className="absolute top-full left-0 z-40 mt-2 w-52 rounded-2xl border border-white/10 bg-ink-2 p-1.5 shadow-2xl">
                {scenes.map(([scene, n]) => (
                  <button
                    key={scene}
                    type="button"
                    className="flex w-full justify-between rounded-xl px-3 py-2 text-sm hover:bg-white/8"
                    onClick={() => {
                      setSceneOpen(false)
                      apply(selectByScene(scene, selectable), SCENE_LABELS[scene])
                    }}
                  >
                    {SCENE_LABELS[scene]}
                    <span className="text-mute">{n}</span>
                  </button>
                ))}
                {!scenes.length && (
                  <p className="px-3 py-2 text-sm text-mute">No photos analyzed yet.</p>
                )}
              </div>
            )}
          </div>
          <span className="mx-1 h-5 w-px shrink-0 bg-white/10" />
          {palette.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={`Select photos with ${hex}`}
              title="Select photos with this color"
              onClick={() => apply(selectByColor(hex, selectable), 'by color')}
              className="size-7 shrink-0 rounded-full ring-2 ring-white/10 transition hover:scale-110 hover:ring-white/60"
              style={{ background: hex }}
            />
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-1.5 pt-2 sm:px-5">
        {!photos.length ? (
          <Empty icon={ImagePlus} title="No photos yet">
            Tap <strong>Add photos</strong> to import JPEG, PNG, WebP, AVIF or camera RAW files.
          </Empty>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
            {photos.map((p) => {
              const on = selectedSet.has(p.id)
              const batch = p.batchId ? batches[p.batchId] : undefined
              const individual = batch ? hasOverride(activeBranch(batch).photos[p.id]) : false
              const status = collection.review?.statuses[p.id]?.status
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${p.name}${on ? ', selected' : ''}`}
                  onClick={() => toggle(p.id)}
                  onDoubleClick={() => {
                    const batchId = openBatch(collection.id, [p.id])
                    navigate({ name: 'editor', batchId, view: 'single' })
                  }}
                  className={cx(
                    'relative aspect-square overflow-hidden rounded-xl transition duration-150 sm:rounded-2xl',
                    on ? 'ring-[3px] ring-white ring-offset-0' : 'hover:opacity-90',
                  )}
                >
                  <EditedThumb
                    photo={p}
                    className={cx(
                      'size-full transition-transform duration-200',
                      on && 'scale-[0.92] rounded-lg',
                    )}
                  />
                  {on && (
                    <span className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-brand text-[11px] font-bold text-white shadow">
                      {selected.indexOf(p.id) + 1}
                    </span>
                  )}
                  <span className="absolute bottom-1.5 left-1.5 flex gap-1">
                    {individual && (
                      <span
                        className="rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-salmon backdrop-blur"
                        title="Edited individually"
                      >
                        Individual
                      </span>
                    )}
                    {status && status !== 'pending' && (
                      <span
                        className={cx(
                          'rounded-full px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur',
                          status === 'approved'
                            ? 'bg-emerald-500/80 text-white'
                            : 'bg-black/60 text-white',
                        )}
                      >
                        {REVIEW_LABELS[status]}
                      </span>
                    )}
                    {p.raw && (
                      <span className="rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                        {p.raw.format}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </main>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-ink/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1 text-sm">
            {selected.length ? (
              <>
                <span className="font-semibold">{plural(selected.length, 'photo')} selected</span>
                <button
                  type="button"
                  className="ml-3 text-mute hover:text-white"
                  onClick={() => setSelected([])}
                >
                  Clear
                </button>
              </>
            ) : (
              <span className="text-mute">Select photos to edit them together</span>
            )}
          </div>
          <Button
            variant="primary"
            size="lg"
            icon={Wand2}
            disabled={!selected.length}
            onClick={edit}
          >
            Edit these images
          </Button>
        </div>
      </div>

      {timeOpen && (
        <TimeSheet
          open
          onClose={() => setTimeOpen(false)}
          photos={photos}
          onSelect={(ids) => apply(ids, 'time range')}
        />
      )}
      {reviewOpen && (
        <ReviewSheet collectionId={collection.id} open onClose={() => setReviewOpen(false)} />
      )}
    </div>
  )
}
