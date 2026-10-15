import { ASPECT_RATIOS, type CropPlacement } from '@jumpman/core'
import { FlipHorizontal2, RotateCcw, RotateCw } from 'lucide-react'
import { placementOf } from '../lib/geometry.ts'
import { commit, dispatch } from '../state/library.ts'
import { Button, cx, SectionTitle, Slider } from '../ui/primitives.tsx'
import { type BatchContext, run } from './context.ts'

export default function CropPanel({ ctx }: { ctx: BatchContext }) {
  const photo = ctx.current
  if (!photo) return null
  const p = placementOf(ctx.state)
  const aspect = ctx.branch.global.aspect
  const setCrop = (placement: Partial<CropPlacement>, transient = false) =>
    dispatch(ctx.batch.id, { type: 'setCrop', photoId: photo.id, placement }, { transient })
  return (
    <div className="h-full overflow-y-auto px-4 pt-2 pb-6">
      <SectionTitle>Aspect ratio · whole batch</SectionTitle>
      <div className="grid grid-cols-5 gap-2">
        {ASPECT_RATIOS.map((a) => {
          const r = a.ratio ?? photo.width / photo.height
          const w = r >= 1 ? 26 : 26 * r
          const h = r >= 1 ? 26 / r : 26
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={aspect === a.id}
              title={a.hint ?? a.label}
              onClick={() => run(ctx, { type: 'setAspect', aspect: a.id })}
              className={cx(
                'flex flex-col items-center gap-1.5 rounded-2xl py-2.5 text-[11px] font-semibold transition',
                aspect === a.id ? 'bg-white text-ink' : 'bg-ink-2 text-mute hover:text-white',
              )}
            >
              <span className="grid h-7 place-items-center">
                <span
                  className="rounded-[3px] border-2 border-current"
                  style={{ width: w, height: h }}
                />
              </span>
              {a.label}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-mute">
        {ASPECT_RATIOS.find((a) => a.id === aspect)?.hint ?? 'Every photo keeps its own shape.'}
      </p>

      <SectionTitle>This photo</SectionTitle>
      <p className="mb-2 text-xs leading-relaxed text-mute">
        Drag the frame on the photo to reposition it. Use the dots to move between photos.
      </p>
      <Slider
        label="Zoom"
        value={p.zoom}
        min={1}
        max={4}
        step={0.01}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => setCrop({ zoom: v }, true)}
        onCommit={() => commit(ctx.batch.id)}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" icon={RotateCcw} onClick={() => setCrop({ rotate: (p.rotate + 3) % 4 })}>
          Rotate left
        </Button>
        <Button size="sm" icon={RotateCw} onClick={() => setCrop({ rotate: (p.rotate + 1) % 4 })}>
          Rotate right
        </Button>
        <Button size="sm" icon={FlipHorizontal2} onClick={() => setCrop({ flipH: !p.flipH })}>
          Flip
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCrop({ cx: 0.5, cy: 0.5, zoom: 1, rotate: 0, flipH: false })}
        >
          Reset
        </Button>
      </div>
    </div>
  )
}
