import { describeOverride, hasOverride } from '@jumpman/core'
import { CheckSquare, ClipboardPaste, Download, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { EditedThumb } from '../components/EditedThumb.tsx'
import { editor, toast, useEditor } from '../state/editor.ts'
import { undo } from '../state/library.ts'
import { navigate } from '../state/router.ts'
import { Button, cx, Segmented } from '../ui/primitives.tsx'
import { type BatchContext, run } from './context.ts'
import { pasteEdit } from './EditorMenu.tsx'

type Mode = 'after' | 'before' | 'both'

/** Batch before/after grid: the whole selection with and without the edit. */
export default function BatchGrid({ ctx }: { ctx: BatchContext }) {
  const [mode, setMode] = useState<Mode>('after')
  const [selecting, setSelecting] = useState(false)
  const selection = useEditor((s) => s.gridSelection)
  const clipboard = useEditor((s) => s.clipboard)
  const sel = new Set(selection)
  const toggle = (id: string) =>
    editor.set({
      gridSelection: sel.has(id) ? selection.filter((x) => x !== id) : [...selection, id],
    })
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-white/5 bg-ink/90 px-3 py-2.5 backdrop-blur-xl sm:px-5">
        <Segmented
          label="Compare"
          value={mode}
          onChange={setMode}
          size="sm"
          options={[
            { value: 'before', label: 'Before' },
            { value: 'after', label: 'After' },
            { value: 'both', label: 'Side by side' },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            icon={CheckSquare}
            variant={selecting ? 'light' : 'secondary'}
            onClick={() => (setSelecting(!selecting), editor.set({ gridSelection: [] }))}
          >
            {selecting ? `${selection.length} selected` : 'Select'}
          </Button>
          {selecting && selection.length > 0 && (
            <>
              <Button
                size="sm"
                icon={ClipboardPaste}
                disabled={!clipboard}
                onClick={() => pasteEdit(ctx, selection)}
                title={clipboard ? `Paste the edit of ${clipboard.from}` : 'Copy an edit first'}
              >
                Paste
              </Button>
              <Button
                size="sm"
                icon={RotateCcw}
                onClick={() => {
                  for (const id of selection)
                    run(ctx, { type: 'resetPhoto', photoId: id, keepNorm: true })
                  toast('Reset to the global edit', {
                    label: 'Undo',
                    run: () => undo(ctx.batch.id),
                  })
                }}
              >
                Reset
              </Button>
              <Button size="sm" icon={Download} onClick={() => editor.set({ sheet: 'export' })}>
                Export
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-2 p-2 sm:grid-cols-3 sm:gap-3 sm:p-5 lg:grid-cols-4">
        {ctx.photos.map((p, i) => {
          const state = ctx.branch.photos[p.id]
          const individual = hasOverride(state)
          const on = sel.has(p.id)
          return (
            <div
              key={p.id}
              className={cx(
                'group relative overflow-hidden rounded-2xl bg-ink-2',
                on && 'ring-[3px] ring-white',
              )}
            >
              <button
                type="button"
                className="block w-full"
                aria-label={selecting ? `Select ${p.name}` : `Open ${p.name}`}
                onClick={() => {
                  if (selecting) toggle(p.id)
                  else {
                    editor.set({ index: i })
                    navigate({ name: 'editor', batchId: ctx.batch.id, view: 'single' })
                  }
                }}
              >
                {mode === 'both' ? (
                  <div className="grid aspect-[4/3] grid-cols-2 gap-px">
                    <EditedThumb photo={p} original className="size-full" />
                    <EditedThumb photo={p} className="size-full" />
                  </div>
                ) : (
                  <EditedThumb
                    photo={p}
                    original={mode === 'before'}
                    className="aspect-[4/3] w-full"
                  />
                )}
              </button>
              <div className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-mute">{p.name}</span>
                {individual && (
                  <button
                    type="button"
                    title={`Differs in: ${describeOverride(state).join(', ')}. Tap to reset.`}
                    onClick={() => run(ctx, { type: 'resetPhoto', photoId: p.id, keepNorm: true })}
                    className="flex shrink-0 items-center gap-1 rounded-full bg-salmon/15 px-2 py-0.5 font-semibold text-salmon hover:bg-salmon/25"
                  >
                    <RotateCcw className="size-3" /> Individual
                  </button>
                )}
              </div>
              {mode === 'both' && (
                <div className="pointer-events-none absolute top-2 left-2 flex w-[calc(100%-1rem)] justify-between text-[10px] font-bold">
                  <span className="rounded-full bg-black/60 px-2 py-0.5">Before</span>
                  <span className="rounded-full bg-black/60 px-2 py-0.5">After</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
