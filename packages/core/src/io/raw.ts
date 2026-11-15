/**
 * Camera RAW support. The app decodes sensor data with LibRaw (WebAssembly)
 * and falls back to the largest JPEG preview the camera embedded in the file.
 * This module holds the format-level pieces that need no decoder.
 */

export const RAW_EXTENSIONS = [
  'dng',
  'cr2',
  'cr3',
  'crw',
  'nef',
  'nrw',
  'arw',
  'srf',
  'sr2',
  'raf',
  'orf',
  'rw2',
  'pef',
  'srw',
  '3fr',
  'iiq',
  'erf',
  'kdc',
  'dcr',
  'mrw',
  'x3f',
] as const

const RAW_SET = new Set<string>(RAW_EXTENSIONS)

export function isRawFileName(name: string): boolean {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 && RAW_SET.has(base.slice(dot + 1).toLowerCase())
}

export interface EmbeddedJpeg {
  offset: number
  length: number
  width: number
  height: number
}

/**
 * Remembers the last entropy-coded scan so overlapping candidates do not
 * rescan the same bytes. The result of a scan only depends on where the next
 * real marker is, so any later start inside [from, to] ends at `to`, and any
 * start at or after `deadFrom` runs off the end of the buffer.
 */
interface ScanMemo {
  from: number
  to: number
  deadFrom: number
}

const MAX_SEGMENTS = 4096
const MAX_FILL_BYTES = 64

/** Returns the index of the 0xFF that starts the marker ending a scan, or -1. */
function scanEntropy(bytes: Uint8Array, start: number, memo: ScanMemo): number {
  if (start >= memo.deadFrom) return -1
  if (start >= memo.from && start <= memo.to) return memo.to
  let i = start
  for (;;) {
    const f = bytes.indexOf(0xff, i)
    if (f < 0 || f + 1 >= bytes.length) {
      memo.deadFrom = start
      return -1
    }
    const next = bytes[f + 1] ?? 0
    // Byte stuffing (FF 00) and restart markers (FF D0-D7) belong to the scan.
    if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) i = f + 2
    else if (next === 0xff) i = f + 1
    else {
      memo.from = start
      memo.to = f
      return f
    }
  }
}

function u16(bytes: Uint8Array, i: number): number {
  return ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)
}

function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/** Walks the marker segments of a JPEG starting at `start` (its SOI). */
function parseJpegAt(bytes: Uint8Array, start: number, memo: ScanMemo): EmbeddedJpeg | null {
  const n = bytes.length
  let pos = start + 2
  let width = 0
  let height = 0
  let scans = 0
  for (let segments = 0; segments < MAX_SEGMENTS; segments++) {
    if (bytes[pos] !== 0xff) return null
    let fill = 0
    while (bytes[pos + 1] === 0xff) {
      if (++fill > MAX_FILL_BYTES) return null
      pos++
    }
    const marker = bytes[pos + 1]
    if (marker === undefined) return null
    pos += 2
    if (marker === 0xd9) return scans ? { offset: start, length: pos - start, width, height } : null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0x00 || marker === 0xd8) return null
    const len = u16(bytes, pos)
    if (len < 2 || pos + len > n) return null
    if (isSof(marker)) {
      // Only baseline, extended and progressive JPEGs are decodable by browsers;
      // lossless ones (SOF3) hold raw sensor data in CR2 / DNG files.
      if (marker > 0xc2 || width || len < 8) return null
      height = u16(bytes, pos + 3)
      width = u16(bytes, pos + 5)
      if (!width || !height) return null
    }
    pos += len
    if (marker === 0xda) {
      if (!width) return null
      scans++
      pos = scanEntropy(bytes, pos, memo)
      if (pos < 0) return null
    }
  }
  return null
}

/**
 * Finds complete JPEG images embedded anywhere in a buffer. Each candidate SOI
 * is validated by walking its marker segments and entropy-coded data up to
 * EOI; scanning resumes after the end of every valid image, so thumbnails
 * nested inside a larger preview are not reported separately.
 */
export function findEmbeddedJpegs(bytes: Uint8Array): EmbeddedJpeg[] {
  const out: EmbeddedJpeg[] = []
  const memo: ScanMemo = { from: 1, to: 0, deadFrom: Number.POSITIVE_INFINITY }
  const last = bytes.length - 3
  let i = 0
  while (i <= last) {
    const p = bytes.indexOf(0xff, i)
    if (p < 0 || p > last) break
    if (bytes[p + 1] === 0xd8 && bytes[p + 2] === 0xff) {
      const jpeg = parseJpegAt(bytes, p, memo)
      if (jpeg) {
        out.push(jpeg)
        i = p + jpeg.length
        continue
      }
    }
    i = p + 1
  }
  return out
}

export interface RawPreview {
  /** A view into the input buffer (no copy). */
  jpeg: Uint8Array
  width: number
  height: number
  /**
   * EXIF orientation (1..8) of the raw file. Embedded previews are stored
   * unrotated, so decode them without applying their own EXIF orientation
   * (e.g. `imageOrientation: 'none'`) and apply this instead.
   */
  orientation: number
}

/** Picks the largest embedded preview (by pixel count, then byte size). */
export function extractRawPreview(bytes: Uint8Array): RawPreview | null {
  let best: EmbeddedJpeg | undefined
  for (const j of findEmbeddedJpegs(bytes)) {
    const px = j.width * j.height
    const bestPx = best ? best.width * best.height : -1
    if (!best || px > bestPx || (px === bestPx && j.length > best.length)) best = j
  }
  if (!best) return null
  return {
    jpeg: bytes.subarray(best.offset, best.offset + best.length),
    width: best.width,
    height: best.height,
    orientation: readTiffOrientation(bytes),
  }
}

function hasAscii(bytes: Uint8Array, at: number, text: string): boolean {
  if (at < 0 || at + text.length > bytes.length) return false
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false
  return true
}

/** Reads tag 0x0112 from IFD0 of a TIFF structure whose header starts at `base`. */
function tiffOrientationAt(bytes: Uint8Array, base: number): number | null {
  if (base < 0 || base + 8 > bytes.length) return null
  const order = bytes[base]
  if (order !== bytes[base + 1] || (order !== 0x49 && order !== 0x4d)) return null
  const little = order === 0x49
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = view.getUint16(base + 2, little)
  // 42 = TIFF, 0x55 = Panasonic RW2, 0x4f52 / 0x5352 = Olympus ORF.
  if (magic !== 42 && magic !== 0x55 && magic !== 0x4f52 && magic !== 0x5352) return null
  const ifd = base + view.getUint32(base + 4, little)
  if (ifd + 2 > bytes.length) return null
  const count = view.getUint16(ifd, little)
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > bytes.length) return null
    if (view.getUint16(e, little) !== 0x0112) continue
    const type = view.getUint16(e + 2, little)
    const value =
      type === 3 ? view.getUint16(e + 8, little) : type === 4 ? view.getUint32(e + 8, little) : 0
    return value >= 1 && value <= 8 ? value : null
  }
  return null
}

/** Orientation from the EXIF (APP1) segment of the JPEG starting at `start`. */
function jpegExifOrientation(bytes: Uint8Array, start: number): number | null {
  if (bytes[start] !== 0xff || bytes[start + 1] !== 0xd8) return null
  let pos = start + 2
  for (let s = 0; s < 64 && bytes[pos] === 0xff; s++) {
    const marker = bytes[pos + 1]
    if (marker === undefined || marker === 0xda || marker === 0xd9) return null
    const len = u16(bytes, pos + 2)
    if (len < 2) return null
    if (marker === 0xe1 && hasAscii(bytes, pos + 4, 'Exif\0\0')) {
      return tiffOrientationAt(bytes, pos + 10)
    }
    pos += 2 + len
  }
  return null
}

/**
 * EXIF orientation (1..8) of a raw file, defaulting to 1. Reads IFD0 of
 * TIFF-based raws (`II*\0`, `MM\0*`, Panasonic `IIU\0`, Olympus `IIRO`), the
 * EXIF of the preview JPEG referenced by a Fujifilm RAF header, and the CMT1
 * (IFD0) box of Canon CR3 files.
 */
export function readTiffOrientation(bytes: Uint8Array): number {
  if (hasAscii(bytes, 0, 'FUJIFILMCCD-RAW')) {
    if (bytes.length < 92) return 1
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return jpegExifOrientation(bytes, view.getUint32(84)) ?? 1
  }
  if (hasAscii(bytes, 4, 'ftypcrx ')) {
    const end = Math.min(bytes.length, 1 << 20)
    for (let i = bytes.indexOf(0x43, 8); i >= 0 && i < end; i = bytes.indexOf(0x43, i + 1)) {
      if (hasAscii(bytes, i, 'CMT1')) return tiffOrientationAt(bytes, i + 4) ?? 1
    }
    return 1
  }
  return tiffOrientationAt(bytes, 0) ?? 1
}

/** An image as LibRaw's `dcraw_make_mem_image` returns it: interleaved rows, top to bottom. */
export interface DecodedRawImage {
  width: number
  height: number
  /** Samples per pixel: 3 for RGB, 1 for monochrome sensors. */
  colors: number
  /** 8 or 16 bits per sample. */
  bits: number
  data: Uint8Array | Uint16Array
}

/**
 * Expands a decoded raw image to 8-bit RGBA, ready for `ImageData`. 16-bit
 * samples keep their high byte. Throws on layouts it cannot convert, so the
 * caller can fall back to the embedded preview.
 */
export function rawImageToRgba(img: DecodedRawImage): Uint8ClampedArray<ArrayBuffer> {
  const { width, height, colors, bits, data } = img
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Invalid decoded size ${width}x${height}`)
  }
  if (colors !== 1 && colors !== 3) throw new Error(`Unsupported channel count ${colors}`)
  const wide = bits === 16
  if (!wide && bits !== 8) throw new Error(`Unsupported bit depth ${bits}`)
  if (wide !== data instanceof Uint16Array) throw new Error('Sample type does not match bit depth')
  const n = width * height
  if (data.length < n * colors) throw new Error('Decoded image is truncated')
  const out = new Uint8ClampedArray(n * 4)
  const shift = wide ? 8 : 0
  if (colors === 3) {
    for (let p = 0, s = 0, o = 0; p < n; p++, s += 3, o += 4) {
      out[o] = (data[s] as number) >> shift
      out[o + 1] = (data[s + 1] as number) >> shift
      out[o + 2] = (data[s + 2] as number) >> shift
      out[o + 3] = 255
    }
  } else {
    for (let p = 0, o = 0; p < n; p++, o += 4) {
      const v = (data[p] as number) >> shift
      out[o] = v
      out[o + 1] = v
      out[o + 2] = v
      out[o + 3] = 255
    }
  }
  return out
}
