import {
  type CurvePoint,
  type CurvesParams,
  curveEvaluator,
  type HslParams,
  HUE_BANDS,
  type HueBand,
  hueColor,
  type Layer,
  type LayerKind,
  rgbToHex,
  type SplitParams,
} from '@jumpman/core'
import { RotateCcw } from 'lucide-react'
import { useRef } from 'react'
import { type CurveChannel, editor, useEditor } from '../state/editor.ts'
import { Button, Chip, cx, Segmented, Slider } from '../ui/primitives.tsx'
import { type BatchContext, ensureLayer, finish, paramsOf, run, targetLayer } from './context.ts'
import { useHistogram } from './Histogram.tsx'

const BAND_COLORS: Record<HueBand, string> = {
  red: '#ff3b30',
  orange: '#ff9500',
  yellow: '#ffd60a',
  green: '#34c759',
  aqua: '#32d1c4',
  blue: '#0a84ff',
  purple: '#8e5cf7',
  magenta: '#ff2d92',
}

const RAINBOW = 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)'

function scopeFor(ctx: BatchContext, layer: Layer) {
  const own = ctx.state?.override.layers?.some((l) => l.id === layer.id)
  return own && ctx.current ? ({ kind: 'photo', photoId: ctx.current.id } as const) : ctx.scope
}

/** Writes new params to the target layer of a kind, creating it on first use. */
function writerFor<K extends LayerKind>(ctx: BatchContext, kind: K) {
  return (params: Layer['params'], transient: boolean) => {
    const layer = ensureLayer(ctx, kind)
    run(
      ctx,
      { type: 'setLayerParams', layerId: layer.id, params, scope: scopeFor(ctx, layer) },
      transient,
    )
  }
}

function HslTool({ ctx }: { ctx: BatchContext }) {
  const band = useEditor((s) => s.hslBand)
  const layer = targetLayer(ctx, 'hsl')
  const params: HslParams | null = layer ? paramsOf(ctx, layer) : null
  const write = writerFor(ctx, 'hsl')
  const cur = params?.[band] ?? { hue: 0, saturation: 0, luminance: 0 }
  const set = (key: 'hue' | 'saturation' | 'luminance', v: number) => {
    const base =
      params ??
      (Object.fromEntries(
        HUE_BANDS.map((b) => [b, { hue: 0, saturation: 0, luminance: 0 }]),
      ) as HslParams)
    write({ ...base, [band]: { ...base[band], [key]: v } }, true)
  }
  const c = BAND_COLORS[band]
  return (
    <div>
      <div className="flex justify-between gap-1 py-2" role="radiogroup" aria-label="Color band">
        {HUE_BANDS.map((b) => {
          const touched = params && (params[b].hue || params[b].saturation || params[b].luminance)
          return (
            // biome-ignore lint/a11y/useSemanticElements: color swatches styled as buttons
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={band === b}
              aria-label={b}
              onClick={() => editor.set({ hslBand: b })}
              className={cx(
                'relative size-9 rounded-full transition',
                band === b
                  ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-ink'
                  : 'opacity-80 hover:opacity-100',
              )}
              style={{ background: BAND_COLORS[b] }}
            >
              {touched && (
                <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-ink bg-white" />
              )}
            </button>
          )
        })}
      </div>
      <Slider
        label="Hue"
        value={cur.hue}
        min={-100}
        max={100}
        format={(v) => (v > 0 ? `+${v}` : `${v}`)}
        track={`linear-gradient(to right, ${rgbToHex(hueColor(HUE_ANGLE[band] - 30))}, ${c}, ${rgbToHex(hueColor(HUE_ANGLE[band] + 30))})`}
        onChange={(v) => set('hue', v)}
        onCommit={() => finish(ctx)}
      />
      <Slider
        label="Saturation"
        value={cur.saturation}
        min={-100}
        max={100}
        format={(v) => (v > 0 ? `+${v}` : `${v}`)}
        track={`linear-gradient(to right, #777, ${c})`}
        onChange={(v) => set('saturation', v)}
        onCommit={() => finish(ctx)}
      />
      <Slider
        label="Luminance"
        value={cur.luminance}
        min={-100}
        max={100}
        format={(v) => (v > 0 ? `+${v}` : `${v}`)}
        track={`linear-gradient(to right, #111, ${c}, #fff)`}
        onChange={(v) => set('luminance', v)}
        onCommit={() => finish(ctx)}
      />
    </div>
  )
}

const HUE_ANGLE: Record<HueBand, number> = {
  red: 0,
  orange: 30,
  yellow: 55,
  green: 120,
  aqua: 180,
  blue: 225,
  purple: 270,
  magenta: 310,
}

const CHANNEL_COLOR: Record<CurveChannel, string> = {
  master: '#ffffff',
  red: '#ff5a5a',
  green: '#5ee07f',
  blue: '#5b8cff',
}

function CurvesTool({ ctx }: { ctx: BatchContext }) {
  const channel = useEditor((s) => s.curveChannel)
  const layer = targetLayer(ctx, 'curves')
  const params: CurvesParams | null = layer ? paramsOf(ctx, layer) : null
  const write = writerFor(ctx, 'curves')
  const hist = useHistogram((s) => s.data)
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const pts: CurvePoint[] = params?.[channel] ?? [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]
  const setPts = (next: CurvePoint[], transient: boolean) => {
    const base: CurvesParams = params ?? {
      master: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      red: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      green: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      blue: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    }
    write({ ...base, [channel]: next }, transient)
  }
  const f = curveEvaluator(pts)
  let d = ''
  for (let i = 0; i <= 64; i++) {
    const x = i / 64
    d += `${i ? 'L' : 'M'}${x * 256},${(1 - Math.min(1, Math.max(0, f(x)))) * 256} `
  }
  let histPath = ''
  if (hist) {
    const arr =
      channel === 'master'
        ? hist.l
        : hist[channel === 'red' ? 'r' : channel === 'green' ? 'g' : 'b']
    let max = 1
    for (let i = 1; i < arr.length - 1; i++) max = Math.max(max, arr[i] ?? 0)
    histPath = 'M0,256 '
    arr.forEach((v, i) => {
      histPath += `L${(i / (arr.length - 1)) * 256},${256 - Math.sqrt(Math.min(1, v / max)) * 200} `
    })
    histPath += 'L256,256 Z'
  }
  const toCurve = (e: React.PointerEvent) => {
    const r = (svg.current as SVGSVGElement).getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)),
    }
  }
  return (
    <div>
      <div className="flex items-center justify-between py-2">
        <div className="flex gap-1.5">
          {(['master', 'red', 'green', 'blue'] as const).map((c) => (
            <Chip key={c} active={channel === c} onClick={() => editor.set({ curveChannel: c })}>
              <span className="size-2.5 rounded-full" style={{ background: CHANNEL_COLOR[c] }} />
              {c === 'master' ? 'RGB' : c[0]?.toUpperCase() + c.slice(1)}
            </Chip>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={RotateCcw}
          aria-label="Reset curve"
          onClick={() =>
            setPts(
              [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ],
              false,
            )
          }
        />
      </div>
      <svg
        ref={svg}
        viewBox="0 0 256 256"
        className="aspect-square w-full touch-none rounded-2xl bg-ink-2"
        role="img"
        aria-label={`${channel} tone curve. Tap to add a point, drag to move, double-tap a point to remove it.`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const p = toCurve(e)
          let idx = pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.06)
          if (idx < 0) {
            const next = [...pts, p].sort((a, b) => a.x - b.x)
            idx = next.indexOf(p)
            setPts(next, true)
          }
          drag.current = idx
        }}
        onPointerMove={(e) => {
          const i = drag.current
          if (i === null) return
          const p = toCurve(e)
          const next = [...pts]
          const lo = i === 0 ? 0 : (pts[i - 1]?.x ?? 0) + 0.01
          const hi = i === pts.length - 1 ? 1 : (pts[i + 1]?.x ?? 1) - 0.01
          next[i] = {
            x:
              i === 0
                ? Math.min(p.x, hi)
                : i === pts.length - 1
                  ? Math.max(p.x, lo)
                  : Math.min(hi, Math.max(lo, p.x)),
            y: p.y,
          }
          setPts(next, true)
        }}
        onPointerUp={() => {
          drag.current = null
          finish(ctx)
        }}
        onDoubleClick={(e) => {
          const p = toCurve(e as unknown as React.PointerEvent)
          const idx = pts.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.06)
          if (idx > 0 && idx < pts.length - 1)
            setPts(
              pts.filter((_, i) => i !== idx),
              false,
            )
        }}
      >
        {[64, 128, 192].map((v) => (
          <g key={v} className="stroke-white/8">
            <line x1={v} y1={0} x2={v} y2={256} />
            <line x1={0} y1={v} x2={256} y2={v} />
          </g>
        ))}
        <line x1={0} y1={256} x2={256} y2={0} className="stroke-white/10" strokeDasharray="4 4" />
        {histPath && <path d={histPath} fill={CHANNEL_COLOR[channel]} opacity={0.12} />}
        <path d={d} fill="none" stroke={CHANNEL_COLOR[channel]} strokeWidth={2.5} />
        {pts.map((p) => (
          <circle
            key={`${p.x}:${p.y}`}
            cx={p.x * 256}
            cy={(1 - p.y) * 256}
            r={7}
            fill="#1c1c1e"
            stroke={CHANNEL_COLOR[channel]}
            strokeWidth={2.5}
          />
        ))}
      </svg>
      <p className="mt-2 text-[11px] text-mute-2">
        Tap to add a point. Drag to shape. Double-tap a point to remove it.
      </p>
    </div>
  )
}

function SplitTool({ ctx }: { ctx: BatchContext }) {
  const layer = targetLayer(ctx, 'split')
  const params: SplitParams = layer
    ? paramsOf(ctx, layer)
    : { shadowHue: 220, shadowSaturation: 0, highlightHue: 40, highlightSaturation: 0, balance: 0 }
  const write = writerFor(ctx, 'split')
  const set = (patch: Partial<SplitParams>) => write({ ...params, ...patch }, true)
  const swatch = (h: number, s: number) => (
    <span
      className="size-4 rounded-full ring-1 ring-white/20"
      style={{ background: rgbToHex(hueColor(h)), opacity: 0.25 + (s / 100) * 0.75 }}
    />
  )
  return (
    <div className="py-1">
      <h4 className="mt-2 flex items-center gap-2 text-sm font-semibold">
        {swatch(params.highlightHue, params.highlightSaturation)} Highlights
      </h4>
      <Slider
        label="Hue"
        value={params.highlightHue}
        min={0}
        max={360}
        format={(v) => `${Math.round(v)}°`}
        track={RAINBOW}
        onChange={(v) => set({ highlightHue: v })}
        onCommit={() => finish(ctx)}
      />
      <Slider
        label="Saturation"
        value={params.highlightSaturation}
        min={0}
        max={100}
        onChange={(v) => set({ highlightSaturation: v })}
        onCommit={() => finish(ctx)}
      />
      <h4 className="mt-3 flex items-center gap-2 text-sm font-semibold">
        {swatch(params.shadowHue, params.shadowSaturation)} Shadows
      </h4>
      <Slider
        label="Hue"
        value={params.shadowHue}
        min={0}
        max={360}
        format={(v) => `${Math.round(v)}°`}
        track={RAINBOW}
        onChange={(v) => set({ shadowHue: v })}
        onCommit={() => finish(ctx)}
      />
      <Slider
        label="Saturation"
        value={params.shadowSaturation}
        min={0}
        max={100}
        onChange={(v) => set({ shadowSaturation: v })}
        onCommit={() => finish(ctx)}
      />
      <div className="mt-2">
        <Slider
          label="Balance"
          value={params.balance}
          min={-100}
          max={100}
          format={(v) => (v > 0 ? `+${v}` : `${v}`)}
          onChange={(v) => set({ balance: v })}
          onCommit={() => finish(ctx)}
        />
      </div>
    </div>
  )
}

export default function ColorPanel({ ctx }: { ctx: BatchContext }) {
  const tool = useEditor((s) => s.colorTool)
  return (
    <div className="h-full overflow-y-auto px-4 pt-3 pb-6">
      <Segmented
        label="Color tool"
        value={tool}
        onChange={(t) => editor.set({ colorTool: t })}
        options={[
          { value: 'hsl', label: 'HSL' },
          { value: 'curves', label: 'Curves' },
          { value: 'split', label: 'Split toning' },
        ]}
      />
      {tool === 'hsl' && <HslTool ctx={ctx} />}
      {tool === 'curves' && <CurvesTool ctx={ctx} />}
      {tool === 'split' && <SplitTool ctx={ctx} />}
    </div>
  )
}
