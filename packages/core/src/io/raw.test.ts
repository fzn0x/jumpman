import { describe, expect, it } from 'vitest'
import {
  extractRawPreview,
  findEmbeddedJpegs,
  isRawFileName,
  RAW_EXTENSIONS,
  readTiffOrientation,
} from './raw.ts'

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const zeros = (n: number) => new Uint8Array(n)

const SCAN_HEADER = [
  0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
]
const ENTROPY = [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78, 0x9a, 0xff, 0x00, 0xd8]

/** A structurally valid (not decodable) JPEG: SOI, DQT, SOF, DHT, SOS, entropy data, EOI. */
function jpeg(
  width: number,
  height: number,
  opts: { sof?: number; app?: number[]; scans?: number[][]; entropy?: number[] } = {},
): Uint8Array {
  const scans = opts.scans ?? [[...SCAN_HEADER, ...(opts.entropy ?? ENTROPY)]]
  return Uint8Array.from([
    0xff,
    0xd8,
    ...(opts.app ?? []),
    ...[0xff, 0xdb, 0x00, 0x04, 0x00, 0x00],
    ...[0xff, opts.sof ?? 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff],
    ...[width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
    ...[0xff, 0xc4, 0x00, 0x04, 0x00, 0x00],
    ...scans.flat(),
    0xff,
    0xd9,
  ])
}

/** A TIFF header with a one-entry IFD0 holding the orientation tag. */
function tiffHeader(orientation: number, little = true, magic = 42): Uint8Array {
  const out = new Uint8Array(26)
  const v = new DataView(out.buffer)
  out[0] = little ? 0x49 : 0x4d
  out[1] = out[0]
  v.setUint16(2, magic, little)
  v.setUint32(4, 8, little)
  v.setUint16(8, 1, little)
  v.setUint16(10, 0x0112, little)
  v.setUint16(12, 3, little)
  v.setUint32(14, 1, little)
  v.setUint16(18, orientation, little)
  return out
}

function exifApp1(orientation: number): number[] {
  const payload = [...ascii('Exif\0\0'), ...tiffHeader(orientation)]
  const len = payload.length + 2
  return [0xff, 0xe1, len >> 8, len & 0xff, ...payload]
}

describe('isRawFileName', () => {
  it('recognizes raw extensions case-insensitively', () => {
    expect(RAW_EXTENSIONS).toContain('cr3')
    for (const name of [
      'IMG_0001.CR2',
      'a.nef',
      'C:\\shots\\x.Arw',
      '/tmp/b.3fr',
      'pano.tar.dng',
    ]) {
      expect(isRawFileName(name)).toBe(true)
    }
    for (const name of ['photo.jpg', 'raw', 'NEF', '.nef', 'folder.raf/readme', 'x.dng.jpg', '']) {
      expect(isRawFileName(name)).toBe(false)
    }
  })
})

describe('findEmbeddedJpegs', () => {
  it('parses a standalone JPEG with stuffing, restart markers and fill bytes', () => {
    const img = jpeg(640, 480, { entropy: [0x01, 0xff, 0x00, 0xff, 0xd7, 0x02, 0xff, 0xff] })
    expect(findEmbeddedJpegs(img)).toEqual([
      { offset: 0, length: img.length, width: 640, height: 480 },
    ])
  })

  it('finds JPEGs at arbitrary offsets and skips nested thumbnails', () => {
    const thumb = jpeg(160, 120)
    const preview = jpeg(1024, 768, {
      app: [0xff, 0xe1, ((thumb.length + 2) >> 8) & 0xff, (thumb.length + 2) & 0xff, ...thumb],
    })
    const buf = concat(zeros(37), preview, [0xff, 0xd8, 0xff], zeros(5), jpeg(80, 60), zeros(3))
    expect(findEmbeddedJpegs(buf)).toEqual([
      { offset: 37, length: preview.length, width: 1024, height: 768 },
      { offset: 37 + preview.length + 8, length: jpeg(80, 60).length, width: 80, height: 60 },
    ])
  })

  it('accepts progressive JPEGs with several scans', () => {
    const scan = [...SCAN_HEADER, 0x11, 0x22, 0xff, 0x00]
    const dht = [0xff, 0xc4, 0x00, 0x03, 0x00]
    const img = jpeg(300, 200, { sof: 0xc2, scans: [scan, dht, scan, scan] })
    expect(findEmbeddedJpegs(img)).toEqual([
      { offset: 0, length: img.length, width: 300, height: 200 },
    ])
  })

  it('rejects lossless, truncated and malformed candidates', () => {
    expect(findEmbeddedJpegs(jpeg(4000, 3000, { sof: 0xc3 }))).toEqual([])
    const ok = jpeg(10, 10)
    expect(findEmbeddedJpegs(ok.subarray(0, ok.length - 1))).toEqual([])
    expect(findEmbeddedJpegs(ok.subarray(0, 25))).toEqual([])
    expect(findEmbeddedJpegs(jpeg(0, 10))).toEqual([])
    // SOS before SOF
    const noSof = Uint8Array.from([0xff, 0xd8, ...SCAN_HEADER, 0x00, 0xff, 0xd9])
    expect(findEmbeddedJpegs(noSof)).toEqual([])
    // Segment length running past the buffer
    expect(findEmbeddedJpegs(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x7f, 0xff, 0x00]))).toEqual(
      [],
    )
    expect(findEmbeddedJpegs(new Uint8Array(0))).toEqual([])
    expect(findEmbeddedJpegs(Uint8Array.from([0xff, 0xd8, 0xff]))).toEqual([])
  })

  it('stays linear when many fake SOIs lead into one unterminated scan', () => {
    // Thousands of SOIs whose APP0 segments all jump to the same SOF + SOS,
    // followed by 8 MB of entropy data that never ends.
    const target = 60_000
    const head = new Uint8Array(target)
    for (let p = 0; p + 6 <= target - 6; p += 6) {
      const len = target - (p + 4)
      head.set([0xff, 0xd8, 0xff, 0xe0, len >> 8, len & 0xff], p)
    }
    const tail = jpeg(10, 10, { entropy: [] }).subarray(2, -2)
    const buf = concat(head, tail, zeros(8_000_000))
    expect(findEmbeddedJpegs(buf)).toEqual([])
  })

  it('scans a 50 MB buffer quickly', () => {
    const buf = new Uint8Array(50_000_000)
    const words = new Uint32Array(buf.buffer)
    let seed = 0x12345678
    for (let i = 0; i < words.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      words[i] = seed
    }
    const img = jpeg(6000, 4000)
    buf.set(img, buf.length - img.length - 100)
    const found = findEmbeddedJpegs(buf).filter((j) => j.width === 6000)
    expect(found).toEqual([
      { offset: buf.length - img.length - 100, length: img.length, width: 6000, height: 4000 },
    ])
  })
})

describe('extractRawPreview', () => {
  it('returns the largest preview of a TIFF-based raw with its orientation', () => {
    const small = jpeg(160, 120)
    const large = jpeg(1616, 1080)
    const raw = concat(tiffHeader(6), zeros(100), small, zeros(50), large, zeros(10))
    const preview = extractRawPreview(raw)
    expect(preview).not.toBeNull()
    expect(preview?.width).toBe(1616)
    expect(preview?.height).toBe(1080)
    expect(preview?.orientation).toBe(6)
    expect(preview?.jpeg).toEqual(large)
    expect(preview?.jpeg.buffer).toBe(raw.buffer)
  })

  it('prefers more pixels regardless of order, then more bytes', () => {
    const big = jpeg(2000, 1000)
    const raw = concat(tiffHeader(1), big, jpeg(1000, 1000))
    expect(extractRawPreview(raw)?.width).toBe(2000)
    const plain = jpeg(500, 500)
    const heavier = jpeg(500, 500, { entropy: [...ENTROPY, 1, 2, 3, 4] })
    const tie = concat(plain, heavier)
    expect(extractRawPreview(tie)?.jpeg.length).toBe(heavier.length)
  })

  it('returns null for garbage or truncated input without throwing', () => {
    expect(extractRawPreview(new Uint8Array(0))).toBeNull()
    expect(extractRawPreview(Uint8Array.from(ascii('II*\0 definitely not a raw')))).toBeNull()
    const img = jpeg(100, 100)
    expect(extractRawPreview(concat(tiffHeader(3), img.subarray(0, img.length - 5)))).toBeNull()
    const noise = new Uint8Array(4096)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) >>> 24
    expect(extractRawPreview(noise)).toBeNull()
  })
})

describe('readTiffOrientation', () => {
  it('reads little- and big-endian TIFF headers and raw variants', () => {
    expect(readTiffOrientation(tiffHeader(6))).toBe(6)
    expect(readTiffOrientation(tiffHeader(8, false))).toBe(8)
    expect(readTiffOrientation(tiffHeader(3, true, 0x55))).toBe(3)
    expect(readTiffOrientation(tiffHeader(5, true, 0x4f52))).toBe(5)
  })

  it('defaults to 1 for invalid data', () => {
    expect(readTiffOrientation(new Uint8Array(0))).toBe(1)
    expect(readTiffOrientation(tiffHeader(9))).toBe(1)
    expect(readTiffOrientation(tiffHeader(6).subarray(0, 20))).toBe(1)
    expect(readTiffOrientation(tiffHeader(6, true, 43))).toBe(1)
    const badOffset = tiffHeader(6)
    new DataView(badOffset.buffer).setUint32(4, 0xfffffff0, true)
    expect(readTiffOrientation(badOffset)).toBe(1)
    expect(readTiffOrientation(jpeg(10, 10))).toBe(1)
  })

  it('works on subarray views', () => {
    const buf = concat(zeros(7), tiffHeader(7))
    expect(readTiffOrientation(buf.subarray(7))).toBe(7)
  })

  it('reads the preview EXIF of Fujifilm RAF files', () => {
    const preview = jpeg(1920, 1280, { app: exifApp1(6) })
    const header = concat(ascii('FUJIFILMCCD-RAW 0201FF383501'), zeros(160 - 28))
    new DataView(header.buffer).setUint32(84, header.length)
    new DataView(header.buffer).setUint32(88, preview.length)
    const raf = concat(header, preview, zeros(64))
    expect(readTiffOrientation(raf)).toBe(6)
    expect(extractRawPreview(raf)).toMatchObject({ width: 1920, orientation: 6 })
    new DataView(header.buffer).setUint32(84, 0xffffff00)
    expect(readTiffOrientation(concat(header, preview))).toBe(1)
  })

  it('reads the CMT1 box of Canon CR3 files', () => {
    const ftyp = [0, 0, 0, 0x18, ...ascii('ftypcrx '), 0, 0, 0, 1, ...ascii('crx isom')]
    const cmt1 = concat([0, 0, 0, 34], ascii('CMT1'), tiffHeader(8))
    const cr3 = concat(ftyp, ascii('moov uuid CNCV Canon'), cmt1, jpeg(1620, 1080))
    expect(readTiffOrientation(cr3)).toBe(8)
    expect(extractRawPreview(cr3)).toMatchObject({ width: 1620, orientation: 8 })
    expect(readTiffOrientation(concat(ftyp, zeros(32)))).toBe(1)
  })
})
