import type { LucideIcon } from 'lucide-react'
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useId, useRef } from 'react'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand text-white hover:bg-brand-hover active:scale-[0.98] disabled:bg-ink-3 disabled:text-mute',
  secondary: 'bg-ink-2 text-white hover:bg-ink-3 active:scale-[0.98] disabled:text-mute-2',
  ghost: 'bg-transparent text-white hover:bg-white/8 disabled:text-mute-2',
  danger: 'bg-transparent text-[#ff6b6b] hover:bg-[#ff6b6b]/10',
  light: 'bg-white text-ink hover:bg-white/90 active:scale-[0.98]',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  icon?: LucideIcon
}) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-full font-semibold transition duration-150',
        size === 'sm' && 'h-8 px-3 text-[13px]',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-13 px-6 text-base',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className={size === 'sm' ? 'size-4' : 'size-[18px]'} strokeWidth={2.2} />}
      {children}
    </button>
  )
}

export function IconButton({
  icon: Icon,
  label,
  active,
  className,
  size = 'md',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon
  label: string
  active?: boolean
  size?: 'sm' | 'md'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        'inline-grid shrink-0 place-items-center rounded-full transition duration-150 disabled:opacity-35',
        size === 'md' ? 'size-10' : 'size-8',
        active ? 'bg-white text-ink' : 'text-white hover:bg-white/10',
        className,
      )}
      {...rest}
    >
      <Icon className={size === 'md' ? 'size-5' : 'size-4'} strokeWidth={2} />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  className?: string
  size?: 'sm' | 'md'
  label: string
}) {
  return (
    <fieldset className={cx('inline-flex rounded-full bg-ink-2 p-1', className)}>
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-full font-semibold transition duration-150',
            size === 'md' ? 'h-8 px-4 text-[13px]' : 'h-7 px-3 text-xs',
            value === o.value ? 'bg-white text-ink shadow' : 'text-mute hover:text-white',
          )}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description?: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-semibold">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-relaxed text-mute">{description}</span>
        )}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-brand' : 'bg-ink-3',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0 size-6 rounded-full bg-white shadow transition-transform duration-200 ease-snap',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  format,
  track,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  onCommit?: () => void
  format?: (v: number) => string
  track?: string
}) {
  const id = useId()
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-baseline justify-between text-[13px]">
        <label htmlFor={id} className="font-medium text-mute">
          {label}
        </label>
        <button
          type="button"
          className="tabular-nums text-white/90 hover:text-white"
          title="Double-click to reset"
          onDoubleClick={() => {
            onChange(min < 0 ? 0 : min)
            onCommit?.()
          }}
        >
          {format ? format(value) : value}
        </button>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onDoubleClick={() => {
          onChange(min < 0 ? 0 : min)
          onCommit?.()
        }}
        className="jm-range w-full"
        style={
          { '--pct': `${pct}%`, ...(track ? { '--track': track } : {}) } as React.CSSProperties
        }
      />
    </div>
  )
}

export function Chip({
  active,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cx(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition',
        active ? 'bg-white text-ink' : 'bg-ink-2 text-white/85 hover:bg-ink-3',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/** Modal bottom sheet on phones, centered dialog on larger screens. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse shortcut; Escape closes <dialog> natively
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cx(
        'jm-sheet m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-[28px] bg-ink text-white backdrop:bg-black/60 backdrop:backdrop-blur-sm sm:m-auto sm:rounded-[28px]',
        wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
            <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1.5 text-sm font-semibold text-mute hover:bg-white/10 hover:text-white"
            >
              Done
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </div>
      )}
    </dialog>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-4 mb-2 flex items-center justify-between first:mt-1">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-mute">{children}</h3>
      {action}
    </div>
  )
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-3">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300"
          style={{ width: `${value * 100}%` }}
        />
      </div>
    </div>
  )
}

export function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-ink-2 text-mute">
        <Icon className="size-6" />
      </div>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-xs text-sm text-mute">{children}</div>}
    </div>
  )
}
