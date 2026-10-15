import {
  ArrowLeft,
  Columns2,
  Crop,
  Eye,
  Grid3x3,
  Layers3,
  type LucideIcon,
  Palette,
  Redo2,
  SlidersHorizontal,
  Sparkles,
  SwatchBook,
  Timer,
  Undo2,
} from 'lucide-react'
import { lazy, type ReactNode, Suspense, useEffect } from 'react'
import { TopBar } from '../components/Chrome.tsx'
import { AdjustPanel } from '../editor/AdjustPanel.tsx'
import { type BatchContext, useBatchContext } from '../editor/context.ts'
import { EditorMenu } from '../editor/EditorMenu.tsx'
import { PhotoDots } from '../editor/PhotoDots.tsx'
import { SummaryBar } from '../editor/SummaryBar.tsx'
import { Viewport } from '../editor/Viewport.tsx'
import { useMediaQuery } from '../lib/hooks.ts'
import { type EditorTab, editor, useEditor } from '../state/editor.ts'
import { redo, undo, useLibrary } from '../state/library.ts'
import { navigate } from '../state/router.ts'
import { cx, Empty, IconButton, Segmented } from '../ui/primitives.tsx'

const ColorPanel = lazy(() => import('../editor/ColorPanel.tsx'))
const LooksPanel = lazy(() => import('../editor/LooksPanel.tsx'))
const LayersPanel = lazy(() => import('../editor/LayersPanel.tsx'))
const CropPanel = lazy(() => import('../editor/CropPanel.tsx'))
const AutoPanel = lazy(() => import('../editor/AutoPanel.tsx'))
const SeriesPanel = lazy(() => import('../editor/SeriesPanel.tsx'))
const BatchGrid = lazy(() => import('../editor/BatchGrid.tsx'))
const SocialView = lazy(() => import('../editor/SocialView.tsx'))
const EditorSheets = lazy(() => import('../editor/EditorSheets.tsx'))

const TABS: { id: EditorTab; label: string; icon: LucideIcon }[] = [
  { id: 'adjust', label: 'Adjust', icon: SlidersHorizontal },
  { id: 'color', label: 'Color', icon: Palette },
  { id: 'looks', label: 'Looks', icon: SwatchBook },
  { id: 'layers', label: 'Layers', icon: Layers3 },
  { id: 'crop', label: 'Crop', icon: Crop },
  { id: 'auto', label: 'Smart', icon: Sparkles },
  { id: 'series', label: 'Series', icon: Timer },
]

function Panel({ ctx, tab }: { ctx: BatchContext; tab: EditorTab }) {
  let content: ReactNode
  switch (tab) {
    case 'adjust':
      return <AdjustPanel ctx={ctx} />
    case 'color':
      content = <ColorPanel ctx={ctx} />
      break
    case 'looks':
      content = <LooksPanel ctx={ctx} />
      break
    case 'layers':
      content = <LayersPanel ctx={ctx} />
      break
    case 'crop':
      content = <CropPanel ctx={ctx} />
      break
    case 'auto':
      content = <AutoPanel ctx={ctx} />
      break
    case 'series':
      content = <SeriesPanel ctx={ctx} />
      break
  }
  return (
    <Suspense fallback={<div className="p-6 text-sm text-mute">Loading…</div>}>{content}</Suspense>
  )
}

function useShortcuts(ctx: BatchContext | null) {
  useEffect(() => {
    if (!ctx) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable], [role="slider"]')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo(ctx.batch.id)
        else undo(ctx.batch.id)
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo(ctx.batch.id)
      } else if (e.key === 'ArrowRight')
        editor.set({ index: Math.min(ctx.photos.length - 1, ctx.index + 1) })
      else if (e.key === 'ArrowLeft') editor.set({ index: Math.max(0, ctx.index - 1) })
      else if (e.key === '\\' && !e.repeat) editor.set({ compare: 'hold' })
      else if (e.key.toLowerCase() === 'g' && !mod)
        editor.set({ mode: editor.get().mode === 'global' ? 'individual' : 'global' })
      else if (e.key === '?') editor.set({ sheet: 'shortcuts' })
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key === '\\') editor.set({ compare: 'off' })
    }
    addEventListener('keydown', onKey)
    addEventListener('keyup', onUp)
    return () => {
      removeEventListener('keydown', onKey)
      removeEventListener('keyup', onUp)
    }
  }, [ctx])
}

export function EditorScreen({
  batchId,
  view,
}: {
  batchId: string
  view: 'single' | 'grid' | 'social'
}) {
  const ctx = useBatchContext(batchId)
  const tab = useEditor((s) => s.tab)
  const mode = useEditor((s) => s.mode)
  const compare = useEditor((s) => s.compare)
  const recording = useEditor((s) => s.recording)
  const history = useLibrary((s) => s.histories[batchId])
  const collection = useLibrary((s) => (ctx ? s.collections[ctx.batch.collectionId] : undefined))
  const desktop = useMediaQuery('(min-width: 1024px)')
  useShortcuts(ctx)

  // The screen is keyed by batch id, so this runs once per batch.
  useEffect(() => {
    editor.reset()
  }, [])

  if (!ctx) {
    return (
      <div className="grid h-full place-items-center">
        <Empty icon={Layers3} title="This edit session is gone">
          <a className="font-semibold text-salmon" href="#/">
            Back to collections
          </a>
        </Empty>
      </div>
    )
  }

  const back = () =>
    navigate(collection ? { name: 'collection', id: collection.id } : { name: 'library' })
  const header = (
    <TopBar
      left={
        <>
          <IconButton icon={ArrowLeft} label="Back to collection" onClick={back} />
          <div className="hidden min-w-0 pl-1 sm:block">
            <div className="truncate text-sm font-bold">{collection?.name ?? 'Batch'}</div>
            <div className="text-xs text-mute">
              {ctx.photos.length} photos · {ctx.branch.name}
            </div>
          </div>
        </>
      }
      center={
        view === 'single' && (
          <Segmented
            label="Edit scope"
            value={mode}
            onChange={(m) => editor.set({ mode: m })}
            options={[
              { value: 'global', label: 'Global' },
              { value: 'individual', label: 'Individual' },
            ]}
          />
        )
      }
      right={
        <>
          <IconButton
            icon={Undo2}
            label="Undo"
            disabled={!history?.past.length}
            onClick={() => undo(batchId)}
            className="max-lg:hidden"
          />
          <IconButton
            icon={Redo2}
            label="Redo"
            disabled={!history?.future.length}
            onClick={() => redo(batchId)}
            className="max-lg:hidden"
          />
          <IconButton
            icon={view === 'grid' ? Grid3x3 : Columns2}
            label="Before / after"
            active={compare === 'split'}
            onClick={() => editor.set({ compare: compare === 'split' ? 'off' : 'split' })}
            onPointerDown={(e) => {
              if (e.pointerType === 'touch') {
                const t = setTimeout(() => editor.set({ compare: 'hold' }), 350)
                const up = () => {
                  clearTimeout(t)
                  if (editor.get().compare === 'hold') editor.set({ compare: 'off' })
                  removeEventListener('pointerup', up)
                }
                addEventListener('pointerup', up)
              }
            }}
          />
          <EditorMenu ctx={ctx} view={view} />
        </>
      }
    />
  )

  if (view !== 'single') {
    return (
      <div className="flex h-full flex-col">
        {header}
        <Suspense fallback={null}>
          {view === 'grid' ? <BatchGrid ctx={ctx} /> : <SocialView ctx={ctx} />}
        </Suspense>
        <Suspense fallback={null}>
          <EditorSheets ctx={ctx} />
        </Suspense>
      </div>
    )
  }

  const tabs = (
    <nav
      aria-label="Editing tools"
      className="scrollbar-none flex gap-1 overflow-x-auto px-2 py-1.5 lg:px-3"
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => editor.set({ tab: t.id, maskLayerId: null })}
          aria-current={tab === t.id ? 'page' : undefined}
          className={cx(
            'flex min-w-[52px] flex-1 flex-col items-center gap-1 rounded-2xl px-1 py-1.5 text-[11px] font-semibold transition',
            tab === t.id ? 'text-white' : 'text-mute hover:text-white',
          )}
        >
          <span
            className={cx(
              'grid h-8 w-12 place-items-center rounded-full transition',
              tab === t.id && 'bg-brand',
            )}
          >
            <t.icon className="size-[18px]" />
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {header}
      {recording && (
        <div className="flex items-center justify-center gap-2 bg-brand px-3 py-1 text-xs font-semibold">
          <span className="size-2 animate-pulse rounded-full bg-white" /> Recording macro ·{' '}
          {recording.length} steps
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => editor.set({ sheet: 'macros' })}
          >
            Stop
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 flex-1 flex-col" aria-label="Photo">
          {desktop && <SummaryBar ctx={ctx} />}
          <Viewport ctx={ctx} />
          <PhotoDots ctx={ctx} />
          {compare === 'hold' && (
            <div className="pointer-events-none absolute top-20 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold">
              <Eye className="mr-1 inline size-3.5" /> Original
            </div>
          )}
        </section>
        <aside
          className={cx(
            'flex flex-col border-white/5 bg-ink',
            desktop
              ? 'w-[380px] border-l'
              : 'h-[50dvh] shrink-0 rounded-t-[28px] border-t bg-ink-2/40',
          )}
          aria-label="Editing panel"
        >
          {!desktop && <SummaryBar ctx={ctx} withHistory />}
          {desktop && tabs}
          <div className="min-h-0 flex-1">
            <Panel ctx={ctx} tab={tab} />
          </div>
          {!desktop && <div className="safe-bottom border-t border-white/5">{tabs}</div>}
        </aside>
      </div>
      <Suspense fallback={null}>
        <EditorSheets ctx={ctx} />
      </Suspense>
    </div>
  )
}
