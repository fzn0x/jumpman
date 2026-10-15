import { layersToXmp, NORM_LAYER_ID, resolveLayers, slugify, stripExtension } from '@jumpman/core'
import {
  CircleDot,
  ClipboardCopy,
  ClipboardPaste,
  Download,
  FileCode2,
  GitBranch,
  Grid3x3,
  Image,
  Keyboard,
  MessageSquare,
  MoreHorizontal,
  RotateCcw,
  Save,
  Smartphone,
  Square,
} from 'lucide-react'
import { zipFiles } from '../lib/exporter.ts'
import { saveFile } from '../lib/platform.ts'
import { editor, toast, useEditor } from '../state/editor.ts'
import { undo, useLibrary } from '../state/library.ts'
import { navigate } from '../state/router.ts'
import { layersFor } from '../state/selectors.ts'
import { Menu } from '../ui/Menu.tsx'
import { IconButton } from '../ui/primitives.tsx'
import { savePresetFromBatch } from './actions.ts'
import { type BatchContext, run } from './context.ts'

export function copyEdit(ctx: BatchContext): void {
  if (!ctx.current) return
  const layers = resolveLayers(ctx.branch.global, ctx.state).filter((l) => l.id !== NORM_LAYER_ID)
  editor.set({ clipboard: { layers, from: ctx.current.name } })
  toast(`Copied the edit of ${ctx.current.name}`)
}

export function pasteEdit(ctx: BatchContext, photoIds: string[]): void {
  const clip = editor.get().clipboard
  if (!clip || !photoIds.length) return
  run(ctx, { type: 'pasteToPhotos', photoIds, layers: clip.layers })
  toast(`Pasted onto ${photoIds.length} photo${photoIds.length > 1 ? 's' : ''}`, {
    label: 'Undo',
    run: () => undo(ctx.batch.id),
  })
}

async function exportSidecars(ctx: BatchContext) {
  const photos = useLibrary.getState().photos
  const files = ctx.photos.map((p) => ({
    name: `${stripExtension(p.name)}.xmp`,
    blob: new Blob(
      [layersToXmp(layersFor(ctx.batch, photos, p.id), { creatorTool: 'Jumpman' }).xml],
      { type: 'application/rdf+xml' },
    ),
  }))
  const zip = await zipFiles(files)
  const collection = useLibrary.getState().collections[ctx.batch.collectionId]
  toast(await saveFile(`${slugify(collection?.name ?? 'jumpman')}-xmp.zip`, zip))
}

export function EditorMenu({
  ctx,
  view,
}: {
  ctx: BatchContext
  view: 'single' | 'grid' | 'social'
}) {
  const clipboard = useEditor((s) => s.clipboard)
  const recording = useEditor((s) => s.recording)
  const others = ctx.photos.filter((p) => p.id !== ctx.current?.id).map((p) => p.id)
  return (
    <Menu
      label="Editor actions"
      trigger={(p) => <IconButton icon={MoreHorizontal} label="More actions" {...p} />}
      items={[
        { label: 'Export…', icon: Download, onSelect: () => editor.set({ sheet: 'export' }) },
        view === 'single'
          ? {
              label: 'Before / after grid',
              icon: Grid3x3,
              onSelect: () => navigate({ name: 'editor', batchId: ctx.batch.id, view: 'grid' }),
            }
          : {
              label: 'Single photo',
              icon: Image,
              onSelect: () => navigate({ name: 'editor', batchId: ctx.batch.id, view: 'single' }),
            },
        {
          label: 'Instagram preview',
          icon: Smartphone,
          onSelect: () => navigate({ name: 'editor', batchId: ctx.batch.id, view: 'social' }),
        },
        'divider',
        {
          label: 'Copy this photo’s edit',
          icon: ClipboardCopy,
          disabled: !ctx.current,
          onSelect: () => copyEdit(ctx),
        },
        {
          label: clipboard ? `Paste to ${others.length} other photos` : 'Paste edit',
          icon: ClipboardPaste,
          disabled: !clipboard,
          onSelect: () => pasteEdit(ctx, others),
        },
        {
          label: 'Versions…',
          icon: GitBranch,
          hint: ctx.branch.name,
          onSelect: () => editor.set({ sheet: 'branches' }),
        },
        recording
          ? {
              label: 'Stop recording macro',
              icon: Square,
              onSelect: () => editor.set({ sheet: 'macros' }),
            }
          : {
              label: 'Macros (edit replay)…',
              icon: CircleDot,
              onSelect: () => editor.set({ sheet: 'macros' }),
            },
        {
          label: 'Review & comments…',
          icon: MessageSquare,
          onSelect: () => editor.set({ sheet: 'review' }),
        },
        {
          label: 'Save as preset',
          icon: Save,
          onSelect: () => {
            const name = prompt('Preset name', 'My look')?.trim()
            if (name) savePresetFromBatch(ctx, name)
          },
        },
        {
          label: 'Export XMP sidecars',
          icon: FileCode2,
          hint: 'Lightroom',
          onSelect: () => void exportSidecars(ctx),
        },
        'divider',
        {
          label: 'Revert batch to original',
          icon: RotateCcw,
          danger: true,
          onSelect: () => {
            run(ctx, { type: 'resetAll' })
            toast('Reverted to original', { label: 'Undo', run: () => undo(ctx.batch.id) })
          },
        },
        {
          label: 'Keyboard shortcuts',
          icon: Keyboard,
          hint: '?',
          onSelect: () => editor.set({ sheet: 'shortcuts' }),
        },
      ]}
    />
  )
}
