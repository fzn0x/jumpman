import { hasOverride } from '@jumpman/core'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { editor } from '../state/editor.ts'
import { cx } from '../ui/primitives.tsx'
import type { BatchContext } from './context.ts'

/** The mockup's dot indicator for flipping between the photos of a batch. */
export function PhotoDots({ ctx }: { ctx: BatchContext }) {
  const n = ctx.photos.length
  if (n < 2) return <div className="h-3" />
  const many = n > 14
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2.5">
      <button
        type="button"
        aria-label="Previous photo"
        disabled={ctx.index === 0}
        onClick={() => editor.set({ index: ctx.index - 1 })}
        className="grid size-7 place-items-center rounded-full text-mute hover:text-white disabled:opacity-30"
      >
        <ChevronLeft className="size-4" />
      </button>
      {many ? (
        <span className="min-w-16 text-center text-xs font-semibold tabular-nums text-mute">
          {ctx.index + 1} / {n}
        </span>
      ) : (
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Photos in this batch">
          {ctx.photos.map((p, i) => {
            const individual = hasOverride(ctx.branch.photos[p.id])
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={i === ctx.index}
                aria-label={`${p.name}${individual ? ' (edited individually)' : ''}`}
                onClick={() => editor.set({ index: i })}
                className="grid size-5 place-items-center"
              >
                <span
                  className={cx(
                    'block rounded-full transition-all duration-200',
                    i === ctx.index ? 'h-2 w-5 bg-white' : 'size-2 bg-white/30 hover:bg-white/60',
                    individual && i !== ctx.index && 'bg-salmon',
                  )}
                />
              </button>
            )
          })}
        </div>
      )}
      <button
        type="button"
        aria-label="Next photo"
        disabled={ctx.index >= n - 1}
        onClick={() => editor.set({ index: ctx.index + 1 })}
        className="grid size-7 place-items-center rounded-full text-mute hover:text-white disabled:opacity-30"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}
