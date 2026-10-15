import { describe, expect, it } from 'vitest'
import { createLut, identityLut, lutIndex, sampleLut } from '../color/lut.ts'
import { parseCube, serializeCube } from './cube.ts'

const tiny = [
  '# comment',
  'TITLE "Tiny # look"',
  '',
  'LUT_3D_SIZE 2',
  '0 0 0',
  '1 0 0 # inline comment',
  '0 1 0',
  '1 1 0',
  '0 0 1',
  '1 0 1',
  '0 1 1',
  '1 1 1',
].join('\r\n')

describe('parseCube', () => {
  it('parses a 3D LUT with title, comments and CRLF line endings', () => {
    const lut = parseCube(tiny)
    expect(lut.size).toBe(2)
    expect(lut.title).toBe('Tiny # look')
    expect(Array.from(lut.data.subarray(3, 6))).toEqual([1, 0, 0])
    expect(Array.from(lut.data.subarray(21, 24))).toEqual([1, 1, 1])
  })

  it('stores data red-fastest', () => {
    const lut = createLut(3, ([r, g, b]) => [r, g * 0.5, b * 0.25])
    const parsed = parseCube(serializeCube(lut))
    const i = lutIndex(3, 2, 1, 0)
    expect(parsed.data[i]).toBeCloseTo(1, 6)
    expect(parsed.data[i + 1]).toBeCloseTo(0.25, 6)
    expect(parsed.data[i + 2]).toBeCloseTo(0, 6)
  })

  it('rescales values by DOMAIN_MIN / DOMAIN_MAX', () => {
    const text = tiny
      .replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 4 1')
      .replace('1 1 1', '2 4 1')
    const lut = parseCube(text)
    expect(Array.from(lut.data.subarray(21, 24))).toEqual([1, 1, 1])
    expect(lut.data[3]).toBeCloseTo(0.5)
  })

  it('accepts Resolve LUT_3D_INPUT_RANGE and ignores unknown header keywords', () => {
    const text = tiny.replace(
      'LUT_3D_SIZE 2',
      'LUT_3D_SIZE 2\nLUT_3D_INPUT_RANGE 0 2\nLUT_IN_VIDEO_RANGE',
    )
    const lut = parseCube(text)
    expect(lut.data[3]).toBeCloseTo(0.5)
  })

  it('expands a 1D LUT into a 33³ 3D LUT', () => {
    const text = ['LUT_1D_SIZE 3', '0 0 1', '0.25 0.5 0.5', '1 1 0'].join('\n')
    const lut = parseCube(text)
    expect(lut.size).toBe(33)
    const out = sampleLut(lut, [0.5, 0.75, 0.5])
    expect(out[0]).toBeCloseTo(0.25, 4)
    expect(out[1]).toBeCloseTo(0.75, 4)
    expect(out[2]).toBeCloseTo(0.5, 4)
    const black = sampleLut(lut, [0, 0, 0])
    expect(black[2]).toBeCloseTo(1, 5)
  })

  it('accepts a BOM, tabs and scientific notation', () => {
    const text = `﻿LUT_3D_SIZE 2\n${Array(8).fill('5e-1\t0.5   .5').join('\n')}\n`
    const lut = parseCube(text)
    expect(Array.from(lut.data).every((v) => v === 0.5)).toBe(true)
  })

  it('rejects malformed files with clear errors', () => {
    expect(() => parseCube('0 0 0\n1 1 1')).toThrow(/Missing LUT_3D_SIZE/)
    expect(() => parseCube('TITLE "x"')).toThrow(/Missing LUT_3D_SIZE/)
    expect(() => parseCube('LUT_3D_SIZE 2')).toThrow(/no LUT data/)
    expect(() => parseCube('LUT_3D_SIZE 1\n0 0 0')).toThrow(/between 2 and 256/)
    expect(() => parseCube('LUT_3D_SIZE 300')).toThrow(/between 2 and 256/)
    expect(() => parseCube('LUT_3D_SIZE 2.5')).toThrow(/integer/)
    expect(() => parseCube(tiny.replace(/\r\n1 1 1$/, ''))).toThrow(/Expected 8 entries.*found 7/)
    expect(() => parseCube(`${tiny}\r\n0 0 0`)).toThrow(/found 9/)
    expect(() => parseCube(tiny.replace('0 1 0', '0 abc 0'))).toThrow(/non-numeric value "abc"/)
    expect(() => parseCube(tiny.replace('0 1 0', 'nan 1 0'))).toThrow(/non-numeric/)
    expect(() => parseCube(tiny.replace('0 1 0', '0 1'))).toThrow(/Line 7: LUT entry expects 3/)
    expect(() => parseCube(`${tiny}\r\nLUT_3D_SIZE 2`)).toThrow(/after LUT data/)
    expect(() => parseCube(`LUT_1D_SIZE 2\n${tiny}`)).toThrow(/not supported/)
    expect(() =>
      parseCube(tiny.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2\nDOMAIN_MAX 0 1 1')),
    ).toThrow(/DOMAIN_MAX/)
  })
})

describe('serializeCube', () => {
  it('writes a standard header with 6 decimals', () => {
    const text = serializeCube(identityLut(2), 'My "best" look')
    const lines = text.split('\n')
    expect(lines).toContain('TITLE "My  best  look"')
    expect(lines).toContain('LUT_3D_SIZE 2')
    expect(lines).toContain('DOMAIN_MIN 0.0 0.0 0.0')
    expect(lines).toContain('1.000000 0.000000 0.000000')
    expect(text.endsWith('1.000000 1.000000 1.000000\n')).toBe(true)
  })

  it('round-trips a LUT', () => {
    const lut = createLut(5, ([r, g, b]) => [1 - r, g * g, (r + b) / 2], 'Round trip')
    const back = parseCube(serializeCube(lut))
    expect(back.size).toBe(5)
    expect(back.title).toBe('Round trip')
    for (let i = 0; i < lut.data.length; i++) {
      expect(back.data[i]).toBeCloseTo(lut.data[i] ?? 0, 6)
    }
  })

  it('rejects inconsistent LUTs', () => {
    expect(() => serializeCube({ size: 2, data: new Float32Array(3) })).toThrow(/expected 24/)
    expect(() => serializeCube({ size: 1, data: new Float32Array(3) })).toThrow(/between 2/)
  })
})
