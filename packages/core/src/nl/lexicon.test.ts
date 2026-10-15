import { describe, expect, it } from 'vitest'
import { BASIC_KEYS, basicSpec } from '../model/basic.ts'
import { HUE_BANDS } from '../model/layers.ts'
import { FILLERS, LEXICON, SOFT_SEPARATORS } from './lexicon.ts'

const phrases = LEXICON.flatMap((e) => e.phrases)

describe('lexicon', () => {
  it('is rich and has no duplicate phrases', () => {
    expect(phrases.length).toBeGreaterThanOrEqual(80)
    expect(new Set(phrases).size).toBe(phrases.length)
  })

  it('stores phrases normalized', () => {
    for (const p of phrases) expect(p).toMatch(/^[a-z0-9]+( [a-z0-9]+)*$/)
    expect(phrases.some((p) => p.includes('colour') || p.includes('grey'))).toBe(false)
  })

  it('never uses fillers or separators as standalone phrases', () => {
    for (const p of phrases) {
      expect(FILLERS.has(p)).toBe(false)
      expect(SOFT_SEPARATORS.has(p)).toBe(false)
    }
  })

  it('keeps every value inside its slider range', () => {
    for (const entry of LEXICON) {
      const hasEffect = entry.basic || entry.hsl || entry.split || entry.resets
      expect(hasEffect, entry.phrases[0]).toBeTruthy()
      for (const key of BASIC_KEYS) {
        const v = entry.basic?.[key]
        if (v === undefined) continue
        const { min, max } = basicSpec(key)
        expect(v, `${entry.phrases[0]} ${key}`).toBeGreaterThanOrEqual(min)
        expect(v, `${entry.phrases[0]} ${key}`).toBeLessThanOrEqual(max)
      }
      for (const band of HUE_BANDS) {
        for (const v of Object.values(entry.hsl?.[band] ?? {}))
          expect(Math.abs(v)).toBeLessThanOrEqual(100)
      }
      if (entry.split) {
        expect(entry.split.shadowHue).toBeGreaterThanOrEqual(0)
        expect(entry.split.highlightHue).toBeLessThan(360)
        expect(entry.split.shadowSaturation + entry.split.highlightSaturation).toBeGreaterThan(0)
      }
    }
  })
})
