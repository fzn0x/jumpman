import { describe, expect, it } from 'vitest'
import { describeToEdit } from './describe.ts'

const phrasesOf = (text: string) => describeToEdit(text).matched.map((m) => m.phrase)

describe('describeToEdit', () => {
  it('returns an empty edit for empty or filler-only text', () => {
    expect(describeToEdit('')).toEqual({ basic: {}, matched: [], unmatched: [] })
    expect(describeToEdit('  make it look nice please ')).toEqual({
      basic: {},
      matched: [],
      unmatched: ['nice'],
    })
  })

  it('sums phrases and reports what each one did', () => {
    const r = describeToEdit('warmer, softer highlights')
    expect(r.basic).toEqual({ temperature: 20, highlights: -25 })
    expect(r.matched).toEqual([
      { phrase: 'warmer', effect: 'Temperature +20' },
      { phrase: 'softer highlights', effect: 'Highlights −25' },
    ])
    expect(r.unmatched).toEqual([])
  })

  it('splits on commas, and, &, with, but, semicolons, plus signs and periods', () => {
    expect(phrasesOf('warm and bright & punchy with grain but muted; moody + airy. hazy')).toEqual([
      'warm',
      'bright',
      'punchy',
      'grain',
      'muted',
      'moody',
      'airy',
      'hazy',
    ])
  })

  it('keeps known multi-word phrases intact', () => {
    expect(phrasesOf('black and white')).toEqual(['black and white'])
    expect(phrasesOf('teal & orange with golden hour')).toEqual(['teal and orange', 'golden hour'])
    expect(phrasesOf('light and airy, high-key')).toEqual(['light and airy', 'high key'])
  })

  it('is case-insensitive and tolerates spacing, hyphens and British spelling', () => {
    expect(describeToEdit('  WARMER ,   Softer   Highlights  ').basic).toEqual(
      describeToEdit('warmer, softer highlights').basic,
    )
    expect(describeToEdit('High-Key').basic).toEqual(describeToEdit('high key').basic)
    expect(describeToEdit('greyscale').basic).toEqual({ saturation: -100 })
    expect(describeToEdit('less colour').basic).toEqual(describeToEdit('less color').basic)
    expect(phrasesOf('cosy, sombre')).toEqual(['cosy', 'sombre'])
  })

  it('turns every spelling of black and white into full desaturation', () => {
    for (const text of ['black and white', 'Black & White', 'b&w', 'B / W', 'monochrome', 'mono']) {
      expect(describeToEdit(text).basic, text).toEqual({ saturation: -100 })
    }
  })

  it('maps teal and orange to split toning', () => {
    const { split } = describeToEdit('teal and orange')
    expect(split?.shadowHue).toBeGreaterThanOrEqual(180)
    expect(split?.shadowHue).toBeLessThanOrEqual(200)
    expect(split?.highlightHue).toBeGreaterThanOrEqual(25)
    expect(split?.highlightHue).toBeLessThanOrEqual(40)
    expect(split?.shadowSaturation).toBeGreaterThan(0)
    expect(split?.highlightSaturation).toBeGreaterThan(0)
  })

  it('blends toning from several phrases', () => {
    const { split } = describeToEdit('teal shadows, warm highlights')
    expect(split).toEqual({
      shadowHue: 185,
      shadowSaturation: 25,
      highlightHue: 38,
      highlightSaturation: 20,
      balance: 0,
    })
    const blended = describeToEdit('teal shadows, cool shadows').split
    expect(blended?.shadowHue).toBeGreaterThan(185)
    expect(blended?.shadowHue).toBeLessThan(215)
  })

  it('reports only the hsl bands a phrase touched', () => {
    const { hsl } = describeToEdit('lush greens')
    expect(hsl).toEqual({
      green: { hue: 0, saturation: 25, luminance: -5 },
      yellow: { hue: 0, saturation: 10, luminance: 0 },
    })
    expect(describeToEdit('warm').hsl).toBeUndefined()
    expect(describeToEdit('warm').split).toBeUndefined()
  })

  it('collects unknown words as runs', () => {
    const r = describeToEdit('warm with zebra stripes and bright, the unicorn')
    expect(r.unmatched).toEqual(['zebra stripes', 'unicorn'])
    expect(phrasesOf('warm with zebra stripes and bright')).toEqual(['warm', 'bright'])
    expect(describeToEdit('zebra the stripes').unmatched).toEqual(['zebra the stripes'])
  })

  it('clamps stacked phrases to slider ranges', () => {
    const r = describeToEdit('warm, warmer, golden hour, sunset, amber, toasty, warmth')
    expect(r.basic.temperature).toBe(100)
    expect(describeToEdit('black and white, mono, noir').basic.saturation).toBe(-100)
  })

  it('resets white balance for neutral phrases, whatever their position', () => {
    expect(describeToEdit('golden hour, neutral').basic.temperature).toBeUndefined()
    expect(describeToEdit('neutral, golden hour').basic.temperature).toBeUndefined()
    expect(describeToEdit('neutral').matched).toEqual([
      { phrase: 'neutral', effect: 'Temperature 0, Tint 0' },
    ])
  })

  it('is deterministic', () => {
    const text = 'moody, teal and orange, autumn, film grain'
    expect(describeToEdit(text)).toEqual(describeToEdit(text))
    expect(JSON.stringify(describeToEdit(text))).toBe(JSON.stringify(describeToEdit(text)))
  })
})
