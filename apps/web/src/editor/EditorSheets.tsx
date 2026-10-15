import {
  describeStep,
  FILENAME_TOKENS,
  formatFilename,
  type Macro,
  newId,
  slugify,
  stripExtension,
} from '@jumpman/core'
import {
  Check,
  CircleDot,
  FolderDown,
  GitBranchPlus,
  Pencil,
  Play,
  Plus,
  Share2,
  Square,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { RenderCanvas } from '../components/EditedThumb.tsx'
import { ReviewSheet } from '../components/ReviewSheet.tsx'
import { type ExportOptions, exportBatch, supportedFormats, zipFiles } from '../lib/exporter.ts'
import { frameOf } from '../lib/geometry.ts'
import {
  canPickDirectory,
  canShareFiles,
  isNative,
  saveFile,
  saveToDirectory,
  shareFiles,
} from '../lib/platform.ts'
import type { Settings } from '../lib/types.ts'
import { editor, toast, useEditor } from '../state/editor.ts'
import {
  addBranch,
  deleteBranch,
  deleteMacro,
  dispatch,
  renameBranch,
  saveMacro,
  switchBranch,
  updateSettings,
  useLibrary,
} from '../state/library.ts'
import { layersFor } from '../state/selectors.ts'
import {
  Button,
  Chip,
  cx,
  ProgressBar,
  SectionTitle,
  Segmented,
  Sheet,
  Slider,
  Switch,
} from '../ui/primitives.tsx'
import type { BatchContext } from './context.ts'
import { runTool } from './tools.ts'

const close = () => editor.set({ sheet: null })

function BranchPreview({
  ctx,
  branchId,
  maxEdge = 220,
}: {
  ctx: BatchContext
  branchId: string
  maxEdge?: number
}) {
  const photos = useLibrary((s) => s.photos)
  const branch = ctx.batch.look.branches.find((b) => b.id === branchId)
  if (!branch || !ctx.current) return null
  return (
    <RenderCanvas
      photo={ctx.current}
      layers={layersFor(ctx.batch, photos, ctx.current.id, branch)}
      frame={frameOf(ctx.current, branch.global, branch.photos[ctx.current.id])}
      maxEdge={maxEdge}
      fit="contain"
      className="size-full"
    />
  )
}

function BranchesSheet({ ctx }: { ctx: BatchContext }) {
  const branches = ctx.batch.look.branches
  const [compare, setCompare] = useState<string | null>(null)
  const other = branches.find((b) => b.id === compare)
  return (
    <Sheet open onClose={close} title="Versions" wide>
      <p className="mb-3 text-sm text-mute">
        Try alternate looks for the same batch, like “warm” and “moody”, then compare them before
        exporting.
      </p>
      {other && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          {[ctx.branch, other].map((b) => (
            <figure key={b.id} className="overflow-hidden rounded-2xl bg-ink-2">
              <div className="aspect-[4/3]">
                <BranchPreview ctx={ctx} branchId={b.id} maxEdge={720} />
              </div>
              <figcaption className="px-3 py-2 text-sm font-semibold">{b.name}</figcaption>
            </figure>
          ))}
        </div>
      )}
      <ul className="space-y-2">
        {branches.map((b) => {
          const active = b.id === ctx.branch.id
          return (
            <li
              key={b.id}
              className={cx(
                'flex items-center gap-3 rounded-2xl p-2',
                active ? 'bg-white/10' : 'bg-ink-2',
              )}
            >
              <button
                type="button"
                onClick={() => switchBranch(ctx.batch.id, b.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span className="size-14 shrink-0 overflow-hidden rounded-xl bg-ink-3">
                  <BranchPreview ctx={ctx} branchId={b.id} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{b.name}</span>
                  <span className="text-xs text-mute">
                    {active ? 'Current version' : 'Tap to switch'}
                  </span>
                </span>
              </button>
              {!active && (
                <Chip
                  active={compare === b.id}
                  onClick={() => setCompare(compare === b.id ? null : b.id)}
                >
                  Compare
                </Chip>
              )}
              <button
                type="button"
                aria-label={`Rename ${b.name}`}
                className="grid size-9 place-items-center rounded-full text-mute hover:bg-white/10 hover:text-white"
                onClick={() => {
                  const name = prompt('Version name', b.name)?.trim()
                  if (name) renameBranch(ctx.batch.id, b.id, name)
                }}
              >
                <Pencil className="size-4" />
              </button>
              {branches.length > 1 && (
                <button
                  type="button"
                  aria-label={`Delete ${b.name}`}
                  className="grid size-9 place-items-center rounded-full text-mute hover:bg-[#ff6b6b]/15 hover:text-[#ff6b6b]"
                  onClick={() =>
                    confirm(`Delete version “${b.name}”?`) && deleteBranch(ctx.batch.id, b.id)
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          icon={GitBranchPlus}
          onClick={() => {
            const name = prompt('Name the new version', `${ctx.branch.name} copy`)?.trim()
            if (name) addBranch(ctx.batch.id, name, true)
          }}
        >
          Duplicate current
        </Button>
        <Button
          icon={Plus}
          onClick={() => {
            const name = prompt('Name the new version', 'Fresh start')?.trim()
            if (name) addBranch(ctx.batch.id, name, false)
          }}
        >
          Blank version
        </Button>
      </div>
    </Sheet>
  )
}

const SIZES = [
  { value: 0, label: 'Original' },
  { value: 4096, label: '4096' },
  { value: 2048, label: '2048' },
  { value: 1080, label: '1080' },
]

export function ExportSheet({
  ctx,
  photoIds,
  preset,
  onClose = close,
}: {
  ctx: BatchContext
  photoIds?: string[]
  preset?: Partial<ExportOptions>
  onClose?: () => void
}) {
  const settings = useLibrary((s) => s.settings)
  const collection = useLibrary((s) => s.collections[ctx.batch.collectionId])
  const gridSelection = useEditor((s) => s.gridSelection)
  const [formats, setFormats] = useState<Settings['exportFormat'][]>(['image/jpeg', 'image/png'])
  const [scope, setScope] = useState<'all' | 'selected'>(
    gridSelection.length && !photoIds ? 'selected' : 'all',
  )
  const [progress, setProgress] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => {
    void supportedFormats().then(setFormats)
  }, [])
  const ids =
    photoIds ?? (scope === 'selected' && gridSelection.length ? gridSelection : ctx.batch.photoIds)
  const opts: ExportOptions = {
    format: settings.exportFormat,
    quality: settings.exportQuality,
    maxEdge: settings.exportMaxEdge,
    pattern: settings.exportPattern,
    watermark: settings.watermark,
    watermarkPosition: settings.watermarkPosition,
    watermarkOpacity: settings.watermarkOpacity,
    includeXmp: settings.includeXmp,
    ...preset,
  }
  const first = ctx.photos.find((p) => p.id === ids[0])
  const example = first
    ? formatFilename(opts.pattern || '{name}', {
        name: stripExtension(first.name),
        index: 1,
        ...(collection ? { collection: collection.name } : {}),
        branch: ctx.branch.name,
        ...(first.takenAt ? { takenAt: first.takenAt } : {}),
        width: 1080,
        height: 1350,
      })
    : ''

  const run = async (dest: 'zip' | 'folder' | 'share' | 'native') => {
    abort.current = new AbortController()
    setProgress(0)
    try {
      const files = await exportBatch(
        ctx.batch,
        ids,
        opts,
        (d, t) => setProgress(d / t),
        abort.current.signal,
      )
      if (dest === 'share')
        await shareFiles(
          files.map((f) => new File([f.blob], f.name, { type: f.blob.type })),
          collection?.name,
        )
      else if (dest === 'folder') await saveToDirectory(files)
      else if (dest === 'native') {
        for (const f of files) await saveFile(f.name, f.blob)
        toast(`Saved ${files.length} files to Documents/Jumpman`)
      } else {
        if (files.length === 1 && files[0]) toast(await saveFile(files[0].name, files[0].blob))
        else
          toast(
            await saveFile(
              `${slugify(collection?.name ?? '') || 'jumpman'}.zip`,
              await zipFiles(files),
            ),
          )
      }
      if (dest !== 'zip' && dest !== 'native') toast(`Exported ${files.length} files`)
      onClose()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  return (
    <Sheet
      open
      onClose={() => {
        abort.current?.abort()
        onClose()
      }}
      title={`Export ${ids.length} photo${ids.length > 1 ? 's' : ''}`}
    >
      {!photoIds && gridSelection.length > 0 && (
        <Segmented
          label="Photos to export"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: `All ${ctx.batch.photoIds.length}` },
            { value: 'selected', label: `Selected ${gridSelection.length}` },
          ]}
        />
      )}
      <SectionTitle>Format</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {formats.map((f) => (
          <Chip
            key={f}
            active={opts.format === f}
            onClick={() => updateSettings({ exportFormat: f })}
          >
            {f.split('/')[1]?.toUpperCase()}
          </Chip>
        ))}
      </div>
      {opts.format !== 'image/png' && (
        <Slider
          label="Quality"
          value={Math.round(opts.quality * 100)}
          min={50}
          max={100}
          format={(v) => `${v}%`}
          onChange={(v) => updateSettings({ exportQuality: v / 100 })}
        />
      )}
      {!preset?.maxEdge && (
        <>
          <SectionTitle>Size (long edge)</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {SIZES.map((s) => (
              <Chip
                key={s.value}
                active={opts.maxEdge === s.value}
                onClick={() => updateSettings({ exportMaxEdge: s.value })}
              >
                {s.label}
              </Chip>
            ))}
          </div>
        </>
      )}
      <SectionTitle>File names</SectionTitle>
      <input
        value={opts.pattern}
        onChange={(e) => updateSettings({ exportPattern: e.target.value })}
        aria-label="File name pattern"
        className="h-10 w-full rounded-xl bg-ink-2 px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-salmon"
      />
      <div className="scrollbar-none mt-2 flex gap-1.5 overflow-x-auto">
        {FILENAME_TOKENS.map((t) => (
          <button
            key={t.token}
            type="button"
            title={t.help}
            onClick={() => updateSettings({ exportPattern: `${opts.pattern}${t.token}` })}
            className="shrink-0 rounded-lg bg-white/8 px-2 py-1 font-mono text-[11px] hover:bg-white/15"
          >
            {t.token}
          </button>
        ))}
      </div>
      {example && <p className="mt-1.5 text-xs text-mute">e.g. {example}</p>}
      <SectionTitle>Watermark</SectionTitle>
      <input
        value={opts.watermark}
        onChange={(e) => updateSettings({ watermark: e.target.value })}
        placeholder="© Your name (optional)"
        aria-label="Watermark text"
        className="h-10 w-full rounded-xl bg-ink-2 px-3 text-sm outline-none focus:ring-2 focus:ring-salmon"
      />
      {opts.watermark && (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(['bottom-right', 'bottom-left', 'bottom-center', 'top-right', 'center'] as const).map(
              (p) => (
                <Chip
                  key={p}
                  active={opts.watermarkPosition === p}
                  onClick={() => updateSettings({ watermarkPosition: p })}
                >
                  {p.replace('-', ' ')}
                </Chip>
              ),
            )}
          </div>
          <Slider
            label="Opacity"
            value={Math.round(opts.watermarkOpacity * 100)}
            min={10}
            max={100}
            format={(v) => `${v}%`}
            onChange={(v) => updateSettings({ watermarkOpacity: v / 100 })}
          />
        </>
      )}
      <Switch
        label="Include XMP sidecars"
        description="Adds a Lightroom-compatible .xmp next to each photo."
        checked={opts.includeXmp}
        onChange={(v) => updateSettings({ includeXmp: v })}
      />
      {progress !== null ? (
        <div className="mt-4 space-y-2 pb-2">
          <ProgressBar value={progress} label="Export progress" />
          <div className="flex items-center justify-between text-sm text-mute">
            Rendering at full quality… {Math.round(progress * ids.length)}/{ids.length}
            <Button size="sm" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-2 pb-2">
          {isNative() ? (
            <Button
              variant="primary"
              size="lg"
              icon={FolderDown}
              onClick={() => void run('native')}
            >
              Save to device
            </Button>
          ) : (
            <Button variant="primary" size="lg" icon={FolderDown} onClick={() => void run('zip')}>
              {ids.length > 1 || opts.includeXmp ? 'Download ZIP' : 'Download'}
            </Button>
          )}
          {canPickDirectory() && (
            <Button icon={FolderDown} onClick={() => void run('folder')}>
              Save into a folder…
            </Button>
          )}
          {canShareFiles() && (
            <Button icon={Share2} onClick={() => void run('share')}>
              Share to apps…
            </Button>
          )}
        </div>
      )}
    </Sheet>
  )
}

function MacrosSheet({ ctx }: { ctx: BatchContext }) {
  const recording = useEditor((s) => s.recording)
  const macros = useLibrary((s) => s.macros)
  const replay = (m: Macro) => {
    for (const step of m.steps) {
      if (step.kind === 'op') dispatch(ctx.batch.id, step.op)
      else runTool(ctx.batch.id, step.tool)
    }
    toast(`Replayed “${m.name}” (${m.steps.length} steps)`)
    close()
  }
  return (
    <Sheet open onClose={close} title="Edit replay">
      <p className="mb-3 text-sm text-mute">
        Record an editing session as steps, then replay it on any batch, like a macro. Smart tools
        re-run on the new photos.
      </p>
      {recording ? (
        <div className="rounded-3xl bg-ink-2 p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <span className="size-2.5 animate-pulse rounded-full bg-brand" /> Recording ·{' '}
            {recording.length} steps
          </div>
          <ol className="max-h-48 list-decimal space-y-1 overflow-y-auto pl-5 text-sm text-mute">
            {recording.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: steps are an append-only log
              <li key={i}>{describeStep(s)}</li>
            ))}
          </ol>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="primary"
              icon={Check}
              disabled={!recording.length}
              onClick={() => {
                const name = prompt('Macro name', 'My edit recipe')?.trim()
                if (!name) return
                saveMacro({ id: newId('m'), name, createdAt: Date.now(), steps: recording })
                editor.set({ recording: null })
                toast(`Saved macro “${name}”`)
              }}
            >
              Save
            </Button>
            <Button icon={Square} onClick={() => editor.set({ recording: null })}>
              Discard
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="primary"
          icon={CircleDot}
          className="w-full"
          onClick={() => {
            editor.set({ recording: [] })
            close()
          }}
        >
          Start recording
        </Button>
      )}
      <SectionTitle>Saved macros</SectionTitle>
      <ul className="space-y-2 pb-2">
        {macros.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-2xl bg-ink-2 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{m.name}</div>
              <div className="truncate text-xs text-mute">
                {m.steps.map(describeStep).join(' → ')}
              </div>
            </div>
            <Button size="sm" variant="primary" icon={Play} onClick={() => replay(m)}>
              Replay
            </Button>
            <button
              type="button"
              aria-label={`Delete ${m.name}`}
              onClick={() => deleteMacro(m.id)}
              className="grid size-8 place-items-center rounded-full text-mute hover:text-[#ff6b6b]"
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {!macros.length && <li className="text-sm text-mute">Nothing saved yet.</li>}
      </ul>
    </Sheet>
  )
}

const SHORTCUTS: [string, string][] = [
  ['← / →', 'Previous / next photo'],
  ['G', 'Toggle Global / Individual'],
  ['\\ (hold)', 'Show original'],
  ['Ctrl/⌘ Z', 'Undo'],
  ['Ctrl/⌘ Shift Z, Ctrl Y', 'Redo'],
  ['Arrow keys on the dial', 'Fine adjust (Shift for 10×)'],
  ['0 / Delete on the dial', 'Reset slider'],
  ['?', 'This list'],
]

function ShortcutsSheet() {
  return (
    <Sheet open onClose={close} title="Keyboard shortcuts">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 pb-3 text-sm">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="rounded-md bg-ink-2 px-2 py-0.5 font-mono text-xs">{k}</kbd>
            </dt>
            <dd className="text-mute">{v}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  )
}

export default function EditorSheets({ ctx }: { ctx: BatchContext }) {
  const sheet = useEditor((s) => s.sheet)
  switch (sheet) {
    case 'branches':
      return <BranchesSheet ctx={ctx} />
    case 'export':
      return <ExportSheet ctx={ctx} />
    case 'macros':
      return <MacrosSheet ctx={ctx} />
    case 'review':
      return (
        <ReviewSheet
          open
          onClose={close}
          collectionId={ctx.batch.collectionId}
          batchId={ctx.batch.id}
          {...(ctx.current ? { photoId: ctx.current.id } : {})}
        />
      )
    case 'shortcuts':
      return <ShortcutsSheet />
    default:
      return null
  }
}
