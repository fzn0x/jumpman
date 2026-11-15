import {
  BRUSH_LIMITS,
  type BrushMask,
  type BrushStroke,
  brushPointCount,
  type EditOp,
  frameToSource,
  type Layer,
  quantizeBrushValue,
  type Scope,
} from '@jumpman/core'
import { Brush, Check, Eraser, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FrameSpec } from '../lib/geometry.ts'
import { BRUSH_SIZES, editor, toast, useEditor } from '../state/editor.ts'
import { commit, dispatch } from '../state/library.ts'
import { Button, IconButton, Segmented, Slider } from '../ui/primitives.tsx'
import { type BatchContext, findLayer, run } from './context.ts'

export interface BrushTarget {
  layer: Layer
  mask: BrushMask
  scope: Scope
  /** Batch layers are painted in Global mode only, like other masks. */
  editable: boolean
}

/** The brush-masked layer being painted, if painting is on. */
export function brushTarget(ctx: BatchContext, layerId: string | null): BrushTarget | null {
  if (!layerId) return null
  const found = findLayer(ctx, layerId)
  const mask = found?.layer.mask
  if (!found || mask?.type !== 'brush') return null
  const scope: Scope =
    found.own && ctx.current ? { kind: 'photo', photoId: ctx.current.id } : ctx.scope
  return { layer: found.layer, mask, scope, editable: found.own || ctx.mode === 'global' }
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** Paint / Erase, Size, Feather, Flow, overlay and Clear for the painted layer. */
export function BrushToolbar({ ctx }: { ctx: BatchContext }) {
  const layerId = useEditor((s) => s.maskLayerId)
  const brush = useEditor((s) => s.brush)
  const target = brushTarget(ctx, layerId)
  if (!target) return null
  const done = (
    <Button
      size="sm"
      variant="light"
      icon={Check}
      onClick={() => editor.set({ maskLayerId: null })}
    >
      Done
    </Button>
  )
  if (!target.editable) {
    return (
      <div className="mb-3 flex items-center gap-3 rounded-2xl bg-ink-2 p-3 text-xs text-mute">
        <p className="flex-1">Switch to Global to paint the mask of a batch layer.</p>
        {done}
      </div>
    )
  }
  const { layer, mask, scope } = target
  return (
    <section
      aria-label="Brush"
      className="sticky top-0 z-10 -mx-4 mb-3 border-b border-white/5 bg-ink px-4 pt-1 pb-2"
    >
      <div className="flex items-center gap-2">
        <Segmented
          size="sm"
          label="Brush mode"
          value={brush.mode}
          onChange={(mode) => editor.setBrush({ mode })}
          options={[
            {
              value: 'paint',
              label: (
                <span className="inline-flex items-center gap-1">
                  <Brush className="size-3.5" /> Paint
                </span>
              ),
            },
            {
              value: 'erase',
              label: (
                <span className="inline-flex items-center gap-1">
                  <Eraser className="size-3.5" /> Erase
                </span>
              ),
            },
          ]}
        />
        <span className="flex-1" />
        <IconButton
          size="sm"
          icon={brush.overlay ? Eye : EyeOff}
          label="Show mask overlay"
          active={brush.overlay}
          onClick={() => editor.setBrush({ overlay: !brush.overlay })}
        />
        <IconButton
          size="sm"
          icon={Trash2}
          label="Clear mask"
          disabled={!mask.strokes.length}
          onClick={() =>
            run(ctx, {
              type: 'updateLayer',
              layerId: layer.id,
              patch: { mask: { ...mask, strokes: [] } },
              scope,
            })
          }
        />
        {done}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Slider
          label="Size"
          value={brush.size}
          min={BRUSH_SIZES.min}
          max={BRUSH_SIZES.max}
          step={0.005}
          format={(v) => `${Math.round(v * 1000) / 10}%`}
          onChange={(size) => editor.setBrush({ size })}
        />
        <Slider
          label="Feather"
          value={brush.feather}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(feather) => editor.setBrush({ feather })}
        />
        <Slider
          label="Flow"
          value={brush.flow}
          min={0.05}
          max={1}
          step={0.01}
          format={pct}
          onChange={(flow) => editor.setBrush({ flow })}
        />
      </div>
    </section>
  )
}

interface LiveStroke {
  batchId: string
  pointerId: number
  layerId: string
  scope: Scope
  /** The mask before this stroke. */
  base: BrushMask
  stroke: BrushStroke
  /** Points this stroke may still add. */
  budget: number
  raf: number
}

/**
 * Pointer surface over the preview while a brush mask is painted. Mouse,
 * touch and pen all paint; each stroke previews live and lands as one undo
 * step when the pointer lifts.
 */
export function BrushPainter({
  ctx,
  frame,
  w,
}: {
  ctx: BatchContext
  frame: FrameSpec
  /** Preview width in CSS pixels. */
  w: number
}) {
  const layerId = useEditor((s) => s.maskLayerId)
  const brush = useEditor((s) => s.brush)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const live = useRef<LiveStroke | null>(null)
  // Leaving mid-stroke (e.g. switching tabs) still lands the stroke as one step.
  useEffect(
    () => () => {
      const l = live.current
      if (!l) return
      if (l.raf) cancelAnimationFrame(l.raf)
      live.current = null
      commit(l.batchId)
    },
    [],
  )
  const photo = ctx.current
  const target = brushTarget(ctx, layerId)
  if (!photo || !target?.editable) return null
  const batchId = ctx.batch.id
  const shortSide = Math.min(photo.width, photo.height)
  // CSS pixels per full-resolution photo pixel.
  const scale = w / Math.max(1, frame.width)
  const ring = brush.size * shortSide * scale

  const local = (e: { clientX: number; clientY: number }, el: Element) => {
    const r = el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top, rw: r.width || 1, rh: r.height || 1 }
  }
  const toSource = (e: { clientX: number; clientY: number }, el: Element) => {
    const p = local(e, el)
    const s = frameToSource(p.x / p.rw, p.y / p.rh, frame)
    return [quantizeBrushValue(s.x), quantizeBrushValue(s.y)] as const
  }
  const opFor = (l: LiveStroke): EditOp => ({
    type: 'updateLayer',
    layerId: l.layerId,
    patch: {
      mask: {
        ...l.base,
        strokes: [...l.base.strokes, { ...l.stroke, points: l.stroke.points.slice() }],
      },
    },
    scope: l.scope,
  })
  const flush = () => {
    const l = live.current
    if (!l) return
    l.raf = 0
    dispatch(batchId, opFor(l), { transient: true })
  }
  /** Adds a point once the pointer moved a quarter of the brush radius. */
  const add = (x: number, y: number, force = false) => {
    const l = live.current
    if (!l || l.budget <= 0) return
    const pts = l.stroke.points
    const dx = (x - (pts[pts.length - 2] as number)) * photo.width
    const dy = (y - (pts[pts.length - 1] as number)) * photo.height
    const d = Math.hypot(dx, dy)
    if (d === 0 || (!force && d < Math.max(1, l.stroke.size * shortSide * 0.25))) return
    pts.push(x, y)
    l.budget--
  }
  const end = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const l = live.current
    if (!l || l.pointerId !== e.pointerId) return
    if (!cancelled) {
      const [x, y] = toSource(e, e.currentTarget)
      add(x, y, true)
    }
    if (l.raf) cancelAnimationFrame(l.raf)
    flush()
    live.current = null
    commit(batchId)
    editor.record({ kind: 'op', op: opFor(l) })
    if (e.pointerType !== 'mouse') setCursor(null)
  }

  return (
    <div
      role="application"
      className="absolute inset-0 cursor-none touch-none"
      aria-label={`Paint the mask of ${target.layer.name}`}
      onPointerDown={(e) => {
        if (live.current || (e.pointerType === 'mouse' && e.button !== 0)) return
        const { mask } = target
        const used = brushPointCount(mask)
        if (mask.strokes.length >= BRUSH_LIMITS.maxStrokes || used >= BRUSH_LIMITS.maxPoints) {
          toast('This brush mask is full. Clear it or paint on another layer.')
          return
        }
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const [x, y] = toSource(e, e.currentTarget)
        live.current = {
          batchId,
          pointerId: e.pointerId,
          layerId: target.layer.id,
          scope: target.scope,
          base: mask,
          stroke: {
            mode: brush.mode,
            size: quantizeBrushValue(brush.size),
            feather: quantizeBrushValue(brush.feather),
            flow: quantizeBrushValue(brush.flow),
            points: [x, y],
          },
          budget: BRUSH_LIMITS.maxPoints - used - 1,
          raf: 0,
        }
        const p = local(e, e.currentTarget)
        setCursor({ x: p.x, y: p.y })
        flush()
      }}
      onPointerMove={(e) => {
        const p = local(e, e.currentTarget)
        setCursor({ x: p.x, y: p.y })
        const l = live.current
        if (!l || l.pointerId !== e.pointerId) return
        const events = e.nativeEvent.getCoalescedEvents?.() ?? []
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const [x, y] = toSource(ev, e.currentTarget)
          add(x, y)
        }
        if (!l.raf) l.raf = requestAnimationFrame(flush)
      }}
      onPointerUp={(e) => end(e)}
      onPointerCancel={(e) => end(e, true)}
      onPointerLeave={() => {
        if (!live.current) setCursor(null)
      }}
    >
      {cursor && (
        <svg
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
          aria-hidden="true"
        >
          <circle
            cx={cursor.x}
            cy={cursor.y}
            r={ring}
            className="fill-none stroke-black/50"
            strokeWidth={3}
          />
          <circle
            cx={cursor.x}
            cy={cursor.y}
            r={ring}
            className={
              brush.mode === 'erase' ? 'fill-none stroke-salmon' : 'fill-none stroke-white'
            }
            strokeWidth={1.5}
            strokeDasharray={brush.mode === 'erase' ? '4 3' : undefined}
          />
          {brush.feather > 0.05 && (
            <circle
              cx={cursor.x}
              cy={cursor.y}
              r={ring * (1 - brush.feather)}
              className="fill-none stroke-white/50"
              strokeWidth={1}
            />
          )}
          <circle cx={cursor.x} cy={cursor.y} r={1.5} className="fill-white" />
        </svg>
      )}
    </div>
  )
}
