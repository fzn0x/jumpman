import { createLut, type Lut3D } from '../color/lut.ts'

const MAX_3D_SIZE = 256
const MAX_1D_SIZE = 65536
/** Lattice size used when a 1D .cube is expanded into a 3D LUT. */
const SIZE_FROM_1D = 33

type Vec3 = [number, number, number]

function parseNumbers(tokens: string[], count: number, what: string, line: number): number[] {
  if (tokens.length !== count) {
    throw new Error(`Line ${line}: ${what} expects ${count} values, got ${tokens.length}`)
  }
  return tokens.map((t) => {
    const v = Number(t)
    if (!Number.isFinite(v)) throw new Error(`Line ${line}: non-numeric value "${t}" in ${what}`)
    return v
  })
}

function parseSize(tokens: string[], max: number, keyword: string, line: number): number {
  const [n] = parseNumbers(tokens, 1, keyword, line)
  if (n === undefined || !Number.isInteger(n) || n < 2 || n > max) {
    throw new Error(`Line ${line}: ${keyword} must be an integer between 2 and ${max}`)
  }
  return n
}

function sample1D(data: Float32Array, size: number, channel: number, t: number): number {
  const f = Math.min(Math.max(t, 0), 1) * (size - 1)
  const i0 = Math.min(Math.floor(f), size - 2)
  const d = f - i0
  const a = data[i0 * 3 + channel] ?? 0
  const b = data[(i0 + 1) * 3 + channel] ?? 0
  return a + (b - a) * d
}

/**
 * Parses an Adobe / DaVinci Resolve `.cube` file into a 3D LUT.
 *
 * The lattice is assumed to span `DOMAIN_MIN..DOMAIN_MAX`, so data values are
 * normalized per channel into 0..1 with that same mapping. 1D LUTs are
 * expanded into a 33³ lattice by applying each channel's curve.
 */
export function parseCube(text: string): Lut3D {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/)
  let title: string | undefined
  let size3 = 0
  let size1 = 0
  let domainMin: Vec3 = [0, 0, 0]
  let domainMax: Vec3 = [1, 1, 1]
  let data: Float32Array | null = null
  let expected = 0
  let count = 0

  for (let li = 0; li < lines.length; li++) {
    const lineNo = li + 1
    let line = (lines[li] ?? '').trim()
    if (!line || line.startsWith('#')) continue

    if (/^TITLE\b/.test(line)) {
      const m = /^TITLE\s+(?:"([^"]*)"|(.*))$/.exec(line)
      title = (m?.[1] ?? m?.[2] ?? '').trim() || undefined
      continue
    }
    const hash = line.indexOf('#')
    if (hash >= 0) line = line.slice(0, hash).trim()
    const tokens = line.split(/\s+/)
    const keyword = tokens[0] ?? ''

    if (/^[A-Z][A-Z0-9_]*$/.test(keyword)) {
      if (data) throw new Error(`Line ${lineNo}: unexpected "${keyword}" after LUT data`)
      const args = tokens.slice(1)
      switch (keyword) {
        case 'LUT_3D_SIZE':
          if (size3) throw new Error(`Line ${lineNo}: duplicate LUT_3D_SIZE`)
          size3 = parseSize(args, MAX_3D_SIZE, keyword, lineNo)
          break
        case 'LUT_1D_SIZE':
          if (size1) throw new Error(`Line ${lineNo}: duplicate LUT_1D_SIZE`)
          size1 = parseSize(args, MAX_1D_SIZE, keyword, lineNo)
          break
        case 'DOMAIN_MIN':
          domainMin = parseNumbers(args, 3, keyword, lineNo) as Vec3
          break
        case 'DOMAIN_MAX':
          domainMax = parseNumbers(args, 3, keyword, lineNo) as Vec3
          break
        case 'LUT_1D_INPUT_RANGE':
        case 'LUT_3D_INPUT_RANGE': {
          const [lo = 0, hi = 1] = parseNumbers(args, 2, keyword, lineNo)
          domainMin = [lo, lo, lo]
          domainMax = [hi, hi, hi]
          break
        }
        // Other header keywords (e.g. LUT_IN_VIDEO_RANGE) are ignored.
      }
      continue
    }

    if (!data) {
      if (size3 && size1) throw new Error('Combined 1D + 3D .cube files are not supported')
      if (!size3 && !size1) throw new Error('Missing LUT_3D_SIZE or LUT_1D_SIZE before LUT data')
      expected = size3 ? size3 ** 3 : size1
      data = new Float32Array(expected * 3)
    }
    const rgb = parseNumbers(tokens, 3, 'LUT entry', lineNo)
    if (count < expected) {
      const o = count * 3
      for (let c = 0; c < 3; c++) {
        const lo = domainMin[c] ?? 0
        data[o + c] = ((rgb[c] ?? 0) - lo) / ((domainMax[c] ?? 1) - lo)
      }
    }
    count++
  }

  for (let c = 0; c < 3; c++) {
    if (!((domainMax[c] ?? 1) > (domainMin[c] ?? 0))) {
      throw new Error('DOMAIN_MAX must be greater than DOMAIN_MIN on every channel')
    }
  }
  if (!data) {
    if (!size3 && !size1) throw new Error('Missing LUT_3D_SIZE or LUT_1D_SIZE')
    throw new Error('The .cube file contains no LUT data')
  }
  if (count !== expected) {
    const header = size3 ? `LUT_3D_SIZE ${size3}` : `LUT_1D_SIZE ${size1}`
    throw new Error(`Expected ${expected} entries for ${header}, found ${count}`)
  }

  if (size3) return title ? { size: size3, data, title } : { size: size3, data }
  const curve = data
  return createLut(
    SIZE_FROM_1D,
    ([r, g, b]) => [
      sample1D(curve, size1, 0, r),
      sample1D(curve, size1, 1, g),
      sample1D(curve, size1, 2, b),
    ],
    title,
  )
}

function fmt(v: number): string {
  return (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6)
}

/** Serializes a LUT as an Adobe `.cube` file (red changing fastest). */
export function serializeCube(lut: Lut3D, title?: string): string {
  const { size, data } = lut
  if (!Number.isInteger(size) || size < 2 || size > MAX_3D_SIZE) {
    throw new Error(`LUT size must be an integer between 2 and ${MAX_3D_SIZE}`)
  }
  if (data.length !== size ** 3 * 3) {
    throw new Error(`LUT data has ${data.length} values, expected ${size ** 3 * 3}`)
  }
  const name = (title ?? lut.title ?? '').replace(/["\r\n]/g, ' ').trim()
  const out: string[] = ['# Created by Jumpman']
  if (name) out.push(`TITLE "${name}"`)
  out.push(`LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0', '')
  for (let i = 0; i < data.length; i += 3) {
    out.push(`${fmt(data[i] ?? 0)} ${fmt(data[i + 1] ?? 0)} ${fmt(data[i + 2] ?? 0)}`)
  }
  return `${out.join('\n')}\n`
}
