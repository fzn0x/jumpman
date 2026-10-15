import {
  BASE_LAYER_ID,
  cloneLayer,
  createLayer,
  defaultBasic,
  LAYER_LABELS,
  type Layer,
  type Mask,
  type MaskType,
} from '@jumpman/core'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Circle,
  Copy,
  Eye,
  EyeOff,
  type LucideIcon,
  Palette,
  Pencil,
  Plus,
  Spline,
  SquareDashed,
  SunMedium,
  SwatchBook,
  Trash2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { editor, useEditor } from '../state/editor.ts'
import { Menu } from '../ui/Menu.tsx'
import { Button, Chip, cx, Slider, Switch } from '../ui/primitives.tsx'
import { type BatchContext, finish, run, scopeLayers } from './context.ts'

const KIND_ICON: Record<Layer['kind'], LucideIcon> = {
  basic: SunMedium,
  curves: Spline,
  hsl: Palette,
  split: Circle,
  lut: SwatchBook,
}

const MASK_LABELS: Record<MaskType | 'none', string> = {
  none: 'None',
  radial: 'Radial',
  linear: 'Linear',
  luminance: 'Brightness',
  color: 'Color range',
  sky: 'Sky',
  subject: 'Subject',
}

export function defaultMask(type: MaskType, ctx: BatchContext): Mask {
  switch (type) {
    case 'radial':
      return { type, cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, feather: 0.5 }
    case 'linear':
      return { type, x0: 0.5, y0: 0, x1: 0.5, y1: 0.6 }
    case 'luminance':
      return { type, min: 0.6, max: 1, feather: 0.15 }
    case 'color': {
      const hex = ctx.current?.stats?.palette[0] ?? '#ff8080'
      const n = Number.parseInt(hex.slice(1), 16)
      const r = (n >> 16) & 255
      const g = (n >> 8) & 255
      const b = n & 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      let h = 0
      if (max !== min) {
        if (max === r) h = ((g - b) / (max - min)) * 60
        else if (max === g) h = ((b - r) / (max - min)) * 60 + 120
        else h = ((r - g) / (max - min)) * 60 + 240
      }
      return { type, hue: (h + 360) % 360, range: 25, feather: 0.5 }
    }
    case 'sky':
      return { type }
    case 'subject':
      return { type, size: 0.55 }
  }
}

function describe(layer: Layer): string {
  const parts = layer.name === LAYER_LABELS[layer.kind] ? [] : [LAYER_LABELS[layer.kind]]
  if (layer.opacity < 1) parts.push(`${Math.round(layer.opacity * 100)}%`)
  if (layer.mask) parts.push(`${MASK_LABELS[layer.mask.type]} mask`)
  return parts.join(' · ') || 'Whole photo'
}

function MaskEditor({ ctx, layer, own }: { ctx: BatchContext; layer: Layer; own: boolean }) {
  const maskLayerId = useEditor((s) => s.maskLayerId)
  const editable = own || ctx.mode === 'global'
  const scope =
    own && ctx.current ? ({ kind: 'photo', photoId: ctx.current.id } as const) : ctx.scope
  const m = layer.mask
  const set = (mask: Mask | null, transient = false) =>
    run(ctx, { type: 'updateLayer', layerId: layer.id, patch: { mask }, scope }, transient)
  if (!editable) {
    return (
      <p className="text-xs text-mute">Switch to Global to change the mask of a batch layer.</p>
    )
  }
  const num = (
    label: string,
    key: string,
    min: number,
    max: number,
    step = 0.01,
    fmt?: (v: number) => string,
  ) => (
    <Slider
      label={label}
      value={(m as Record<string, number> | undefined)?.[key] ?? 0}
      min={min}
      max={max}
      step={step}
      format={fmt ?? ((v) => `${Math.round(v * 100)}%`)}
      onChange={(v) => m && set({ ...m, [key]: v } as Mask, true)}
      onCommit={() => finish(ctx)}
    />
  )
  return (
    <div>
      <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {(['none', 'radial', 'linear', 'luminance', 'color', 'sky', 'subject'] as const).map(
          (t) => (
            <Chip
              key={t}
              active={(m?.type ?? 'none') === t}
              onClick={() => {
                set(t === 'none' ? null : defaultMask(t, ctx))
                editor.set({ maskLayerId: t === 'radial' || t === 'linear' ? layer.id : null })
              }}
            >
              {MASK_LABELS[t]}
            </Chip>
          ),
        )}
      </div>
      {m?.type === 'radial' && (
        <>
          {num('Feather', 'feather', 0, 1)}
          {num('Width', 'rx', 0.02, 1)}
          {num('Height', 'ry', 0.02, 1)}
        </>
      )}
      {m?.type === 'luminance' && (
        <>
          {num('From', 'min', 0, 1)}
          {num('To', 'max', 0, 1)}
          {num('Feather', 'feather', 0, 0.5)}
        </>
      )}
      {m?.type === 'color' && (
        <>
          <Slider
            label="Hue"
            value={m.hue}
            min={0}
            max={360}
            format={(v) => `${Math.round(v)}°`}
            track="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
            onChange={(v) => set({ ...m, hue: v }, true)}
            onCommit={() => finish(ctx)}
          />
          {num('Range', 'range', 1, 90, 1, (v) => `±${Math.round(v)}°`)}
          {num('Feather', 'feather', 0, 1)}
        </>
      )}
      {m?.type === 'subject' && num('Size', 'size', 0.1, 1.2)}
      {m?.type === 'sky' && (
        <p className="py-1 text-xs leading-relaxed text-mute">
          Finds sky-like colors toward the top of each photo, so it adapts to every image in the
          batch.
        </p>
      )}
      {m && (
        <>
          <Switch label="Invert" checked={!!m.invert} onChange={(v) => set({ ...m, invert: v })} />
          {(m.type === 'radial' || m.type === 'linear') && (
            <Button
              size="sm"
              icon={SquareDashed}
              variant={maskLayerId === layer.id ? 'light' : 'secondary'}
              onClick={() =>
                editor.set({ maskLayerId: maskLayerId === layer.id ? null : layer.id })
              }
            >
              {maskLayerId === layer.id ? 'Done positioning' : 'Position on photo'}
            </Button>
          )}
        </>
      )}
    </div>
  )
}

function LayerRow({
  ctx,
  layer,
  own,
  hidden,
  index,
  count,
}: {
  ctx: BatchContext
  layer: Layer
  own: boolean
  hidden: boolean
  index: number
  count: number
}) {
  const [open, setOpen] = useState(false)
  const selected = useEditor((s) => s.layerId === layer.id)
  const Icon = KIND_ICON[layer.kind]
  const photoScope = ctx.current ? ({ kind: 'photo', photoId: ctx.current.id } as const) : ctx.scope
  const scope = own ? photoScope : ctx.scope
  const visible = layer.enabled && !hidden
  const opacity =
    !own && ctx.mode === 'individual'
      ? (ctx.state?.override.opacity?.[layer.id] ?? layer.opacity)
      : layer.opacity
  const isBase = layer.id === BASE_LAYER_ID
  const canStructure = own || ctx.mode === 'global'

  const edit = () => {
    if (layer.kind === 'basic') editor.set({ tab: 'adjust', layerId: layer.id })
    else if (layer.kind === 'lut') editor.set({ tab: 'looks', layerId: layer.id })
    else editor.set({ tab: 'color', colorTool: layer.kind, layerId: layer.id })
  }

  if (layer.proposedBy) {
    return (
      <li className="rounded-2xl border border-dashed border-salmon/60 bg-salmon/5 p-3">
        <div className="flex items-center gap-3">
          <Icon className="size-5 text-salmon" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{layer.name}</div>
            <div className="text-xs text-mute">Suggested by {layer.proposedBy}</div>
          </div>
          <Button
            size="sm"
            variant="primary"
            icon={Check}
            onClick={() => run(ctx, { type: 'acceptProposal', layerId: layer.id, scope })}
          >
            Accept
          </Button>
          <Button
            size="sm"
            icon={X}
            aria-label="Reject"
            onClick={() => run(ctx, { type: 'removeLayer', layerId: layer.id, scope })}
          />
        </div>
      </li>
    )
  }

  return (
    <li
      className={cx(
        'rounded-2xl transition',
        selected ? 'bg-white/10' : 'bg-ink-2',
        !visible && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-1 p-1.5">
        <button
          type="button"
          aria-label={visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
          aria-pressed={visible}
          onClick={() =>
            run(ctx, {
              type: 'updateLayer',
              layerId: layer.id,
              patch: { enabled: !visible },
              scope: own ? photoScope : ctx.scope,
            })
          }
          className="grid size-9 shrink-0 place-items-center rounded-full text-mute hover:bg-white/10 hover:text-white"
        >
          {visible ? <Eye className="size-[18px]" /> : <EyeOff className="size-[18px]" />}
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left"
        >
          <span
            className={cx(
              'grid size-9 shrink-0 place-items-center rounded-xl',
              layer.kind === 'lut' ? 'bg-salmon/20 text-salmon' : 'bg-white/8',
            )}
          >
            <Icon className="size-[18px]" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {layer.name}
              {own && (
                <span className="ml-2 rounded-full bg-salmon/20 px-1.5 py-0.5 text-[10px] font-bold text-salmon">
                  This photo
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-mute">
              {describe({ ...layer, opacity } as Layer)}
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-label={`Edit ${layer.name}`}
          onClick={edit}
          className="grid size-9 shrink-0 place-items-center rounded-full text-mute hover:bg-white/10 hover:text-white"
        >
          <Pencil className="size-[17px]" />
        </button>
        {!isBase && (
          <button
            type="button"
            aria-label={`Delete ${layer.name}`}
            onClick={() => {
              run(ctx, { type: 'removeLayer', layerId: layer.id, scope })
              if (useEditor.getState().layerId === layer.id)
                editor.set({ layerId: BASE_LAYER_ID, maskLayerId: null })
            }}
            className="grid size-9 shrink-0 place-items-center rounded-full text-mute hover:bg-[#ff6b6b]/15 hover:text-[#ff6b6b]"
          >
            <Trash2 className="size-[17px]" />
          </button>
        )}
        <ChevronDown
          className={cx('mr-1 size-4 shrink-0 text-mute transition', open && 'rotate-180')}
        />
      </div>
      {open && (
        <div className="space-y-1 px-3 pb-3">
          <Slider
            label="Opacity"
            value={Math.round(opacity * 100)}
            min={0}
            max={100}
            format={(v) => `${v}%`}
            onChange={(v) =>
              run(
                ctx,
                { type: 'updateLayer', layerId: layer.id, patch: { opacity: v / 100 }, scope },
                true,
              )
            }
            onCommit={() => finish(ctx)}
          />
          {!isBase && <MaskEditor ctx={ctx} layer={layer} own={own} />}
          {canStructure && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                icon={ArrowUp}
                disabled={index === count - 1}
                onClick={() =>
                  run(ctx, { type: 'moveLayer', layerId: layer.id, toIndex: index + 1, scope })
                }
              >
                Up
              </Button>
              <Button
                size="sm"
                icon={ArrowDown}
                disabled={index === 0}
                onClick={() =>
                  run(ctx, { type: 'moveLayer', layerId: layer.id, toIndex: index - 1, scope })
                }
              >
                Down
              </Button>
              <Button
                size="sm"
                icon={Copy}
                onClick={() => {
                  const copy = { ...cloneLayer(layer, true), name: `${layer.name} copy` }
                  run(ctx, { type: 'addLayer', layer: copy, scope, index: index + 1 })
                }}
              >
                Duplicate
              </Button>
              <Button
                size="sm"
                icon={Pencil}
                onClick={() => {
                  const name = prompt('Layer name', layer.name)?.trim()
                  if (name)
                    run(ctx, { type: 'updateLayer', layerId: layer.id, patch: { name }, scope })
                }}
              >
                Rename
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export default function LayersPanel({ ctx }: { ctx: BatchContext }) {
  const layers = scopeLayers(ctx)
  const globalCount = ctx.branch.global.layers.length
  const ownCount = layers.length - globalCount
  const add = (layer: Layer) => {
    const scope = ctx.scope
    run(ctx, { type: 'addLayer', layer, scope })
    if (layer.kind === 'basic') editor.set({ layerId: layer.id })
  }
  const autoNorm = ctx.state?.norm || ctx.branch.global.adaptive
  return (
    <div className="h-full overflow-y-auto px-4 pt-3 pb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-mute">
          {ctx.mode === 'global' ? (
            <>
              Changes apply to all{' '}
              <strong className="text-white">{ctx.photos.length} photos</strong>.
            </>
          ) : (
            <>
              Fine-tuning <strong className="text-white">{ctx.current?.name}</strong> only.
            </>
          )}
        </p>
        <Menu
          label="Add layer"
          trigger={(p) => (
            <Button size="sm" variant="primary" icon={Plus} {...p}>
              Add layer
            </Button>
          )}
          items={[
            {
              label: 'Local adjust (radial mask)',
              icon: SquareDashed,
              onSelect: () => {
                const layer = createLayer('basic', {
                  name: 'Local adjust',
                  params: { ...defaultBasic(), exposure: 0.3 },
                  mask: defaultMask('radial', ctx),
                })
                add(layer)
                editor.set({ maskLayerId: layer.id })
              },
            },
            { label: 'Adjust', icon: SunMedium, onSelect: () => add(createLayer('basic')) },
            {
              label: 'Curves',
              icon: Spline,
              onSelect: () => {
                const l = createLayer('curves')
                add(l)
                editor.set({ tab: 'color', colorTool: 'curves', layerId: l.id })
              },
            },
            {
              label: 'HSL',
              icon: Palette,
              onSelect: () => {
                const l = createLayer('hsl')
                add(l)
                editor.set({ tab: 'color', colorTool: 'hsl', layerId: l.id })
              },
            },
            {
              label: 'Split toning',
              icon: Circle,
              onSelect: () => {
                const l = createLayer('split')
                add(l)
                editor.set({ tab: 'color', colorTool: 'split', layerId: l.id })
              },
            },
            { label: 'LUT', icon: SwatchBook, onSelect: () => editor.set({ tab: 'looks' }) },
          ]}
        />
      </div>
      {autoNorm && (
        <div className="mb-2 flex items-center gap-3 rounded-2xl bg-ink-2 p-3 text-xs text-mute">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/8 text-white">
            A
          </span>
          <span className="flex-1">
            <span className="block text-sm font-semibold text-white">Auto match</span>
            {ctx.branch.global.adaptive
              ? 'Adaptive targets are on for this batch.'
              : 'Exposure and color corrections from Smart tools.'}
          </span>
          {ctx.state?.norm && ctx.current && (
            <button
              type="button"
              className="font-semibold text-salmon"
              onClick={() =>
                run(ctx, {
                  type: 'setNorms',
                  norms: { [(ctx.current as { id: string }).id]: null },
                })
              }
            >
              Clear
            </button>
          )}
        </div>
      )}
      <ul className="space-y-2">
        {[...layers].reverse().map(({ layer, own, hidden }) => {
          const list = own ? (ctx.state?.override.layers ?? []) : ctx.branch.global.layers
          const index = list.findIndex((l) => l.id === layer.id)
          return (
            <LayerRow
              key={`${own ? 'o' : 'g'}:${layer.id}`}
              ctx={ctx}
              layer={layer}
              own={own}
              hidden={hidden}
              index={index}
              count={list.length}
            />
          )
        })}
      </ul>
      {ctx.mode === 'individual' && !ownCount && (
        <p className="mt-3 text-xs text-mute">Layers you add now exist only on this photo.</p>
      )}
      <p className="mt-4 text-[11px] text-mute-2">Top of the list is applied last.</p>
    </div>
  )
}
