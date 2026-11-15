import { rawImageToRgba } from '@jumpman/core'
import type { LibRawImageData, LibRawSettings } from 'libraw-wasm'
import { makeCanvas } from './image.ts'

/**
 * As-shot white balance, sRGB primaries and the sRGB transfer curve, 8 bits
 * per sample. LibRaw rotates the output by the file's orientation itself.
 */
const SETTINGS: LibRawSettings = {
  useCameraWb: true,
  outputColor: 1,
  outputBps: 8,
  // The wrapper only reads a 6-entry gamm (power, toe slope, then 4 values
  // LibRaw computes itself); the published typings list 2 entries.
  gamm: [1 / 2.4, 12.92, 0, 0, 0, 0] as unknown as [number, number],
}

/** A decode that takes longer than this falls back to the embedded preview. */
const DECODE_TIMEOUT_MS = 120_000

/**
 * Decodes the sensor data of a RAW file with LibRaw into an upright 8-bit
 * sRGB canvas. The wasm is fetched on first use. Every call runs in a fresh
 * LibRaw worker that is terminated as soon as the pixels arrive, so its
 * memory is released right away. `bytes` is transferred to LibRaw.
 */
export async function decodeRawFile(bytes: Uint8Array<ArrayBuffer>): Promise<OffscreenCanvas> {
  const { default: LibRaw } = await import('libraw-wasm')
  const raw = new LibRaw()
  let timer: ReturnType<typeof setTimeout> | undefined
  let img: LibRawImageData | undefined
  try {
    const failed = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('LibRaw timed out')), DECODE_TIMEOUT_MS)
      // The decoder worker is internal to libraw-wasm. Without this, a worker
      // script that fails to load would leave its promises pending forever.
      const worker = (raw as unknown as { worker?: Worker }).worker
      worker?.addEventListener('error', () => reject(new Error('LibRaw failed to start')))
    })
    await Promise.race([raw.open(bytes, SETTINGS), failed])
    img = await Promise.race([raw.imageData(), failed])
  } finally {
    clearTimeout(timer)
    raw.dispose()
  }
  // libraw-wasm 1.6.0 resolves failed calls with `undefined`: the C++
  // exception it forwards has no message, so it is not sent as an error.
  if (!img) throw new Error('LibRaw could not decode the image')
  const rgba = rawImageToRgba(img)
  const canvas = makeCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.putImageData(new ImageData(rgba, img.width, img.height), 0, 0)
  return canvas
}
