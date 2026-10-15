import { aspectRatioOf, hexToRgb, rgbToHsl } from '@jumpman/core'
import { ArrowLeftRight, Download, Grid3x3, Palette, SunMoon } from 'lucide-react'
import { useState } from 'react'
import markUrl from '../assets/mark.svg'
import { RenderCanvas } from '../components/EditedThumb.tsx'
import { frameOf } from '../lib/geometry.ts'
import type { Photo } from '../lib/types.ts'
import { editor, toast } from '../state/editor.ts'
import { useLibrary } from '../state/library.ts'
import { layersFor } from '../state/selectors.ts'
import { Button, Chip, cx, Segmented } from '../ui/primitives.tsx'
import { type BatchContext, run } from './context.ts'
import { ExportSheet } from './EditorSheets.tsx'

const FORMATS = [
  { id: '4:5', label: 'Feed 4:5', size: 1350 },
  { id: '3:4', label: 'Grid 3:4', size: 1440 },
  { id: '1:1', label: 'Square', size: 1080 },
  { id: '9:16', label: 'Story 9:16', size: 1920 },
] as const

function Frame({
  ctx,
  photo,
  aspect,
  maxEdge,
}: {
  ctx: BatchContext
  photo: Photo
  aspect: string
  maxEdge: number
}) {
  const photos = useLibrary((s) => s.photos)
  const frame = frameOf(photo, { ...ctx.branch.global, aspect }, ctx.branch.photos[photo.id])
  return (
    <RenderCanvas
      photo={photo}
      layers={layersFor(ctx.batch, photos, photo.id)}
      frame={frame}
      maxEdge={maxEdge}
      className="size-full"
    />
  )
}

const hueOf = (p: Photo) => {
  const hex = p.stats?.palette[0]
  if (!hex) return 0
  const [h, s] = rgbToHsl(hexToRgb(hex))
  return s < 0.12 ? 400 : h
}

/** Platform-aware export: preview the batch as an Instagram grid or carousel, reorder, then export. */
export default function SocialView({ ctx }: { ctx: BatchContext }) {
  const [view, setView] = useState<'grid' | 'carousel'>('grid')
  const [format, setFormat] = useState<(typeof FORMATS)[number]>(FORMATS[0])
  const [order, setOrder] = useState<string[]>(ctx.batch.photoIds)
  const [picked, setPicked] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const collection = useLibrary((s) => s.collections[ctx.batch.collectionId])
  const byId = new Map(ctx.photos.map((p) => [p.id, p]))
  const list = order.map((id) => byId.get(id)).filter((p): p is Photo => !!p)
  const gridAspect = view === 'grid' ? '3:4' : format.id
  const ratio = aspectRatioOf(gridAspect) ?? 1

  const swap = (id: string) => {
    if (!picked) return setPicked(id)
    if (picked === id) return setPicked(null)
    const a = order.indexOf(picked)
    const b = order.indexOf(id)
    const next = [...order]
    next[a] = id
    next[b] = picked
    setOrder(next)
    setPicked(null)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-white/5 bg-ink/90 px-3 py-2.5 backdrop-blur-xl sm:px-5">
        <Segmented
          label="Preview"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'grid', label: 'Profile grid' },
            { value: 'carousel', label: 'Carousel' },
          ]}
        />
        {view === 'carousel' &&
          FORMATS.map((f) => (
            <Chip key={f.id} active={format.id === f.id} onClick={() => setFormat(f)}>
              {f.label}
            </Chip>
          ))}
      </div>

      <div className="mx-auto max-w-md px-3 py-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <Chip
            onClick={() => setOrder([...list].sort((a, b) => hueOf(a) - hueOf(b)).map((p) => p.id))}
          >
            <Palette className="size-4" /> Color flow
          </Chip>
          <Chip
            onClick={() => {
              const sorted = [...list].sort(
                (a, b) => (a.stats?.logAvgLum ?? 0) - (b.stats?.logAvgLum ?? 0),
              )
              const out: Photo[] = []
              while (sorted.length) {
                const bright = sorted.pop()
                if (bright) out.push(bright)
                const dark = sorted.shift()
                if (dark) out.push(dark)
              }
              setOrder(out.map((p) => p.id))
            }}
          >
            <SunMoon className="size-4" /> Light rhythm
          </Chip>
          <Chip onClick={() => setOrder(ctx.batch.photoIds)}>Reset order</Chip>
        </div>
        <p className="mb-3 flex items-center gap-1.5 text-xs text-mute">
          <ArrowLeftRight className="size-3.5" /> Tap two photos to swap them.
        </p>

        {view === 'grid' ? (
          <div className="overflow-hidden rounded-[28px] bg-black">
            <div className="flex items-center gap-4 px-4 pt-5 pb-4">
              <span className="grid size-16 place-items-center rounded-full bg-gradient-to-tr from-salmon to-brand p-[3px]">
                <span className="grid size-full place-items-center rounded-full bg-ink">
                  <img src={markUrl} alt="" className="w-8" />
                </span>
              </span>
              <div className="grid flex-1 grid-cols-3 text-center text-sm">
                <span>
                  <strong className="block">{list.length}</strong>
                  <span className="text-xs text-mute">posts</span>
                </span>
                <span>
                  <strong className="block">2.4k</strong>
                  <span className="text-xs text-mute">followers</span>
                </span>
                <span>
                  <strong className="block">180</strong>
                  <span className="text-xs text-mute">following</span>
                </span>
              </div>
            </div>
            <div className="px-4 pb-3 text-sm font-semibold">{collection?.name ?? 'Preview'}</div>
            <div className="flex justify-center border-t border-white/10 py-2 text-white">
              <Grid3x3 className="size-5" />
            </div>
            <div className="grid grid-cols-3 gap-0.5">
              {list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => swap(p.id)}
                  aria-pressed={picked === p.id}
                  aria-label={`Swap ${p.name}`}
                  className={cx(
                    'relative bg-ink-2',
                    picked === p.id && 'z-10 ring-[3px] ring-brand',
                  )}
                  style={{ aspectRatio: '3 / 4' }}
                >
                  <Frame ctx={ctx} photo={p} aspect="3:4" maxEdge={420} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto rounded-2xl bg-black">
              {list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => swap(p.id)}
                  aria-label={`Swap ${p.name}`}
                  className={cx(
                    'w-full shrink-0 snap-center',
                    picked === p.id && 'outline-[3px] outline-brand',
                  )}
                  style={{ aspectRatio: `${ratio}` }}
                >
                  <Frame ctx={ctx} photo={p} aspect={format.id} maxEdge={900} />
                </button>
              ))}
            </div>
            <div className="mt-2 flex justify-center gap-1.5">
              {list.map((p) => (
                <span key={p.id} className="size-1.5 rounded-full bg-white/40" />
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 grid gap-2 pb-8">
          <Button variant="primary" size="lg" icon={Download} onClick={() => setExporting(true)}>
            Export {list.length} for Instagram
          </Button>
          <Button
            onClick={() => {
              run(ctx, { type: 'setAspect', aspect: gridAspect })
              toast(`The batch now uses ${gridAspect}. Reposition photos in Crop.`)
              editor.set({ tab: 'crop' })
            }}
          >
            Use {gridAspect} crop in the editor
          </Button>
        </div>
      </div>
      {exporting && (
        <ExportSheet
          ctx={ctx}
          photoIds={list.map((p) => p.id)}
          preset={{
            aspect: gridAspect,
            maxEdge: view === 'grid' ? 1440 : format.size,
            pattern: '{n:2}-{collection}',
          }}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  )
}
