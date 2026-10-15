import type { Histogram as HistogramData } from '@jumpman/renderer'
import { create } from 'zustand'
import { cx } from '../ui/primitives.tsx'

export const useHistogram = create<{ data: HistogramData | null }>(() => ({ data: null }))

/** RGB histogram of the current render. Clipping spikes at the ends don't flatten the rest. */
export function Histogram({ className = 'h-16 w-full' }: { className?: string }) {
  const data = useHistogram((s) => s.data)
  if (!data) return <div className={cx('rounded-xl bg-ink-2', className)} />
  const n = data.r.length
  let max = 1
  for (const arr of [data.r, data.g, data.b])
    for (let i = 1; i < n - 1; i++) max = Math.max(max, arr[i] ?? 0)
  const path = (arr: Uint32Array) => {
    let d = 'M0,64'
    for (let i = 0; i < n; i++) {
      const v = Math.sqrt(Math.min(1, (arr[i] ?? 0) / max))
      d += ` L${((i / (n - 1)) * 256).toFixed(1)},${(64 - v * 58).toFixed(1)}`
    }
    return `${d} L256,64 Z`
  }
  return (
    <svg
      viewBox="0 0 256 64"
      preserveAspectRatio="none"
      className={cx('rounded-xl bg-ink-2/90', className)}
      role="img"
      aria-label="Histogram"
    >
      <g style={{ mixBlendMode: 'screen' }}>
        <path d={path(data.r)} fill="rgb(255 70 70 / 0.6)" />
        <path d={path(data.g)} fill="rgb(70 220 110 / 0.55)" />
        <path d={path(data.b)} fill="rgb(80 130 255 / 0.6)" />
      </g>
    </svg>
  )
}
