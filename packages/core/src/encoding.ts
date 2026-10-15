/** Dependency-free UTF-8 and base64 helpers (no DOM / Node globals in core). */

export function utf8Encode(str: string): Uint8Array {
  const out: number[] = []
  for (const ch of str) {
    const cp = ch.codePointAt(0) as number
    if (cp < 0x80) out.push(cp)
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63))
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63),
        0x80 | (cp & 63),
      )
    }
  }
  return Uint8Array.from(out)
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++] as number
    let cp: number
    if (b < 0x80) cp = b
    else if (b < 0xe0) cp = ((b & 31) << 6) | ((bytes[i++] as number) & 63)
    else if (b < 0xf0)
      cp = ((b & 15) << 12) | (((bytes[i++] as number) & 63) << 6) | ((bytes[i++] as number) & 63)
    else
      cp =
        ((b & 7) << 18) |
        (((bytes[i++] as number) & 63) << 12) |
        (((bytes[i++] as number) & 63) << 6) |
        ((bytes[i++] as number) & 63)
    out += String.fromCodePoint(cp)
  }
  return out
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function base64Encode(bytes: Uint8Array, url = false): string {
  const abc = url ? URL_ALPHABET : ALPHABET
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += abc[(n >> 18) & 63]
    out += abc[(n >> 12) & 63]
    out += b === undefined ? (url ? '' : '=') : abc[(n >> 6) & 63]
    out += c === undefined ? (url ? '' : '=') : abc[n & 63]
  }
  return out
}

export function base64Decode(input: string): Uint8Array {
  const clean = input.replace(/[\s=]/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const lookup = new Map([...ALPHABET].map((c, i) => [c, i]))
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of clean) {
    const v = lookup.get(ch)
    if (v === undefined) throw new Error('Invalid base64 input')
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 255)
    }
  }
  return Uint8Array.from(out)
}
