import { describe, expect, it } from 'vitest'
import { BRUSH_LIMITS, brushPointCount } from '../mask/brush.ts'
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

describe('sanitize brush masks', () => {
  it('clamps settings, quantizes points and drops bad values', () => {
    const m = sanitizeMask({
      type: 'brush',
      invert: true,
      evil: 1,
      strokes: [
        {
          mode: 'smudge',
          size: 9,
          feather: -1,
          flow: 0,
          points: [0.123456, 0.5, Number.NaN, 0.2, 'x', 0.3, 5, -5, 0.7],
          extra: 'drop me',
        },
        { mode: 'erase', size: 0.05, feather: 0.5, flow: 0.5, points: [] },
        { mode: 'erase', points: 'nope' },
        'junk',
      ],
    })
    expect(m).toEqual({
      type: 'brush',
      invert: true,
      strokes: [
        {
          mode: 'paint',
          size: BRUSH_LIMITS.maxSize,
          feather: 0,
          flow: BRUSH_LIMITS.minFlow,
          points: [0.1235, 0.5, 2, -1],
        },
      ],
    })
    expect(sanitizeMask({ type: 'brush' })).toEqual({ type: 'brush', strokes: [] })
  })

  it('caps strokes and total points', () => {
    const many = Array.from({ length: 400 }, () => ({ points: [0.5, 0.5] }))
    const capped = sanitizeMask({ type: 'brush', strokes: many })
    expect(capped?.type === 'brush' && capped.strokes).toHaveLength(BRUSH_LIMITS.maxStrokes)
    const long = Array.from({ length: BRUSH_LIMITS.maxPoints * 3 }, (_, i) => (i % 100) / 100)
    const big = sanitizeMask({ type: 'brush', strokes: [{ points: long }, { points: long }] })
    if (big?.type !== 'brush') throw new Error('expected a brush mask')
    expect(brushPointCount(big)).toBe(BRUSH_LIMITS.maxPoints)
    expect(big.strokes).toHaveLength(1)
  })
})
