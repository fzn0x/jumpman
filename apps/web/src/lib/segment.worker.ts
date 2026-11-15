/**
 * On-device segmentation, off the main thread. Nothing leaves the device:
 * the runtimes and models are bundled with the app and load on first use.
 *
 * - Subject: MediaPipe MagicTouch (Apache-2.0) segments the object under one
 *   point, the photo's salient center.
 * - Sky: EfficientViT-Seg B1 trained on ADE20K (Apache-2.0) on ONNX Runtime
 *   Web. Its 1/8-resolution sky probability is upsampled and snapped to the
 *   photo's edges with a guided filter.
 */
import { confidenceToCoverage, guidedFilter, resizeBilinear } from '@jumpman/core'
import mpLoaderPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url'
import mpBinaryPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url'
import ortWasmPath from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import subjectModelPath from '../assets/models/magic_touch.tflite?url'
import skyModelPath from '../assets/models/sky_b1.onnx?url'

export type SegmentKind = 'subject' | 'sky'

export interface SegmentRequest {
  id: number
  kind: SegmentKind
  /** Upright photo, at most 512 px on the long edge; the worker closes it. */
  image: ImageBitmap
  /** Normalized point on the subject (0..1, y down); subject only. */
  point?: { x: number; y: number }
}

export type SegmentResponse =
  | { id: number; ok: true; width: number; height: number; data: Uint8Array<ArrayBuffer> }
  | { id: number; ok: false; error: string }

type Mask = { width: number; height: number; data: Uint8Array<ArrayBuffer> }

const absolute = (path: string) => new URL(path, self.location.href).href

/* Subject: MediaPipe MagicTouch. */

type Segmenter = import('@mediapipe/tasks-vision').InteractiveSegmenterLegacy
let segmenter: Promise<Segmenter> | null = null

function loadSubject(): Promise<Segmenter> {
  segmenter ??= import('@mediapipe/tasks-vision').then(({ InteractiveSegmenterLegacy }) =>
    InteractiveSegmenterLegacy.createFromOptions(
      { wasmLoaderPath: mpLoaderPath, wasmBinaryPath: mpBinaryPath },
      {
        // The CPU delegate works in every worker; the GPU one needs WebGL in workers.
        baseOptions: { modelAssetPath: subjectModelPath, delegate: 'CPU' },
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      },
    ),
  )
  return segmenter
}

async function subject(image: ImageBitmap, point: { x: number; y: number }): Promise<Mask> {
  const model = await loadSubject()
  const result = model.segment(image, { keypoint: { x: point.x, y: point.y } })
  const masks = result.confidenceMasks ?? []
  try {
    const mask = masks[0]
    if (!mask) throw new Error('The segmentation model returned no mask')
    return {
      width: mask.width,
      height: mask.height,
      data: confidenceToCoverage(mask.getAsFloat32Array()) as Uint8Array<ArrayBuffer>,
    }
  } finally {
    for (const m of masks) m.close()
  }
}

/* Sky: EfficientViT-Seg B1 on ONNX Runtime Web. */

type Ort = typeof import('onnxruntime-web/wasm')
let sky: Promise<{ ort: Ort; session: import('onnxruntime-web/wasm').InferenceSession }> | null =
  null

function loadSky() {
  sky ??= import('onnxruntime-web/wasm').then(async (ort) => {
    // No cross-origin isolation on static hosts, so no threads; we already run in a worker.
    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false
    ort.env.wasm.wasmPaths = { wasm: absolute(ortWasmPath) }
    const session = await ort.InferenceSession.create(absolute(skyModelPath), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    return { ort, session }
  })
  return sky
}

const MEAN = [0.485, 0.456, 0.406] as const
const STD = [0.229, 0.224, 0.225] as const
/** Edge refinement: window radius in pixels at 512 px, and how soft edges may stay. */
const GUIDE_RADIUS = 6
const GUIDE_EPS = 2e-3

async function skyMask(image: ImageBitmap): Promise<Mask> {
  const { ort, session } = await loadSky()
  // The network downsamples by 32, so both sides must be multiples of 32.
  const w = Math.max(32, Math.round(image.width / 32) * 32)
  const h = Math.max(32, Math.round(image.height / 32) * 32)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.drawImage(image, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const n = w * h
  const input = new Float32Array(3 * n)
  const guide = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r = (px[i * 4] as number) / 255
    const g = (px[i * 4 + 1] as number) / 255
    const b = (px[i * 4 + 2] as number) / 255
    input[i] = (r - MEAN[0]) / STD[0]
    input[n + i] = (g - MEAN[1]) / STD[1]
    input[2 * n + i] = (b - MEAN[2]) / STD[2]
    guide[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const feeds = { image: new ort.Tensor('float32', input, [1, 3, h, w]) }
  const out = (await session.run(feeds)).sky
  if (!out) throw new Error('The sky model returned no output')
  try {
    const [, , oh, ow] = out.dims as [number, number, number, number]
    const coarse = out.data as Float32Array
    const up = resizeBilinear(coarse, ow, oh, w, h)
    const refined = guidedFilter(guide, up, w, h, GUIDE_RADIUS, GUIDE_EPS)
    return { width: w, height: h, data: confidenceToCoverage(refined) as Uint8Array<ArrayBuffer> }
  } finally {
    out.dispose()
  }
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<SegmentRequest>) => void) | null
  postMessage(message: SegmentResponse, transfer?: Transferable[]): void
}

scope.onmessage = async (e) => {
  const { id, kind, image, point } = e.data
  try {
    const mask =
      kind === 'sky' ? await skyMask(image) : await subject(image, point ?? { x: 0.5, y: 0.5 })
    scope.postMessage({ id, ok: true, ...mask }, [mask.data.buffer])
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  } finally {
    image.close()
  }
}
