import {
  classifyScene,
  createLayer,
  defaultBasic,
  defaultHsl,
  defaultSplit,
  describeToEdit,
  type HslParams,
  SCENE_LABELS,
} from '@jumpman/core'
import { Crosshair, MessageSquareText, Scale, ScanEye, Sparkles, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EditedThumb } from '../components/EditedThumb.tsx'
import { editor, toast } from '../state/editor.ts'
import { undo, useLibrary } from '../state/library.ts'
import { batchConsistency } from '../state/selectors.ts'
import { Button, Chip, cx, SectionTitle, Switch } from '../ui/primitives.tsx'
import { type BatchContext, run } from './context.ts'
import { runTool } from './tools.ts'

function Meter({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="font-semibold">{label}</span>
        <span className="text-mute">{detail}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-3">
        <div
          className={cx(
            'h-full rounded-full transition-[width] duration-500',
            value > 80 ? 'bg-emerald-400' : value > 55 ? 'bg-amber-300' : 'bg-brand',
          )}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  )
}

const SUGGESTIONS = [
  'warmer, softer highlights, slightly faded',
  'moody and cinematic',
  'bright and airy',
  'teal and orange',
  'black and white, punchy',
  'spring pink',
]

function Describe({ ctx }: { ctx: BatchContext }) {
  const [text, setText] = useState('')
  const result = useMemo(() => (text.trim() ? describeToEdit(text) : null), [text])
  const apply = () => {
    if (!result) return
    const name = `“${text.trim().slice(0, 40)}”`
    const layers = []
    if (Object.keys(result.basic).length)
      layers.push(createLayer('basic', { name, params: { ...defaultBasic(), ...result.basic } }))
    if (result.split)
      layers.push(
        createLayer('split', {
          name: `${name} toning`,
          params: { ...defaultSplit(), ...result.split },
        }),
      )
    if (result.hsl) {
      const hsl = defaultHsl()
      for (const [band, v] of Object.entries(result.hsl)) if (v) hsl[band as keyof HslParams] = v
      layers.push(createLayer('hsl', { name: `${name} color`, params: hsl }))
    }
    if (!layers.length)
      return toast('Nothing to apply yet. Try words like warmer, brighter or faded.')
    for (const layer of layers) run(ctx, { type: 'addLayer', layer, scope: ctx.scope })
    const first = layers[0]
    if (first?.kind === 'basic') editor.set({ layerId: first.id })
    toast(
      `Added ${layers.length} layer${layers.length > 1 ? 's' : ''}. Tweak them in Adjust or Layers.`,
    )
    setText('')
  }
  return (
    <div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          placeholder="warmer, softer highlights, slightly faded"
          aria-label="Describe the edit"
          className="h-11 min-w-0 flex-1 rounded-2xl bg-ink-2 px-4 text-sm outline-none placeholder:text-mute-2 focus:ring-2 focus:ring-salmon"
        />
        <Button
          variant="primary"
          className="h-11"
          disabled={!result?.matched.length}
          onClick={apply}
        >
          Apply
        </Button>
      </div>
      {result ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {result.matched.map((m) => (
            <span key={m.phrase + m.effect} className="rounded-full bg-white/8 px-2.5 py-1 text-xs">
              <span className="text-mute">{m.phrase}</span> → {m.effect}
            </span>
          ))}
          {result.unmatched.map((u) => (
            <span
              key={u}
              className="rounded-full bg-brand/15 px-2.5 py-1 text-xs text-salmon"
              title="Not understood"
            >
              {u}?
            </span>
          ))}
        </div>
      ) : (
        <div className="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto">
          {SUGGESTIONS.map((s) => (
            <Chip key={s} onClick={() => setText(s)}>
              {s}
            </Chip>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-mute-2">
        Runs entirely on your device. Applies to{' '}
        {ctx.mode === 'global' ? 'the whole batch' : 'this photo'}.
      </p>
    </div>
  )
}

export default function AutoPanel({ ctx }: { ctx: BatchContext }) {
  const photos = useLibrary((s) => s.photos)
  const [exposure, setExposure] = useState(true)
  const [wb, setWb] = useState(true)
  const c = batchConsistency(ctx.batch, photos)
  const analyzed = ctx.photos.filter((p) => p.stats)
  const scene = useMemo(() => {
    const n = Math.max(1, analyzed.length)
    const sum = { sky: 0, foliage: 0, skin: 0, neutral: 0 }
    for (const p of analyzed) {
      if (!p.stats) continue
      sum.sky += p.stats.scene.sky
      sum.foliage += p.stats.scene.foliage
      sum.skin += p.stats.scene.skin
      sum.neutral += p.stats.scene.neutral
    }
    return {
      sky: sum.sky / n,
      foliage: sum.foliage / n,
      skin: sum.skin / n,
      neutral: sum.neutral / n,
    }
  }, [analyzed])
  const undoable = (text: string) => toast(text, { label: 'Undo', run: () => undo(ctx.batch.id) })
  const tool = (
    name: Parameters<typeof runTool>[1],
    msg: string,
    opts?: Parameters<typeof runTool>[2],
  ) => {
    runTool(ctx.batch.id, name, opts)
    if (
      name === 'autoMatch' ||
      name === 'harmonize' ||
      name === 'sceneAuto' ||
      name === 'deflicker'
    )
      editor.record({ kind: 'tool', tool: name })
    undoable(msg)
  }

  return (
    <div className="h-full overflow-y-auto px-4 pt-2 pb-6">
      <SectionTitle>Consistency</SectionTitle>
      <div className="rounded-3xl bg-ink-2 p-4">
        <div className="flex items-center gap-4">
          <div className="relative grid size-20 shrink-0 place-items-center">
            <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke="var(--color-ink-3)"
                strokeWidth="3"
              />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke={c.score > 80 ? '#34d399' : c.score > 55 ? '#fcd34d' : 'var(--color-brand)'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${(c.score / 100) * 97.4} 97.4`}
                className="transition-[stroke-dasharray] duration-700"
              />
            </svg>
            <span className="font-display text-2xl font-extrabold tabular-nums">{c.score}</span>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <Meter label="Exposure" value={c.exposure.score} detail={`±${c.exposure.spread} EV`} />
            <Meter
              label="Color temp"
              value={c.temperature.score}
              detail={`±${Math.round(c.temperature.spread)}`}
            />
            <Meter
              label="Contrast"
              value={c.contrast.score}
              detail={`±${Math.round(c.contrast.spread)}%`}
            />
          </div>
        </div>
        {c.outliers.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-mute">Stand out:</span>
            {c.outliers.slice(0, 5).map((i) => {
              const p = ctx.photos.find((x) => x.id === ctx.batch.photoIds[i])
              if (!p) return null
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-label={`Go to ${p.name}`}
                  onClick={() => editor.set({ index: ctx.photos.indexOf(p) })}
                >
                  <EditedThumb photo={p} maxEdge={96} className="size-9 rounded-lg" />
                </button>
              )
            })}
          </div>
        )}
        <Button
          variant="primary"
          icon={Scale}
          className="mt-4 w-full"
          disabled={analyzed.length < 2}
          onClick={() => tool('harmonize', 'Harmonized exposure, color, contrast and saturation')}
        >
          Harmonize
        </Button>
      </div>

      <SectionTitle>Mixed lighting</SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Chip active={exposure} onClick={() => setExposure(!exposure)}>
          Exposure
        </Chip>
        <Chip active={wb} onClick={() => setWb(!wb)}>
          White balance
        </Chip>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          icon={Wand2}
          disabled={!exposure && !wb}
          onClick={() =>
            tool('autoMatch', 'Auto-matched the batch', { exposure, whiteBalance: wb })
          }
        >
          Auto-match
        </Button>
        <Button
          icon={Crosshair}
          disabled={!ctx.current}
          onClick={() => {
            runTool(ctx.batch.id, 'referenceMatch', { heroId: (ctx.current as { id: string }).id })
            undoable(`Matched the batch to ${ctx.current?.name}`)
          }}
        >
          Match to this
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-mute-2">
        “Match to this” uses the photo on screen as the hero: the rest of the batch adopts its tone
        and color.
      </p>
      <button
        type="button"
        className="mt-1 text-xs font-semibold text-salmon"
        onClick={() => tool('clearNorms', 'Cleared auto corrections')}
      >
        Clear auto corrections
      </button>

      <div className="mt-3 rounded-2xl bg-ink-2 px-4 py-1">
        <Switch
          label="Adaptive global edits"
          description="Exposure targets a brightness instead of adding an offset: +0.6 means “bring every photo to this level”."
          checked={ctx.branch.global.adaptive}
          onChange={(v) => run(ctx, { type: 'setAdaptive', value: v })}
        />
      </div>

      <SectionTitle>Scene-aware auto edit</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['Sky', scene.sky],
            ['Foliage', scene.foliage],
            ['Skin', scene.skin],
            ['Architecture', scene.neutral],
          ] as const
        ).map(([label, v]) => (
          <span
            key={label}
            className={cx(
              'rounded-full px-2.5 py-1 text-xs',
              v > 0.05 ? 'bg-white/10' : 'bg-white/4 text-mute-2',
            )}
          >
            {label} {Math.round(v * 100)}%
          </span>
        ))}
        {ctx.current?.stats && (
          <span className="rounded-full bg-salmon/15 px-2.5 py-1 text-xs text-salmon">
            This photo: {SCENE_LABELS[classifyScene(ctx.current.stats).primary]}
          </span>
        )}
      </div>
      <Button
        icon={ScanEye}
        className="mt-3 w-full"
        onClick={() => tool('sceneAuto', 'Added scene-aware layers')}
      >
        Apply scene edit
      </Button>

      <SectionTitle>
        <span className="flex items-center gap-1.5">
          <MessageSquareText className="size-3.5" /> Edit by description
        </span>
      </SectionTitle>
      <Describe ctx={ctx} />
      <p className="mt-6 flex items-center gap-1.5 text-[11px] text-mute-2">
        <Sparkles className="size-3" /> All smart tools run locally on your device.
      </p>
    </div>
  )
}
