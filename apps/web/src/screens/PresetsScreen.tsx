import { forkPreset, type Preset, parsePreset, presetLayers } from '@jumpman/core'
import { ArrowLeft, Download, GitFork, Link2, Plus, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { TopBar } from '../components/Chrome.tsx'
import { RenderCanvas } from '../components/EditedThumb.tsx'
import { applyPreset, exportPresetFile, sharePresetLink } from '../editor/actions.ts'
import { frameOf } from '../lib/geometry.ts'
import { pickFiles } from '../lib/hooks.ts'
import { isNative } from '../lib/platform.ts'
import type { Photo } from '../lib/types.ts'
import { toast } from '../state/editor.ts'
import {
  addPreset,
  BUILTIN_PRESETS,
  deletePreset,
  importPresetLuts,
  useLibrary,
} from '../state/library.ts'
import { navigate } from '../state/router.ts'
import { Button, cx, Empty, IconButton, Segmented } from '../ui/primitives.tsx'

const GALLERY_URL = 'https://fzn0x.github.io/jumpman/presets/index.json'

/** Community presets bundled at build time, so the gallery also works offline. */
const BUNDLED: Preset[] = Object.values(
  import.meta.glob<unknown>('../../../../community/presets/*.json', {
    eager: true,
    import: 'default',
  }),
).flatMap((raw) => {
  try {
    return [parsePreset(raw)]
  } catch {
    return []
  }
})

function galleryUrls(): string[] {
  const urls: string[] = []
  if (!isNative() && /\/app\/?$/.test(location.pathname))
    urls.push(new URL('../presets/index.json', location.href).href)
  urls.push(GALLERY_URL)
  return urls
}

async function fetchGallery(): Promise<Preset[]> {
  let lastError: unknown
  for (const url of galleryUrls()) {
    try {
      const res = await fetch(url, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { presets?: unknown[] }
      return (json.presets ?? []).flatMap((p) => {
        try {
          return [parsePreset(p)]
        } catch {
          return []
        }
      })
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Gallery unavailable')
}

/** Photos to preview presets on: the most recently edited batch, else the newest collection. */
function usePreviewPhotos(): { photos: Photo[]; batchId: string | null } {
  const batches = useLibrary((s) => s.batches)
  const collections = useLibrary((s) => s.collections)
  const photos = useLibrary((s) => s.photos)
  return useMemo(() => {
    const batch = Object.values(batches).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (batch)
      return {
        photos: batch.photoIds.slice(0, 3).flatMap((id) => (photos[id] ? [photos[id]] : [])),
        batchId: batch.id,
      }
    const c = Object.values(collections).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    return {
      photos: (c?.photoIds ?? []).slice(0, 3).flatMap((id) => (photos[id] ? [photos[id]] : [])),
      batchId: null,
    }
  }, [batches, collections, photos])
}

export function PresetCard({
  preset,
  previews,
  batchId,
  owned,
}: {
  preset: Preset
  previews: Photo[]
  batchId: string | null
  owned?: boolean
}) {
  const author = useLibrary((s) => s.settings.author)
  const [ready, setReady] = useState(!preset.luts)
  useEffect(() => {
    if (preset.luts) void importPresetLuts(preset).then(() => setReady(true))
  }, [preset])
  const layers = presetLayers(preset)
  return (
    <article className="overflow-hidden rounded-3xl bg-ink-2">
      <div className="grid aspect-[3/1] grid-cols-3 gap-px bg-ink-3">
        {ready &&
          previews.map((p) => (
            <RenderCanvas
              key={p.id}
              photo={p}
              layers={layers}
              frame={frameOf(p, { layers: [], adaptive: false, aspect: '1:1' }, undefined)}
              maxEdge={240}
              className="size-full"
            />
          ))}
        {!previews.length && (
          <div className="col-span-3 grid place-items-center text-xs text-mute">
            Import photos to preview presets on them
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-lg font-bold">{preset.name}</h3>
            <p className="text-xs text-mute">
              by {preset.author ?? 'you'}
              {preset.forkedFrom && ` · remix of ${preset.forkedFrom.name}`}
            </p>
          </div>
          {owned && (
            <IconButton
              icon={Trash2}
              size="sm"
              label={`Delete ${preset.name}`}
              onClick={() => confirm(`Delete “${preset.name}”?`) && deletePreset(preset.id)}
            />
          )}
        </div>
        {preset.description && (
          <p className="mt-2 text-sm leading-relaxed text-white/80">{preset.description}</p>
        )}
        {!!preset.tags?.length && (
          <div className="mt-2 flex flex-wrap gap-1">
            {preset.tags.map((t) => (
              <span key={t} className="rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-mute">
                #{t}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {batchId && (
            <Button
              size="sm"
              variant="primary"
              icon={Wand2}
              onClick={async () => {
                await applyPreset(batchId, preset)
                navigate({ name: 'editor', batchId, view: 'single' })
              }}
            >
              Apply
            </Button>
          )}
          {!owned && (
            <Button
              size="sm"
              icon={Plus}
              onClick={() => {
                addPreset(preset)
                toast(`Saved “${preset.name}” to your presets`)
              }}
            >
              Save
            </Button>
          )}
          <Button
            size="sm"
            icon={GitFork}
            onClick={() => {
              const fork = forkPreset(preset, author || undefined)
              addPreset(fork)
              toast(`Forked as “${fork.name}”. Apply it, edit, then save your version.`)
            }}
          >
            Fork
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Link2}
            aria-label="Copy share link"
            onClick={() => void sharePresetLink(preset)}
          />
          <Button
            size="sm"
            variant="ghost"
            icon={Download}
            aria-label="Export file"
            onClick={() => void exportPresetFile(preset)}
          />
        </div>
      </div>
    </article>
  )
}

export function PresetsScreen() {
  const mine = useLibrary((s) => s.presets)
  const [tab, setTab] = useState<'community' | 'mine' | 'builtin'>('community')
  const [gallery, setGallery] = useState<Preset[]>(BUNDLED)
  const [fetched, setFetched] = useState(false)
  const { photos, batchId } = usePreviewPhotos()
  useEffect(() => {
    if (tab !== 'community' || fetched) return
    setFetched(true)
    fetchGallery()
      .then((remote) => {
        // Remote presets win; bundled ones fill the gaps.
        const ids = new Set(remote.map((p) => p.id))
        setGallery([...remote, ...BUNDLED.filter((p) => !ids.has(p.id))])
      })
      .catch(() => {
        // Offline: keep the bundled gallery.
      })
  }, [tab, fetched])

  const list = tab === 'mine' ? mine : tab === 'builtin' ? BUILTIN_PRESETS : gallery
  return (
    <div className="min-h-full pb-16">
      <TopBar
        left={
          <>
            <IconButton
              icon={ArrowLeft}
              label="Back"
              onClick={() => (history.length > 1 ? history.back() : navigate({ name: 'library' }))}
            />
            <h1 className="pl-1 font-display text-lg font-bold">Presets</h1>
          </>
        }
        right={
          <Button
            size="sm"
            icon={Plus}
            onClick={async () => {
              const [f] = await pickFiles('.json,application/json', false)
              if (!f) return
              try {
                const p = parsePreset(await f.text())
                addPreset(p)
                setTab('mine')
                toast(`Imported “${p.name}”`)
              } catch (e) {
                toast((e as Error).message)
              }
            }}
          >
            Import
          </Button>
        }
      />
      <main className="mx-auto max-w-6xl px-4 pt-4 sm:px-5">
        <Segmented
          label="Preset source"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'community', label: 'Community' },
            { value: 'mine', label: `Mine${mine.length ? ` · ${mine.length}` : ''}` },
            { value: 'builtin', label: 'Built-in' },
          ]}
        />
        {tab === 'community' && (
          <p className="mt-3 max-w-xl text-sm text-mute">
            Presets shared by the community through GitHub. Previewed on your own photos before you
            save them. Want to share yours?{' '}
            <a
              className="font-semibold text-salmon"
              href="https://github.com/fzn0x/jumpman/tree/main/community"
              target="_blank"
              rel="noreferrer"
            >
              Open a pull request
            </a>
            .
          </p>
        )}
        {tab === 'mine' && !mine.length && (
          <Empty icon={Plus} title="No presets yet">
            Save one from the editor (Looks → Save current), fork a community preset or import a
            file.
          </Empty>
        )}
        <div className={cx('mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3')}>
          {list.map((p) => (
            <PresetCard
              key={p.id}
              preset={p}
              previews={photos}
              batchId={batchId}
              owned={tab === 'mine'}
            />
          ))}
        </div>
      </main>
    </div>
  )
}
