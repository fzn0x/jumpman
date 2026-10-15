import {
  BASE_LAYER_ID,
  BASIC_SPECS,
  type BasicKey,
  basicSpec,
  formatBasicValue,
} from '@jumpman/core'
import { editor, useEditor } from '../state/editor.ts'
import { Dial } from '../ui/Dial.tsx'
import { cx } from '../ui/primitives.tsx'
import { type BatchContext, basicValue, findLayer, finish, run } from './context.ts'
import { Histogram } from './Histogram.tsx'

export function AdjustPanel({ ctx }: { ctx: BatchContext }) {
  const activeKey = useEditor((s) => s.activeKey)
  const layerId = useEditor((s) => s.layerId)
  const found = findLayer(ctx, layerId)
  const target = found?.layer.kind === 'basic' ? layerId : BASE_LAYER_ID
  const spec = basicSpec(activeKey)
  const value = basicValue(ctx, target, activeKey)
  const targetName = findLayer(ctx, target)?.layer.name ?? 'Global adjust'

  const setValue = (key: BasicKey, v: number, transient: boolean) => {
    const scope =
      findLayer(ctx, target)?.own && ctx.current
        ? ({ kind: 'photo', photoId: ctx.current.id } as const)
        : ctx.scope
    run(ctx, { type: 'setBasic', layerId: target, key, value: v, scope }, transient)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-1 lg:pt-3">
        <Histogram className="h-16 w-full max-lg:hidden" />
        {target !== BASE_LAYER_ID && (
          <p className="mt-2 text-xs text-mute">
            Editing layer <span className="font-semibold text-white">{targetName}</span>
            <button
              type="button"
              className="ml-2 font-semibold text-salmon"
              onClick={() => editor.set({ layerId: BASE_LAYER_ID })}
            >
              Back to global adjust
            </button>
          </p>
        )}
        {(['light', 'color', 'effects'] as const).map((group) => (
          <div key={group} className="mt-2 lg:mt-3">
            <h3 className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-mute-2">
              {group === 'light' ? 'Light' : group === 'color' ? 'Color' : 'Effects'}
            </h3>
            <ul className="grid grid-cols-1 gap-0.5 sm:grid-cols-2 lg:grid-cols-1">
              {BASIC_SPECS.filter((s) => s.group === group).map((s) => {
                const v = basicValue(ctx, target, s.key)
                const active = s.key === activeKey
                return (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => editor.set({ activeKey: s.key })}
                      onDoubleClick={() => {
                        setValue(s.key, 0, false)
                      }}
                      aria-pressed={active}
                      className={cx(
                        'flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[15px] transition lg:py-2.5',
                        active ? 'bg-brand font-semibold text-white' : 'hover:bg-white/6',
                      )}
                    >
                      <span>{s.label}</span>
                      <span
                        className={cx(
                          'tabular-nums',
                          active ? 'text-white' : v ? 'text-white/90' : 'text-mute-2',
                        )}
                      >
                        {formatBasicValue(s.key, v)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        <div className="h-4" />
      </div>
      <div className="border-t border-white/5 px-4 pt-1 pb-1 lg:pt-2 lg:pb-3">
        <div className="mb-1 flex items-baseline justify-between max-lg:hidden">
          <span className="text-sm font-semibold">{spec.label}</span>
          <span className="font-display text-2xl font-bold tabular-nums text-brand">
            {formatBasicValue(activeKey, value)}
          </span>
        </div>
        <Dial
          label={spec.label}
          value={value}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          valueText={formatBasicValue(activeKey, value)}
          onChange={(v) => setValue(activeKey, v, true)}
          onCommit={() => finish(ctx)}
        />
      </div>
    </div>
  )
}
