import { ImagePlus, Images, Plus, Settings, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { TopBar, Wordmark } from '../components/Chrome.tsx'
import { EditedThumb } from '../components/EditedThumb.tsx'
import { defaultCollectionName, plural, timeAgo } from '../lib/format.ts'
import { pickFiles } from '../lib/hooks.ts'
import { ACCEPTED_TYPES } from '../lib/importer.ts'
import { loadSamples } from '../lib/samples.ts'
import type { Collection } from '../lib/types.ts'
import { addFiles, createCollection, useLibrary } from '../state/library.ts'
import { navigate } from '../state/router.ts'
import { Button, IconButton } from '../ui/primitives.tsx'

export async function importIntoNewCollection(): Promise<void> {
  const files = await pickFiles(ACCEPTED_TYPES)
  if (!files.length) return
  const id = createCollection(defaultCollectionName())
  navigate({ name: 'collection', id })
  await addFiles(id, files)
}

function CollectionCard({ c }: { c: Collection }) {
  const photos = useLibrary((s) => s.photos)
  const cover = c.photoIds
    .slice(0, 4)
    .map((id) => photos[id])
    .filter((p) => !!p)
  return (
    <a
      href={`#/c/${c.id}`}
      className="group block rounded-[26px] bg-ink-2 p-2 transition duration-200 hover:bg-ink-3 focus-visible:bg-ink-3"
    >
      <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-[20px] bg-ink-3">
        {cover.map((p, i) => (
          <EditedThumb
            key={p.id}
            photo={p}
            maxEdge={360}
            className={
              cover.length === 1
                ? 'col-span-2 row-span-2 size-full'
                : cover.length === 2
                  ? 'row-span-2 size-full'
                  : cover.length === 3 && i === 0
                    ? 'row-span-2 size-full'
                    : 'size-full'
            }
          />
        ))}
        {!cover.length && (
          <div className="col-span-2 row-span-2 grid place-items-center text-mute-2">
            <Images className="size-8" />
          </div>
        )}
      </div>
      <div className="px-2 pt-3 pb-1.5">
        <h3 className="truncate font-display text-lg font-bold tracking-tight">{c.name}</h3>
        <p className="text-xs text-mute">
          {plural(c.photoIds.length, 'photo')} · {timeAgo(c.updatedAt)}
        </p>
      </div>
    </a>
  )
}

function Welcome() {
  const [loading, setLoading] = useState(false)
  return (
    <section className="relative mt-4 overflow-hidden rounded-[32px] bg-salmon px-6 pt-10 pb-8 text-ink sm:px-12 sm:pt-16 sm:pb-12">
      <h1 className="max-w-xl font-display text-[clamp(2.6rem,9vw,5.2rem)] leading-[0.92] font-extrabold tracking-[-0.04em] text-white">
        Edit <span className="text-brand">Multiple</span> photos at once.
      </h1>
      <p className="mt-5 max-w-md text-[15px] leading-relaxed font-medium text-ink/80">
        Bring in a set of photos, select the ones that belong together and give them one consistent
        look. Then fine-tune any single photo without losing the batch.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Button
          variant="primary"
          size="lg"
          icon={ImagePlus}
          onClick={() => void importIntoNewCollection()}
        >
          Import photos
        </Button>
        <Button
          variant="light"
          size="lg"
          disabled={loading}
          onClick={async () => {
            setLoading(true)
            try {
              const id = await loadSamples()
              navigate({ name: 'collection', id })
            } finally {
              setLoading(false)
            }
          }}
        >
          {loading ? 'Loading samples…' : 'Try the Spring Pink samples'}
        </Button>
      </div>
      <p className="mt-6 text-xs font-medium text-ink/60">
        Free and open source. Works offline. Your photos stay on this device.
      </p>
    </section>
  )
}

export function LibraryScreen() {
  const collections = useLibrary((s) => s.collections)
  const list = Object.values(collections).sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <div className="min-h-full">
      <TopBar
        left={
          <a href="#/" className="px-2" aria-label="Jumpman home">
            <Wordmark />
          </a>
        }
        right={
          <>
            <IconButton
              icon={Sparkles}
              label="Presets"
              onClick={() => navigate({ name: 'presets' })}
            />
            <IconButton
              icon={Settings}
              label="Settings"
              onClick={() => navigate({ name: 'settings' })}
            />
          </>
        }
      />
      <main className="mx-auto max-w-7xl px-4 pb-24 sm:px-5">
        {!list.length ? (
          <Welcome />
        ) : (
          <>
            <div className="mt-6 mb-4 flex items-end justify-between gap-3">
              <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">
                Collections
              </h1>
              <Button variant="primary" icon={Plus} onClick={() => void importIntoNewCollection()}>
                New
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {list.map((c) => (
                <CollectionCard key={c.id} c={c} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
