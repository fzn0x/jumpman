import { useRef } from 'react'

const PX_PER_STEP = 4

/**
 * The dial-style slider: a tick ruler slides under a fixed red indicator.
 * Drag, scroll or use the arrow keys; double-click resets to zero.
 */
export function Dial({
  value,
  min,
  max,
  step,
  label,
  valueText,
  onChange,
  onCommit,
}: {
  value: number
  min: number
  max: number
  step: number
  label: string
  valueText: string
  onChange: (v: number) => void
  onCommit: () => void
}) {
  const drag = useRef<{ x: number; v: number; id: number } | null>(null)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const steps = Math.round((max - min) / step)
  const width = steps * PX_PER_STEP
  const offset = ((value - min) / step) * PX_PER_STEP
  const zero = ((Math.max(min, Math.min(max, 0)) - min) / step) * PX_PER_STEP

  const set = (v: number) => {
    const snapped = Math.round(Math.min(max, Math.max(min, v)) / step) * step
    const fixed = Number(snapped.toFixed(4))
    if (fixed !== value) {
      if ((value < 0 && fixed >= 0) || (value > 0 && fixed <= 0)) navigator.vibrate?.(4)
      onChange(fixed)
    }
  }
  const commitSoon = () => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(onCommit, 350)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className="relative h-16 touch-none select-none overflow-hidden rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-salmon"
      style={{
        maskImage: 'linear-gradient(to right, transparent, black 18%, black 82%, transparent)',
        WebkitMaskImage:
          'linear-gradient(to right, transparent, black 18%, black 82%, transparent)',
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, v: value, id: e.pointerId }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        set(d.v - ((e.clientX - d.x) / PX_PER_STEP) * step)
      }}
      onPointerUp={(e) => {
        if (drag.current?.id === e.pointerId) {
          drag.current = null
          onCommit()
        }
      }}
      onPointerCancel={() => {
        drag.current = null
        onCommit()
      }}
      onDoubleClick={() => {
        set(0)
        onCommit()
      }}
      onWheel={(e) => {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        set(value + Math.sign(delta) * step * (e.shiftKey ? 5 : 1))
        commitSoon()
      }}
      onKeyDown={(e) => {
        const big = e.shiftKey ? 10 : 1
        let handled = true
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(value + step * big)
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(value - step * big)
        else if (e.key === 'Home') set(min)
        else if (e.key === 'End') set(max)
        else if (e.key === '0' || e.key === 'Delete' || e.key === 'Backspace') set(0)
        else handled = false
        if (handled) {
          e.preventDefault()
          commitSoon()
        }
      }}
    >
      <div
        className="absolute top-3 h-7"
        style={{
          left: `calc(50% - ${offset}px)`,
          width,
          backgroundImage: `repeating-linear-gradient(to right, var(--color-mute) 0 2px, transparent 2px ${PX_PER_STEP * 25}px), repeating-linear-gradient(to right, var(--color-mute-2) 0 1px, transparent 1px ${PX_PER_STEP * 5}px)`,
          backgroundSize: `${width + 2}px 28px, ${width + 1}px 16px`,
          backgroundPosition: '0 0, 0 6px',
          backgroundRepeat: 'no-repeat',
        }}
      >
        <span
          className="absolute -top-2 size-1.5 -translate-x-1/2 rounded-full bg-white"
          style={{ left: zero + 1 }}
        />
      </div>
      <span className="pointer-events-none absolute top-1.5 left-1/2 h-10 w-[3px] -translate-x-1/2 rounded-full bg-brand shadow-[0_0_12px_rgb(224_0_0/0.6)]" />
    </div>
  )
}
