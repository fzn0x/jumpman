import {
  aspectRatioOf,
  type CropPlacement,
  cropRect,
  defaultPlacement,
  type GlobalEdit,
  type PhotoState,
  rotatedSize,
} from '@jumpman/core'
import type { Photo } from './types.ts'

export interface FrameSpec {
  /** Crop window normalized to the rotated image. */
  rect: { x: number; y: number; w: number; h: number }
  rotate: number
  flipH: boolean
  /** Size of the cropped frame in full-resolution pixels. */
  width: number
  height: number
}

export function placementOf(state: PhotoState | undefined): CropPlacement {
  return { ...defaultPlacement(), ...state?.override.crop }
}

/** The crop frame of a photo under the batch's shared aspect ratio and its own placement. */
export function frameOf(
  photo: Pick<Photo, 'width' | 'height'>,
  global: GlobalEdit,
  state: PhotoState | undefined,
): FrameSpec {
  const p = placementOf(state)
  const { w: W, h: H } = rotatedSize(photo.width, photo.height, p.rotate)
  const r = cropRect(photo.width, photo.height, aspectRatioOf(global.aspect), p)
  return {
    rect: { x: r.x / W, y: r.y / H, w: r.w / W, h: r.h / H },
    rotate: p.rotate,
    flipH: p.flipH,
    width: r.w,
    height: r.h,
  }
}

/** Fits a frame into a box, returning device-pixel render size. */
export function renderSize(
  frameW: number,
  frameH: number,
  boxW: number,
  boxH: number,
  dpr = 1,
  max = 4096,
) {
  const s = Math.min(boxW / frameW, boxH / frameH)
  const cssW = Math.max(1, frameW * s)
  const cssH = Math.max(1, frameH * s)
  const k = Math.min(dpr, max / Math.max(cssW, cssH))
  return { cssW, cssH, w: Math.round(cssW * k), h: Math.round(cssH * k) }
}
