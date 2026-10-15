import { describe, expect, it } from 'vitest'
import { sanitizeLayer, sanitizeLayers, sanitizeMask } from './sanitize.ts'

describe('sanitize untrusted edits', () => {
  it('clamps values and drops unknown keys', () => {
    const l = sanitizeLayer({
      kind: 'basic',
      id: 'base',
      params: { exposure: 99, contrast: '20', evil: 1 },
      opacity: 7,
    })
    expect(l?.kind).toBe('basic')
    if (l?.kind !== 'basic') return
    expect(l.params.exposure).toBe(5)
    expect(l.params.contrast).toBe(20)
    expect('evil' in l.params).toBe(false)
    expect(l.opacity).toBe(1)
  })

  it('rejects unknown kinds and empty luts, dedupes ids and caps counts', () => {
    expect(sanitizeLayer({ kind: 'script', params: {} })).toBeNull()
    expect(sanitizeLayer({ kind: 'lut', params: { lutId: '' } })).toBeNull()
    const many = Array.from({ length: 50 }, () => ({ kind: 'split', id: 'same' }))
    expect(sanitizeLayers(many)).toHaveLength(1)
    expect(sanitizeLayers('nope')).toEqual([])
  })

  it('validates curves and masks', () => {
    const c = sanitizeLayer({
      kind: 'curves',
      params: {
        master: [
          { x: -1, y: 2 },
          { x: 0.5, y: 0.5 },
        ],
        red: 'x',
      },
    })
    expect(c?.kind === 'curves' && c.params.master[0]).toEqual({ x: 0, y: 1 })
    expect(sanitizeMask({ type: 'radial', cx: 'a' })).toMatchObject({ type: 'radial', cx: 0.5 })
    expect(sanitizeMask({ type: 'eval' })).toBeUndefined()
  })
})
