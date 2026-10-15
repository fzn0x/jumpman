import { type Mask, rotatedSize } from '@jumpman/core'
import { GLRenderer } from '@jumpman/renderer'
import { useEffect, useRef, useState } from 'react'
import { type FrameSpec, frameOf, placementOf, renderSize } from '../lib/geometry.ts'
import { useSize } from '../lib/hooks.ts'
import { resolveLut } from '../lib/luts.ts'
import { previewBitmap, thumbBitmap } from '../lib/media.ts'
import { editor, useEditor } from '../state/editor.ts'
import { commit, dispatch, useLibrary } from '../state/library.ts'
import { layersFor } from '../state/selectors.ts'
import { cx } from '../ui/primitives.tsx'
import { type BatchContext, findLayer, run } from './context.ts'
import { Histogram, useHistogram } from './Histogram.tsx'

function fullFrame(w: number, h: number, rotate: number, flipH: boolean): FrameSpec {
  const r = rotatedSize(w, h, rotate)
  return { rect: { x: 0, y: 0, w: 1, h: 1 }, rotate, flipH, width: r.w, height: r.h }
}

export function Viewport({ ctx }: { ctx: BatchContext }) {
  const box = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<GLRenderer | null>(null)
  const [glError, setGlError] = useState<string | null>(null)
  const [imageReady, setImageReady] = useState<string | null>(null)
  const size = useSize(box)
  const photos = useLibrary((s) => s.photos)
  const lutVersion = useLibrary((s) => s.lutVersion)
  const tab = useEditor((s) => s.tab)
  const compare = useEditor((s) => s.compare)
  const splitPos = useEditor((s) => s.splitPos)
  const maskLayerId = useEditor((s) => s.maskLayerId)
  const tabRef = useRef(tab)
  tabRef.current = tab
  const photo = ctx.current
  const cropping = tab === 'crop'
  const placement = placementOf(ctx.state)
  const frame = photo
    ? cropping
      ? fullFrame(photo.width, photo.height, placement.rotate, placement.flipH)
      : frameOf(photo, ctx.branch.global, ctx.state)
    : null
  const layers = photo ? layersFor(ctx.batch, photos, photo.id) : []
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
  const view =
    frame && size.width
      ? renderSize(frame.width, frame.height, size.width - 24, size.height - 24, dpr, 3072)
      : null

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    try {
      renderer.current = new GLRenderer(c)
    } catch (e) {
      setGlError((e as Error).message)
    }
    return () => {
      renderer.current?.dispose(false)
      renderer.current = null
    }
  }, [])

  // Load the preview for the current photo (thumbnail first for instant feedback).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload only when the photo changes
  useEffect(() => {
    if (!photo) return
    let alive = true
    let full = false
    void thumbBitmap(photo).then((t) => {
      if (!alive || !t || full) return
      renderer.current?.setImage(t, `${photo.id}@thumb`)
      setImageReady(`${photo.id}@thumb`)
    })
    void previewBitmap(photo).then((p) => {
      if (!alive || !p) return
      full = true
      renderer.current?.setImage(p, photo.id)
      setImageReady(photo.id)
    })
    return () => {
      alive = false
    }
  }, [photo?.id])

  const renderKey = JSON.stringify([layers, frame, view, compare, splitPos, imageReady, lutVersion])
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderKey captures every render input
  useEffect(() => {
    const r = renderer.current
    if (!r || !frame || !view || !photo || !imageReady) return
    const raf = requestAnimationFrame(() => {
      r.render({
        layers,
        luts: resolveLut,
        width: view.w,
        height: view.h,
        rect: frame.rect,
        rotate: frame.rotate,
        flipH: frame.flipH,
        ...(photo.stats ? { subject: photo.stats.subject } : {}),
        showOriginal: compare === 'hold',
        split: compare === 'split' ? splitPos : 0,
      })
      if (tabRef.current === 'adjust' || tabRef.current === 'color') {
        useHistogram.setState({ data: r.histogram(64) })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [renderKey])

  // Swipe between photos.
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null)
  const go = (delta: number) => {
    const next = ctx.index + delta
    if (next >= 0 && next < ctx.photos.length) editor.set({ index: next })
  }

  const mask = maskLayerId ? findLayer(ctx, maskLayerId)?.layer.mask : undefined

  return (
    <div
      ref={box}
      className="relative grid min-h-0 flex-1 touch-pan-y place-items-center overflow-hidden select-none"
      onPointerDown={(e) => {
        if (cropping || mask) return
        swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
      }}
      onPointerUp={(e) => {
        const s = swipe.current
        swipe.current = null
        if (!s || s.id !== e.pointerId) return
        const dx = e.clientX - s.x
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y) * 1.5) go(dx < 0 ? 1 : -1)
      }}
    >
      <div className="relative" style={view ? { width: view.cssW, height: view.cssH } : undefined}>
        <canvas
          ref={canvasRef}
          className={cx(
            'block size-full rounded-sm shadow-2xl shadow-black/50 transition-opacity',
            !imageReady && 'opacity-0',
          )}
          aria-label={photo ? `Edited preview of ${photo.name}` : 'Preview'}
          role="img"
        />
        {(tab === 'adjust' || tab === 'color') && !cropping && (
          <div className="pointer-events-none absolute top-2 left-2 opacity-90 lg:hidden">
            <Histogram className="h-9 w-24 rounded-lg" />
          </div>
        )}
        {compare === 'split' && view && <SplitHandle width={view.cssW} />}
        {cropping && view && photo && <CropOverlay ctx={ctx} w={view.cssW} h={view.cssH} />}
        {!cropping && mask && view && frame && maskLayerId && (
          <MaskHandles
            ctx={ctx}
            layerId={maskLayerId}
            mask={mask}
            frame={frame}
            w={view.cssW}
            h={view.cssH}
          />
        )}
      </div>
      {glError && (
        <p className="absolute inset-x-6 text-center text-sm text-mute">
          This device can’t run the WebGL2 renderer ({glError}). Try a recent version of Chrome,
          Edge, Firefox or Safari.
        </p>
      )}
    </div>
  )
}

function SplitHandle({ width }: { width: number }) {
  const pos = useEditor((s) => s.splitPos)
  return (
    <div
      className="absolute inset-y-0 w-10 -translate-x-1/2 cursor-ew-resize touch-none"
      style={{ left: pos * width }}
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
        editor.set({
          splitPos: Math.min(0.98, Math.max(0.02, (e.clientX - rect.left) / rect.width)),
        })
      }}
    >
      <span className="absolute top-1/2 left-1/2 grid size-8 -translate-1/2 place-items-center rounded-full bg-white text-[10px] font-bold text-ink shadow-lg">
        ⇆
      </span>
      <span className="absolute top-2 left-[-46px] rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold">
        Before
      </span>
      <span className="absolute top-2 left-[34px] rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold">
        After
      </span>
    </div>
  )
}

function CropOverlay({ ctx, w, h }: { ctx: BatchContext; w: number; h: number }) {
  const photo = ctx.current
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  if (!photo) return null
  const frame = frameOf(photo, ctx.branch.global, ctx.state)
  const p = placementOf(ctx.state)
  const r = frame.rect
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className="absolute cursor-move touch-none border-2 border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.55)]"
        style={{ left: r.x * w, top: r.y * h, width: r.w * w, height: r.h * h }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, cx: p.cx, cy: p.cy }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const cx = Math.min(1, Math.max(0, d.cx + (e.clientX - d.x) / w))
          const cy = Math.min(1, Math.max(0, d.cy + (e.clientY - d.y) / h))
          dispatch(
            ctx.batch.id,
            { type: 'setCrop', photoId: photo.id, placement: { cx, cy } },
            { transient: true },
          )
        }}
        onPointerUp={() => {
          drag.current = null
          commit(ctx.batch.id)
        }}
      >
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static grid
            <span key={i} className="border border-white/25" />
          ))}
        </div>
      </div>
    </div>
  )
}

function MaskHandles({
  ctx,
  layerId,
  mask,
  frame,
  w,
  h,
}: {
  ctx: BatchContext
  layerId: string
  mask: Mask
  frame: FrameSpec
  w: number
  h: number
}) {
  const found = findLayer(ctx, layerId)
  const drag = useRef<string | null>(null)
  if (!found || (mask.type !== 'radial' && mask.type !== 'linear')) return null
  const scope =
    found.own && ctx.current ? ({ kind: 'photo', photoId: ctx.current.id } as const) : ctx.scope
  // Image-space (rotated, uncropped) <-> frame-space conversions.
  const toScreen = (x: number, y: number) => ({
    x: ((x - frame.rect.x) / frame.rect.w) * w,
    y: ((y - frame.rect.y) / frame.rect.h) * h,
  })
  const toImage = (sx: number, sy: number) => ({
    x: frame.rect.x + (sx / w) * frame.rect.w,
    y: frame.rect.y + (sy / h) * frame.rect.h,
  })
  const update = (next: Mask, transient: boolean) =>
    run(ctx, { type: 'updateLayer', layerId, patch: { mask: next }, scope }, transient)

  const onMove = (e: React.PointerEvent) => {
    const key = drag.current
    if (!key) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const pt = toImage(e.clientX - rect.left, e.clientY - rect.top)
    if (mask.type === 'radial') {
      if (key === 'c') update({ ...mask, cx: pt.x, cy: pt.y }, true)
      if (key === 'rx') update({ ...mask, rx: Math.max(0.02, Math.abs(pt.x - mask.cx)) }, true)
      if (key === 'ry') update({ ...mask, ry: Math.max(0.02, Math.abs(pt.y - mask.cy)) }, true)
    } else {
      if (key === 'a') update({ ...mask, x0: pt.x, y0: pt.y }, true)
      if (key === 'b') update({ ...mask, x1: pt.x, y1: pt.y }, true)
    }
  }
  const handle = (key: string, x: number, y: number, label: string) => (
    <circle
      key={key}
      cx={x}
      cy={y}
      r={11}
      aria-label={label}
      className="cursor-grab fill-white/90 stroke-brand"
      strokeWidth={3}
      onPointerDown={(e) => {
        ;(e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId)
        drag.current = key
      }}
    />
  )
  let content: React.ReactNode
  if (mask.type === 'radial') {
    const c = toScreen(mask.cx, mask.cy)
    const rx = (mask.rx / frame.rect.w) * w
    const ry = (mask.ry / frame.rect.h) * h
    content = (
      <>
        <ellipse
          cx={c.x}
          cy={c.y}
          rx={rx}
          ry={ry}
          className="fill-brand/15 stroke-white"
          strokeWidth={2}
          strokeDasharray="6 5"
        />
        <ellipse
          cx={c.x}
          cy={c.y}
          rx={rx * (1 - mask.feather)}
          ry={ry * (1 - mask.feather)}
          className="fill-none stroke-white/50"
          strokeWidth={1}
        />
        {handle('c', c.x, c.y, 'Move mask')}
        {handle('rx', c.x + rx, c.y, 'Mask width')}
        {handle('ry', c.x, c.y + ry, 'Mask height')}
      </>
    )
  } else {
    const a = toScreen(mask.x0, mask.y0)
    const b = toScreen(mask.x1, mask.y1)
    content = (
      <>
        <line
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          className="stroke-white"
          strokeWidth={2}
          strokeDasharray="6 5"
        />
        {handle('a', a.x, a.y, 'Gradient start (full effect)')}
        {handle('b', b.x, b.y, 'Gradient end (no effect)')}
      </>
    )
  }
  return (
    <svg
      className="absolute inset-0 size-full touch-none overflow-visible"
      onPointerMove={onMove}
      onPointerUp={() => {
        drag.current = null
        commit(ctx.batch.id)
      }}
      aria-hidden="true"
    >
      {content}
    </svg>
  )
}
