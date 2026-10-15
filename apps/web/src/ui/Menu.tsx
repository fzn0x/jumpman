import type { LucideIcon } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { cx } from './primitives.tsx'

export interface MenuItem {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  hint?: string
}

/** A small popover menu anchored to a trigger button. */
export function Menu({
  trigger,
  items,
  align = 'right',
  label,
}: {
  trigger: (props: {
    onClick: () => void
    'aria-expanded': boolean
    'aria-haspopup': 'menu'
  }) => ReactNode
  items: (MenuItem | 'divider')[]
  align?: 'left' | 'right'
  label: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    addEventListener('pointerdown', onDown)
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('pointerdown', onDown)
      removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      {trigger({
        onClick: () => setOpen((o) => !o),
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cx(
            'absolute top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-ink-2/98 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) =>
            item === 'divider' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: static separators
              <div key={`d${i}`} className="my-1 h-px bg-white/8" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className={cx(
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition disabled:opacity-40',
                  item.danger ? 'text-[#ff6b6b] hover:bg-[#ff6b6b]/10' : 'hover:bg-white/8',
                )}
              >
                {item.icon && <item.icon className="size-[18px] shrink-0 opacity-80" />}
                <span className="flex-1">{item.label}</span>
                {item.hint && <span className="text-xs text-mute">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
