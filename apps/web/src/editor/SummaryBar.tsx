import { BASE_LAYER_ID, type BasicKey, formatBasicValue, hasOverride } from '@jumpman/core'
import { Redo2, RotateCcw, Undo2 } from 'lucide-react'
import { editor, useEditor } from '../state/editor.ts'
import { redo, undo, useLibrary } from '../state/library.ts'
import { cx, IconButton } from '../ui/primitives.tsx'
import { type BatchContext, finish, run, summaryValues } from './context.ts'

const KEYS: BasicKey[] = ['brightness', 'exposure', 'highlights', 'shadows', 'saturation']
const LABELS: Record<string, string> = {
  brightness: 'Brightness',
  exposure: 'Exposure',
  highlights: 'Highlights',
  shadows: 'Shadows',
  saturation: 'Saturation',
}

/** The global edit at a glance (mockup summary bar), plus the per-photo override indicator. */
export function SummaryBar({ ctx, withHistory }: { ctx: BatchContext; withHistory?: boolean }) {
  const history = useLibrary((s) => s.histories[ctx.batch.id])
  const activeKey = useEditor((s) => s.activeKey)
  const values = summaryValues(ctx, BASE_LAYER_ID)
  const individual = hasOverride(ctx.state)
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => editor.set({ activeKey: k, tab: 'adjust', layerId: BASE_LAYER_ID })}
            className={cx(
              'flex shrink-0 flex-col items-start rounded-xl px-2.5 py-1 transition',
              activeKey === k ? 'bg-white/10' : 'hover:bg-white/6',
            )}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-mute">
              {LABELS[k]}
            </span>
            <span
              className={cx(
                'text-sm font-bold tabular-nums',
                values[k] ? 'text-white' : 'text-mute-2',
              )}
            >
              {formatBasicValue(k, values[k])}
            </span>
          </button>
        ))}
      </div>
      {individual && ctx.current && (
        <button
          type="button"
          onClick={() => {
            run(ctx, {
              type: 'resetPhoto',
              photoId: (ctx.current as { id: string }).id,
              keepNorm: true,
            })
            finish(ctx)
          }}
          title="This photo deviates from the global edit. Tap to reset it."
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-salmon/15 px-3 py-1.5 text-xs font-semibold text-salmon hover:bg-salmon/25"
        >
          <RotateCcw className="size-3.5" />
          Reset photo
        </button>
      )}
      {withHistory && (
        <div className="flex shrink-0">
          <IconButton
            icon={Undo2}
            size="sm"
            label="Undo"
            disabled={!(history?.past.length || history?.pending)}
            onClick={() => undo(ctx.batch.id)}
          />
          <IconButton
            icon={Redo2}
            size="sm"
            label="Redo"
            disabled={!history?.future.length}
            onClick={() => redo(ctx.batch.id)}
          />
        </div>
      )}
    </div>
  )
}
