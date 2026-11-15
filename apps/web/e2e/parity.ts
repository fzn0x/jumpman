/**
 * Test harness: renders the same layer stacks with the CPU reference
 * pipeline (@jumpman/core) and the WebGL2 renderer, then reports the
 * per-channel difference. Loaded by e2e/parity.spec.ts.
 */
import {
  type BrushStroke,
  builtinLut,
  builtinLutId,
  createBaseLayer,
  createLayer,
  defaultHsl,
  defaultSplit,
  type FrameGeometry,
  frameToSource,
  type Layer,
  renderImage,
  rotatedSize,
} from '@jumpman/core'
import { GLRenderer } from '@jumpman/renderer'

const W = 96
const H = 64

function synthetic(): ImageData {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const h = (x / W) * 6
      const l = 0.1 + (y / H) * 0.85
      const c = [Math.abs(h - 3) - 1, 2 - Math.abs(h - 2), 2 - Math.abs(h - 4)].map((v) =>
        Math.min(1, Math.max(0, v)),
      )
      data[i] = ((c[0] as number) * 0.7 + 0.3) * l * 255
      data[i + 1] = ((c[1] as number) * 0.7 + 0.3) * l * 255
      data[i + 2] = ((c[2] as number) * 0.7 + 0.3) * l * 255
      data[i + 3] = 255
    }
  }
  return new ImageData(data, W, H)
}

/**
 * The frame the GPU geometry pass produces, cut on the CPU by sampling the
 * nearest source pixel. Exact for quarter turns, flips and pixel-aligned crops.
 */
function cutFrame(img: ImageData, g: FrameGeometry): ImageData {
  const r = g.rect ?? { x: 0, y: 0, w: 1, h: 1 }
  const rot = rotatedSize(img.width, img.height, g.rotate ?? 0)
  const fw = Math.round(rot.w * r.w)
  const fh = Math.round(rot.h * r.h)
  const out = new Uint8ClampedArray(fw * fh * 4)
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const s = frameToSource((x + 0.5) / fw, (y + 0.5) / fh, g)
      const sx = Math.min(img.width - 1, Math.floor(s.x * img.width))
      const sy = Math.min(img.height - 1, Math.floor(s.y * img.height))
      const i = (sy * img.width + sx) * 4
      out.set(img.data.subarray(i, i + 4), (y * fw + x) * 4)
    }
  }
  return new ImageData(out, fw, fh)
}

const hsl = defaultHsl()
hsl.blue = { hue: -20, saturation: 40, luminance: -20 }
hsl.orange = { hue: 10, saturation: -30, luminance: 15 }
const curves = createLayer('curves')
curves.params.master = [
  { x: 0, y: 0.05 },
  { x: 0.3, y: 0.22 },
  { x: 0.7, y: 0.8 },
  { x: 1, y: 0.97 },
]
curves.params.red = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.56 },
  { x: 1, y: 1 },
]

const strokes: BrushStroke[] = [
  {
    mode: 'paint',
    size: 0.18,
    feather: 0.7,
    flow: 1,
    points: [0.1, 0.2, 0.3, 0.35, 0.5, 0.3, 0.7, 0.6],
  },
  { mode: 'paint', size: 0.06, feather: 0, flow: 0.6, points: [0.2, 0.8, 0.8, 0.85] },
  { mode: 'erase', size: 0.1, feather: 0.5, flow: 0.8, points: [0.45, 0.2, 0.5, 0.5] },
]
const brushed: Layer[] = [
  createLayer('basic', {
    params: { ...createBaseLayer().params, exposure: 1.2, saturation: 30 },
    mask: { type: 'brush', strokes },
  }),
  createLayer('split', {
    opacity: 0.7,
    params: { ...defaultSplit(), shadowSaturation: 70, highlightSaturation: 40 },
    mask: { type: 'brush', strokes: strokes.slice(1), invert: true },
  }),
  createLayer('basic', {
    params: { ...createBaseLayer().params, contrast: 40 },
    mask: { type: 'radial', cx: 0.6, cy: 0.4, rx: 0.3, ry: 0.25, feather: 0.5 },
  }),
]

interface Case {
  layers: Layer[]
  geometry?: FrameGeometry
}

const CASES: Record<string, Case> = {
  identity: { layers: [] },
  basic: {
    layers: [
      createBaseLayer({
        exposure: 0.6,
        contrast: 25,
        highlights: -40,
        shadows: 30,
        whites: 10,
        blacks: -15,
        temperature: 20,
        tint: -10,
        vibrance: 20,
        saturation: -10,
        fade: 15,
        vignette: -30,
        brightness: 12,
      }),
    ],
  },
  hsl: { layers: [createLayer('hsl', { params: hsl })] },
  split: {
    layers: [
      createLayer('split', {
        params: { ...defaultSplit(), shadowSaturation: 60, highlightSaturation: 50, balance: 20 },
      }),
    ],
  },
  curves: { layers: [curves] },
  lut: { layers: [createLayer('lut', { params: { lutId: builtinLutId('teal-orange') } })] },
  masked: {
    layers: [
      createLayer('basic', {
        opacity: 0.8,
        params: { ...createBaseLayer().params, exposure: 1 },
        mask: { type: 'radial', cx: 0.4, cy: 0.5, rx: 0.3, ry: 0.4, feather: 0.6 },
      }),
      createLayer('basic', {
        params: { ...createBaseLayer().params, saturation: -80 },
        mask: { type: 'luminance', min: 0.5, max: 1, feather: 0.2 },
      }),
    ],
  },
  brush: { layers: brushed },
  'brush rotated': { layers: brushed, geometry: { rotate: 1, flipH: true } },
  'brush cropped': {
    layers: brushed,
    geometry: { rotate: 3, rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
  },
}

export interface ParityResult {
  name: string
  max: number
  mean: number
  /** Mean change from the unedited frame, so a stack both sides ignore cannot pass. */
  effect: number
}

function run(): ParityResult[] {
  const img = synthetic()
  const canvas = document.createElement('canvas')
  const gl = new GLRenderer(canvas)
  gl.setImage(img, 'synthetic')
  const luts = (id: string) => builtinLut(id)
  const sourceSize = { width: W, height: H }
  return Object.entries(CASES).map(([name, { layers, geometry }]) => {
    const frame = geometry ? cutFrame(img, geometry) : img
    const cpu = renderImage(frame, layers, luts, {
      sourceSize,
      ...(geometry ? { geometry } : {}),
    })
    gl.render({
      layers,
      luts,
      width: frame.width,
      height: frame.height,
      sourceSize,
      ...geometry,
    })
    const gpu = gl.readPixels()
    let max = 0
    let sum = 0
    let effect = 0
    for (let i = 0; i < cpu.data.length; i++) {
      if (i % 4 === 3) continue
      const d = Math.abs((cpu.data[i] as number) - (gpu.data[i] as number))
      max = Math.max(max, d)
      sum += d
      effect += Math.abs((cpu.data[i] as number) - (frame.data[i] as number))
    }
    const n = (cpu.data.length / 4) * 3
    return { name, max, mean: sum / n, effect: effect / n }
  })
}

;(window as unknown as { parity: ParityResult[] }).parity = run()
