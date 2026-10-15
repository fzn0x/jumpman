import { describe, expect, it } from 'vitest'
import { base64Decode, base64Encode, utf8Decode, utf8Encode } from './encoding.ts'

describe('encoding', () => {
  it('round-trips UTF-8 including emoji and accents', () => {
    for (const s of ['', 'hello', 'Ünïcödé — 写真 📷']) expect(utf8Decode(utf8Encode(s))).toBe(s)
    expect([...utf8Encode('é')]).toEqual([0xc3, 0xa9])
  })

  it('matches standard base64 and supports the url-safe alphabet', () => {
    const bytes = utf8Encode('Jumpman?>')
    expect(base64Encode(bytes)).toBe('SnVtcG1hbj8+')
    expect(base64Encode(bytes, true)).toBe('SnVtcG1hbj8-')
    expect(base64Encode(utf8Encode('ab'))).toBe('YWI=')
    for (const len of [0, 1, 2, 3, 10]) {
      const data = Uint8Array.from({ length: len }, (_, i) => (i * 37) % 256)
      expect([...base64Decode(base64Encode(data, true))]).toEqual([...data])
    }
    expect(() => base64Decode('@@')).toThrow()
  })
})
