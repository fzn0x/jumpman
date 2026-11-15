/**
 * On-device subject segmentation with MediaPipe MagicTouch (Apache-2.0).
 * Given a photo and one point on its subject, returns a soft mask of the
 * object under that point. The wasm runtime and the model are bundled with
 * the app and load on the first request; nothing leaves the device.
 */
import { confidenceToCoverage } from '@jumpman/core'
import { InteractiveSegmenterLegacy } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url'
import modelAssetPath from '../assets/models/magic_touch.tflite?url'

export interface SegmentRequest {
  id: number
  /** Upright photo, already downscaled; the worker closes it. */
  image: ImageBitmap
  /** Normalized point on the subject (0..1, y down). */
  point: { x: number; y: number }
}

export type SegmentResponse =
  | { id: number; ok: true; width: number; height: number; data: Uint8Array<ArrayBuffer> }
  | { id: number; ok: false; error: string }

let segmenter: Promise<InteractiveSegmenterLegacy> | null = null

function load(): Promise<InteractiveSegmenterLegacy> {
  segmenter ??= InteractiveSegmenterLegacy.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    {
      // The CPU delegate works in every worker; the GPU one needs WebGL in workers.
      baseOptions: { modelAssetPath, delegate: 'CPU' },
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    },
  )
  // A failed load is permanent for this worker; let the caller see it every time.
  return segmenter
}

async function segment({ image, point }: SegmentRequest) {
  try {
    const model = await load()
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
  } finally {
    image.close()
  }
}

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<SegmentRequest>) => void) | null
  postMessage(message: SegmentResponse, transfer?: Transferable[]): void
}

scope.onmessage = async (e) => {
  const { id } = e.data
  try {
    const out = await segment(e.data)
    scope.postMessage({ id, ok: true, ...out }, [out.data.buffer])
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
