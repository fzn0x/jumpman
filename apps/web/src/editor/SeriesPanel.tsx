import { describeShift, gradualShift, hasOverride, type PhotoOverride } from '@jumpman/core'
import { ArrowRight, Sunrise, Waves } from 'lucide-react'
import { useState } from 'react'
import { EditedThumb } from '../components/EditedThumb.tsx'
import { dateTime } from '../lib/format.ts'
import { editor, toast } from '../state/editor.ts'
import { undo } from '../state/library.ts'
import { Button, cx, SectionTitle, Slider } from '../ui/primitives.tsx'
import { type BatchContext, run } from './context.ts'
import { runTool } from './tools.ts'

export default function SeriesPanel({ ctx }: { ctx: BatchContext }) {
  const [radius, setRadius] = useState(3)
  const ordered = [...ctx.photos].sort(
    (a, b) => (a.takenAt ?? a.addedAt) - (b.takenAt ?? b.addedAt),
  )
  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  const firstO: PhotoOverride = (first && ctx.branch.photos[first.id]?.override) || {}
  const lastO: PhotoOverride = (last && ctx.branch.photos[last.id]?.override) || {}
  const ready =
    !!first &&
    !!last &&
    first !== last &&
    (hasOverride({ override: firstO }) || hasOverride({ override: lastO }))
  const goTo = (id: string | undefined) => {
    const i = ctx.photos.findIndex((p) => p.id === id)
    if (i >= 0) editor.set({ index: i, mode: 'individual', tab: 'adjust' })
  }
  const build = () => {
    const shifts = gradualShift(firstO, lastO, ordered.length)
    const overrides: Record<string, PhotoOverride> = {}
    ordered.forEach((p, i) => {
      const crop = ctx.branch.photos[p.id]?.override.crop
      overrides[p.id] = { ...shifts[i], ...(crop ? { crop } : {}) }
    })
    run(ctx, { type: 'setOverrides', overrides })
    toast(`Built a gradual shift across ${ordered.length} photos`, {
      label: 'Undo',
      run: () => undo(ctx.batch.id),
    })
  }
  if (ordered.length < 2)
    return <p className="p-6 text-sm text-mute">Series tools need at least two photos.</p>
  return (
    <div className="h-full overflow-y-auto px-4 pt-2 pb-6">
      <SectionTitle>Sequence · by capture time</SectionTitle>
      <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4">
        {ordered.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => editor.set({ index: ctx.photos.indexOf(p) })}
            className={cx(
              'relative shrink-0 overflow-hidden rounded-lg',
              ctx.current?.id === p.id && 'ring-2 ring-white',
            )}
            title={p.takenAt ? dateTime(p.takenAt) : p.name}
          >
            <EditedThumb photo={p} maxEdge={120} className="h-14 w-14" />
            <span className="absolute bottom-0.5 left-1 text-[10px] font-bold drop-shadow">
              {i + 1}
            </span>
          </button>
        ))}
      </div>

      <SectionTitle>
        <span className="flex items-center gap-1.5">
          <Waves className="size-3.5" /> Flatten flicker
        </span>
      </SectionTitle>
      <p className="text-xs leading-relaxed text-mute">
        For time-lapses and bursts: evens out frame-to-frame brightness jumps while keeping the
        slow, natural change.
      </p>
      <Slider
        label="Smoothing window"
        value={radius}
        min={1}
        max={8}
        format={(v) => `±${v} frames`}
        onChange={setRadius}
      />
      <Button
        className="w-full"
        icon={Waves}
        onClick={() => {
          runTool(ctx.batch.id, 'deflicker', { radius })
          editor.record({ kind: 'tool', tool: 'deflicker' })
          toast('Deflickered the sequence', { label: 'Undo', run: () => undo(ctx.batch.id) })
        }}
      >
        Deflicker
      </Button>

      <SectionTitle>
        <span className="flex items-center gap-1.5">
          <Sunrise className="size-3.5" /> Gradual shift
        </span>
      </SectionTitle>
      <p className="text-xs leading-relaxed text-mute">
        Give the first and last photo their own look in{' '}
        <strong className="text-white">Individual</strong> mode. Jumpman blends every photo in
        between, from the first look to the last.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => goTo(first?.id)}
          className="flex-1 rounded-2xl bg-ink-2 p-2 text-left hover:bg-ink-3"
        >
          {first && (
            <EditedThumb
              photo={first}
              maxEdge={160}
              className="mb-1.5 aspect-[4/3] w-full rounded-xl"
            />
          )}
          <span className="block text-xs font-semibold">First photo</span>
          <span className="block truncate text-[11px] text-mute">
            {describeShift(firstO, {}) || 'Tap to edit'}
          </span>
        </button>
        <ArrowRight className="size-5 shrink-0 text-mute" />
        <button
          type="button"
          onClick={() => goTo(last?.id)}
          className="flex-1 rounded-2xl bg-ink-2 p-2 text-left hover:bg-ink-3"
        >
          {last && (
            <EditedThumb
              photo={last}
              maxEdge={160}
              className="mb-1.5 aspect-[4/3] w-full rounded-xl"
            />
          )}
          <span className="block text-xs font-semibold">Last photo</span>
          <span className="block truncate text-[11px] text-mute">
            {describeShift({}, lastO) || 'Tap to edit'}
          </span>
        </button>
      </div>
      <Button
        variant="primary"
        className="mt-3 w-full"
        icon={Sunrise}
        disabled={!ready}
        onClick={build}
      >
        Build gradual shift
      </Button>
    </div>
  )
}
