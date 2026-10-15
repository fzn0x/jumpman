/**
 * Test harness: renders the same layer stacks with the CPU reference
 * pipeline (@jumpman/core) and the WebGL2 renderer, then reports the
 * per-channel difference. Loaded by e2e/parity.spec.ts.
 */
import {
  builtinLut,
  builtinLutId,
  createBaseLayer,
  createLayer,
  defaultHsl,
  defaultSplit,
  type Layer,
  renderImage,
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

const STACKS: Record<string, Layer[]> = {
  identity: [],
  basic: [
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
  hsl: [createLayer('hsl', { params: hsl })],
  split: [
    createLayer('split', {
      params: { ...defaultSplit(), shadowSaturation: 60, highlightSaturation: 50, balance: 20 },
    }),
  ],
  curves: [curves],
  lut: [createLayer('lut', { params: { lutId: builtinLutId('teal-orange') } })],
  masked: [
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
}

export interface ParityResult {
  name: string
  max: number
  mean: number
}

function run(): ParityResult[] {
  const img = synthetic()
  const canvas = document.createElement('canvas')
  const gl = new GLRenderer(canvas)
  gl.setImage(img, 'synthetic')
  const luts = (id: string) => builtinLut(id)
  return Object.entries(STACKS).map(([name, layers]) => {
    const cpu = renderImage(img, layers, luts)
    gl.render({ layers, luts, width: W, height: H })
    const gpu = gl.readPixels()
    let max = 0
    let sum = 0
    for (let i = 0; i < cpu.data.length; i++) {
      if (i % 4 === 3) continue
      const d = Math.abs((cpu.data[i] as number) - (gpu.data[i] as number))
      max = Math.max(max, d)
      sum += d
    }
    return { name, max, mean: sum / ((cpu.data.length / 4) * 3) }
  })
}

;(window as unknown as { parity: ParityResult[] }).parity = run()
