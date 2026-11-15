/**
 * Helpers that turn a coarse model output into a mask raster: bilinear
 * upsampling and an edge-aware guided filter (He, Sun and Tang, "Guided Image
 * Filtering", 2010) that snaps soft mask edges to edges in the photo.
 * Images are single-channel Float32Arrays, row-major, top row first.
 */

/** Bilinear resize with texel centers at +0.5 and clamped edges. */
export function resizeBilinear(
  src: ArrayLike<number>,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const out = new Float32Array(dw * dh)
  const kx = sw / dw
  const ky = sh / dh
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(Math.max((y + 0.5) * ky - 0.5, 0), sh - 1)
    const y0 = Math.floor(fy)
    const y1 = Math.min(y0 + 1, sh - 1)
    const ty = fy - y0
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(Math.max((x + 0.5) * kx - 0.5, 0), sw - 1)
      const x0 = Math.floor(fx)
      const x1 = Math.min(x0 + 1, sw - 1)
      const tx = fx - x0
      const a = src[y0 * sw + x0] as number
      const b = src[y0 * sw + x1] as number
      const c = src[y1 * sw + x0] as number
      const d = src[y1 * sw + x1] as number
      const top = a + (b - a) * tx
      out[y * dw + x] = top + (c + (d - c) * tx - top) * ty
    }
  }
  return out
}

/** Mean over a (2r+1)^2 window, clipped at the borders, via a summed-area table. */
export function boxMean(src: ArrayLike<number>, w: number, h: number, r: number): Float32Array {
  const stride = w + 1
  const sat = new Float64Array(stride * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += src[y * w + x] as number
      sat[(y + 1) * stride + x + 1] = (sat[y * stride + x + 1] as number) + row
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const sum =
        (sat[y1 * stride + x1] as number) -
        (sat[y0 * stride + x1] as number) -
        (sat[y1 * stride + x0] as number) +
        (sat[y0 * stride + x0] as number)
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/**
 * Guided filter: smooths `p` while following the edges of `guide` (both
 * w x h, roughly 0..1). Larger `radius` reaches further; larger `eps` keeps
 * more of the input's softness. The result is clamped to 0..1.
 */
export function guidedFilter(
  guide: ArrayLike<number>,
  p: ArrayLike<number>,
  w: number,
  h: number,
  radius: number,
  eps: number,
): Float32Array {
  const n = w * h
  const ip = new Float32Array(n)
  const ii = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const g = guide[i] as number
    ip[i] = g * (p[i] as number)
    ii[i] = g * g
  }
  const meanI = boxMean(guide, w, h, radius)
  const meanP = boxMean(p, w, h, radius)
  const meanIp = boxMean(ip, w, h, radius)
  const meanII = boxMean(ii, w, h, radius)
  const a = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const mi = meanI[i] as number
    const mp = meanP[i] as number
    const cov = (meanIp[i] as number) - mi * mp
    const variance = (meanII[i] as number) - mi * mi
    const ai = cov / (variance + eps)
    a[i] = ai
    b[i] = mp - ai * mi
  }
  const meanA = boxMean(a, w, h, radius)
  const meanB = boxMean(b, w, h, radius)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const q = (meanA[i] as number) * (guide[i] as number) + (meanB[i] as number)
    out[i] = q < 0 ? 0 : q > 1 ? 1 : q
  }
  return out
}
