import {
  builtinLutId,
  createLayer,
  type Layer,
  LOOKS,
  type Preset,
  presetLayers,
  resolveLayers,
} from '@jumpman/core'
import {
  Download,
  FileUp,
  ImagePlus,
  Link2,
  MoreHorizontal,
  Plus,
  Save,
  Trash2,
  Users,
  Wand2,
} from 'lucide-react'
import { useState } from 'react'
import { RenderCanvas } from '../components/EditedThumb.tsx'
import { frameOf } from '../lib/geometry.ts'
import { pickFiles } from '../lib/hooks.ts'
import type { Photo } from '../lib/types.ts'
import { toast, useEditor } from '../state/editor.ts'
import { BUILTIN_PRESETS, deleteCustomLut, deletePreset, useLibrary } from '../state/library.ts'
import { navigate } from '../state/router.ts'
import { Menu } from '../ui/Menu.tsx'
import { Button, cx, SectionTitle, Slider } from '../ui/primitives.tsx'
import {
  applyLutLayer,
  applyPreset,
  exportLookAsCube,
  exportPresetFile,
  findLut,
  importLookFile,
  importXmpSidecars,
  lookFromSample,
  savePresetFromBatch,
  sharePresetLink,
} from './actions.ts'
import { type BatchContext, findLayer, finish, paramsOf, run } from './context.ts'

function Tile({
  label,
  active,
  onClick,
  children,
  menu,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  menu?: React.ReactNode
}) {
  return (
    <div className="relative w-[84px] shrink-0">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className="block w-full text-left"
      >
        <div
          className={cx(
            'aspect-square overflow-hidden rounded-2xl ring-offset-2 ring-offset-ink transition',
            active ? 'ring-2 ring-brand' : 'hover:opacity-90',
          )}
        >
          {children}
        </div>
        <div
          className={cx(
            'mt-1.5 truncate text-center text-[11px] font-semibold',
            active ? 'text-white' : 'text-mute',
          )}
        >
          {label}
        </div>
      </button>
      {menu && <div className="absolute top-1 right-1">{menu}</div>}
    </div>
  )
}

function Preview({ photo, layers }: { photo: Photo; layers: Layer[] }) {
  const frame = frameOf(photo, { layers: [], adaptive: false, aspect: '1:1' }, undefined)
  return (
    <RenderCanvas photo={photo} layers={layers} frame={frame} maxEdge={168} className="size-full" />
  )
}

export default function LooksPanel({ ctx }: { ctx: BatchContext }) {
  const customLuts = useLibrary((s) => s.luts)
  const myPresets = useLibrary((s) => s.presets)
  const layerId = useEditor((s) => s.layerId)
  const [busy, setBusy] = useState<string | null>(null)
  const photo = ctx.current
  if (!photo) return null

  const selected = findLayer(ctx, layerId)?.layer
  const lutLayer = selected?.kind === 'lut' ? selected : findLut(ctx)
  const activeLutId = lutLayer?.kind === 'lut' ? paramsOf(ctx, lutLayer).lutId : null
  // Preview stack: the current edit without the LUT being swapped.
  const base = resolveLayers(ctx.branch.global, ctx.state).filter((l) => l.id !== lutLayer?.id)
  const lutOwn = !!lutLayer && !!ctx.state?.override.layers?.some((l) => l.id === lutLayer.id)
  const lutScope =
    lutOwn && ctx.current ? ({ kind: 'photo', photoId: ctx.current.id } as const) : ctx.scope
  const opacity =
    lutLayer && !lutOwn && ctx.mode === 'individual'
      ? (ctx.state?.override.opacity?.[lutLayer.id] ?? lutLayer.opacity)
      : (lutLayer?.opacity ?? 1)

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const presets: Preset[] = [...myPresets, ...BUILTIN_PRESETS]

  return (
    <div className="h-full overflow-y-auto pt-2 pb-6">
      <div className="px-4">
        <SectionTitle
          action={
            lutLayer && (
              <button
                type="button"
                className="text-xs font-semibold text-salmon"
                onClick={() =>
                  run(ctx, { type: 'removeLayer', layerId: lutLayer.id, scope: lutScope })
                }
              >
                Remove LUT
              </button>
            )
          }
        >
          LUT library
        </SectionTitle>
      </div>
      <div className="scrollbar-none flex gap-3 overflow-x-auto px-4 pb-1">
        {LOOKS.map((look) => {
          const id = builtinLutId(look.id)
          return (
            <Tile
              key={look.id}
              label={look.name}
              active={activeLutId === id}
              onClick={() => applyLutLayer(ctx, id, look.name)}
            >
              <Preview
                photo={photo}
                layers={[
                  ...base,
                  createLayer('lut', { id: `preview-${look.id}`, params: { lutId: id } }),
                ]}
              />
            </Tile>
          )
        })}
        {customLuts.map((l) => (
          <Tile
            key={l.id}
            label={l.name}
            active={activeLutId === l.id}
            onClick={() => applyLutLayer(ctx, l.id, l.name)}
            menu={
              <button
                type="button"
                aria-label={`Delete ${l.name}`}
                onClick={() => {
                  if (confirm(`Delete LUT “${l.name}”? Layers using it will stop rendering it.`))
                    void deleteCustomLut(l.id)
                }}
                className="grid size-6 place-items-center rounded-full bg-black/60 text-white"
              >
                <Trash2 className="size-3" />
              </button>
            }
          >
            <Preview
              photo={photo}
              layers={[
                ...base,
                createLayer('lut', { id: `preview-${l.id}`, params: { lutId: l.id } }),
              ]}
            />
          </Tile>
        ))}
      </div>
      {lutLayer && (
        <div className="px-4">
          <Slider
            label="Intensity"
            value={Math.round(opacity * 100)}
            min={0}
            max={100}
            format={(v) => `${v}%`}
            onChange={(v) =>
              run(
                ctx,
                {
                  type: 'updateLayer',
                  layerId: lutLayer.id,
                  patch: { opacity: v / 100 },
                  scope: lutScope,
                },
                true,
              )
            }
            onCommit={() => finish(ctx)}
          />
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 px-4">
        <Button
          icon={ImagePlus}
          disabled={!!busy}
          onClick={async () => {
            const [file] = await pickFiles('image/*', false)
            if (file) await guard('sample', () => lookFromSample(ctx, file))
          }}
        >
          {busy === 'sample' ? 'Matching…' : 'From a sample'}
        </Button>
        <Menu
          label="Import"
          align="right"
          trigger={(p) => (
            <Button icon={FileUp} className="w-full" {...p}>
              Import
            </Button>
          )}
          items={[
            {
              label: '.cube LUT',
              hint: 'Resolve, Premiere',
              onSelect: async () => {
                const files = await pickFiles('.cube', true)
                for (const f of files) await guard('import', () => importLookFile(ctx, f))
              },
            },
            {
              label: 'Lightroom XMP',
              hint: 'preset or sidecars',
              onSelect: async () => {
                const files = await pickFiles('.xmp', true)
                if (files.length === 1)
                  await guard('import', () => importLookFile(ctx, files[0] as File))
                else if (files.length > 1) {
                  const n = await importXmpSidecars(ctx, files)
                  toast(`Matched ${n} of ${files.length} sidecars to photos`)
                }
              },
            },
            {
              label: 'Capture One style',
              hint: '.costyle',
              onSelect: async () => {
                const [f] = await pickFiles('.costyle,.copreset', false)
                if (f) await guard('import', () => importLookFile(ctx, f))
              },
            },
            {
              label: 'Jumpman preset',
              hint: '.json',
              onSelect: async () => {
                const [f] = await pickFiles('.json,application/json', false)
                if (f) await guard('import', () => importLookFile(ctx, f))
              },
            },
          ]}
        />
      </div>
      <p className="mt-2 px-4 text-[11px] leading-relaxed text-mute-2">
        “From a sample” turns any photo, like a film still or a magazine shot, into a LUT that
        approximates its look.
      </p>

      <div className="mt-2 px-4">
        <SectionTitle
          action={
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-semibold text-salmon"
              onClick={() => navigate({ name: 'presets' })}
            >
              <Users className="size-3.5" /> Community
            </button>
          }
        >
          Presets
        </SectionTitle>
      </div>
      <div className="scrollbar-none flex gap-3 overflow-x-auto px-4 pb-1">
        <Tile
          label="Save current"
          onClick={() => {
            const name = prompt('Preset name', 'My look')?.trim()
            if (name) savePresetFromBatch(ctx, name)
          }}
        >
          <div className="grid size-full place-items-center rounded-2xl border-2 border-dashed border-white/15 text-mute">
            <Save className="size-6" />
          </div>
        </Tile>
        {presets.map((p) => {
          const own = !p.id.startsWith('builtin-')
          return (
            <Tile
              key={p.id}
              label={p.name}
              onClick={() => void applyPreset(ctx.batch.id, p)}
              menu={
                <Menu
                  label={`${p.name} actions`}
                  trigger={(t) => (
                    <button
                      type="button"
                      aria-label={`${p.name} actions`}
                      className="grid size-6 place-items-center rounded-full bg-black/60 text-white"
                      {...t}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  )}
                  items={[
                    {
                      label: 'Apply to batch',
                      icon: Wand2,
                      onSelect: () => void applyPreset(ctx.batch.id, p),
                    },
                    {
                      label: 'Add on top',
                      icon: Plus,
                      onSelect: () => void applyPreset(ctx.batch.id, p, 'append'),
                    },
                    {
                      label: 'Copy share link',
                      icon: Link2,
                      onSelect: () => void sharePresetLink(p),
                    },
                    {
                      label: 'Export file',
                      icon: Download,
                      onSelect: () => void exportPresetFile(p),
                    },
                    ...(own
                      ? [
                          {
                            label: 'Delete',
                            icon: Trash2,
                            danger: true,
                            onSelect: () => deletePreset(p.id),
                          },
                        ]
                      : []),
                  ]}
                />
              }
            >
              <Preview photo={photo} layers={presetLayers(p)} />
            </Tile>
          )
        })}
      </div>
      <div className="mt-3 px-4">
        <Button
          size="sm"
          icon={Download}
          onClick={() => {
            const name = prompt('Name for the .cube file', 'Jumpman look')?.trim()
            if (name) void exportLookAsCube(ctx, name)
          }}
        >
          Export look as .cube
        </Button>
      </div>
    </div>
  )
}
