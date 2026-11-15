/**
 * Builds a tiny uncompressed DNG with a Bayer (RGGB) mosaic and no embedded
 * preview, so the only way to open it is to decode the sensor data. The left
 * half of the sensor is red, the right half blue.
 */

type Entry = { tag: number; type: number; values: number[] | string }

const SHORT = 3
const LONG = 4
const RATIONAL = 5
const BYTE = 1
const ASCII = 2
const SRATIONAL = 10

const TYPE_SIZE: Record<number, number> = {
  [BYTE]: 1,
  [ASCII]: 1,
  [SHORT]: 2,
  [LONG]: 4,
  [RATIONAL]: 8,
  [SRATIONAL]: 8,
}
const sizeOf = (type: number) => TYPE_SIZE[type] ?? 1

/** XYZ (D65) to linear sRGB, so the "camera" space is linear sRGB. */
const XYZ_TO_SRGB = [3.2406, -1.5372, -0.4986, -0.9689, 1.8758, 0.0415, 0.0557, -0.204, 1.057]

export interface DngOptions {
  width?: number
  height?: number
  /** EXIF orientation 1..8. */
  orientation?: number
}

export function buildDng({ width = 96, height = 64, orientation = 1 }: DngOptions = {}): Buffer {
  const pixels = new Uint16Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const site = (y & 1) * 2 + (x & 1) // 0 = R, 1/2 = G, 3 = B
      const lit = x < width / 2 ? site === 0 : site === 3
      pixels[y * width + x] = lit ? 50_000 : 3_000
    }
  }

  const entries: Entry[] = [
    { tag: 254, type: LONG, values: [0] },
    { tag: 256, type: LONG, values: [width] },
    { tag: 257, type: LONG, values: [height] },
    { tag: 258, type: SHORT, values: [16] },
    { tag: 259, type: SHORT, values: [1] },
    { tag: 262, type: SHORT, values: [32803] },
    { tag: 271, type: ASCII, values: 'Jumpman' },
    { tag: 272, type: ASCII, values: 'Synthetic' },
    { tag: 273, type: LONG, values: [0] }, // patched below
    { tag: 274, type: SHORT, values: [orientation] },
    { tag: 277, type: SHORT, values: [1] },
    { tag: 278, type: LONG, values: [height] },
    { tag: 279, type: LONG, values: [pixels.byteLength] },
    { tag: 284, type: SHORT, values: [1] },
    { tag: 33421, type: SHORT, values: [2, 2] },
    { tag: 33422, type: BYTE, values: [0, 1, 1, 2] },
    { tag: 50706, type: BYTE, values: [1, 4, 0, 0] },
    { tag: 50707, type: BYTE, values: [1, 1, 0, 0] },
    { tag: 50708, type: ASCII, values: 'Jumpman Synthetic' },
    { tag: 50714, type: LONG, values: [0] },
    { tag: 50717, type: LONG, values: [65535] },
    { tag: 50721, type: SRATIONAL, values: XYZ_TO_SRGB },
    { tag: 50728, type: RATIONAL, values: [1, 1, 1] },
    { tag: 50778, type: SHORT, values: [21] },
  ]

  const valueBytes = (e: Entry) =>
    (typeof e.values === 'string' ? e.values.length + 1 : e.values.length) * sizeOf(e.type)
  const ifdSize = 2 + entries.length * 12 + 4
  let extra = 0
  for (const e of entries) {
    const n = valueBytes(e)
    if (n > 4) extra += n + (n & 1)
  }
  const dataOffset = 8 + ifdSize + extra
  const buf = Buffer.alloc(dataOffset + pixels.byteLength)
  buf.write('II', 0, 'ascii')
  buf.writeUInt16LE(42, 2)
  buf.writeUInt32LE(8, 4)

  let at = 8
  let heap = 8 + ifdSize
  buf.writeUInt16LE(entries.length, at)
  at += 2
  for (const e of entries) {
    const values = e.tag === 273 ? [dataOffset] : e.values
    const n = valueBytes(e)
    buf.writeUInt16LE(e.tag, at)
    buf.writeUInt16LE(e.type, at + 2)
    buf.writeUInt32LE(typeof values === 'string' ? values.length + 1 : values.length, at + 4)
    let w = at + 8
    if (n > 4) {
      buf.writeUInt32LE(heap, at + 8)
      w = heap
      heap += n + (n & 1)
    }
    if (typeof values === 'string') buf.write(`${values}\0`, w, 'ascii')
    else
      for (const v of values) {
        if (e.type === BYTE) buf.writeUInt8(v, w)
        else if (e.type === SHORT) buf.writeUInt16LE(v, w)
        else if (e.type === LONG) buf.writeUInt32LE(v, w)
        else if (e.type === RATIONAL) {
          buf.writeUInt32LE(Math.round(v * 10_000), w)
          buf.writeUInt32LE(10_000, w + 4)
        } else {
          buf.writeInt32LE(Math.round(v * 10_000), w)
          buf.writeInt32LE(10_000, w + 4)
        }
        w += sizeOf(e.type)
      }
    at += 12
  }
  buf.writeUInt32LE(0, at)
  Buffer.from(pixels.buffer).copy(buf, dataOffset)
  return buf
}
