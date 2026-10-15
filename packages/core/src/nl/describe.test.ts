import { describe, expect, it } from 'vitest'
import { BASIC_KEYS, basicSpec, defaultBasic } from '../model/basic.ts'
import { describeEditInWords, describeToEdit } from './describe.ts'
import { LEXICON, MODIFIERS } from './lexicon.ts'

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

const temp = (text: string) => describeToEdit(text).basic.temperature ?? 0

describe('intensity and negation', () => {
  it('handles the headline example', () => {
    const r = describeToEdit('warmer, softer highlights, slightly faded')
    expect(r.basic.temperature).toBeGreaterThan(0)
    expect(r.basic.highlights).toBeLessThan(0)
    expect(r.basic.fade).toBeGreaterThan(0)
    expect(r.basic.fade).toBeLessThanOrEqual(12)
    expect(r.matched.map((m) => m.phrase)).toEqual([
      'warmer',
      'softer highlights',
      'slightly faded',
    ])
    expect(r.unmatched).toEqual([])
  })

  it('orders softeners and intensifiers', () => {
    const levels = ['very slightly warm', 'slightly warm', 'somewhat warm', 'warm', 'very warm']
    const values = [...levels, 'extremely warm'].map(temp)
    for (let k = 1; k < values.length; k++) expect(values[k]).toBeGreaterThan(values[k - 1] ?? 0)
    expect(temp('slightly warm')).toBe(8)
    expect(temp('very warm')).toBe(32)
  })

  it('treats softener synonyms alike', () => {
    for (const text of ['a little warmer', 'a touch warmer', 'a hint of warmth', 'subtly warm']) {
      expect(temp(text), text).toBe(temp('slightly warm'))
    }
    expect(describeToEdit('a bit of grain').matched).toEqual([
      { phrase: 'a bit of grain', effect: 'Grain +10' },
    ])
  })

  it('scales comparatives', () => {
    const contrast = (text: string) => describeToEdit(text).basic.contrast ?? 0
    expect(contrast('more contrast')).toBe(20)
    expect(contrast('even more contrast')).toBe(30)
    expect(contrast('much more contrast')).toBe(32)
    expect(temp('even warmer')).toBe(30)
  })

  it('softens "not too X" but keeps its direction', () => {
    expect(temp('not too warm')).toBe(temp('slightly warm'))
    expect(describeToEdit('bright but not too contrasty').basic.contrast).toBe(8)
  })

  it('inverts "less X", "reduce X" and friends', () => {
    expect(describeToEdit('less contrast').basic.contrast).toBeLessThan(0)
    expect(describeToEdit('less saturated').basic.saturation).toBeLessThan(0)
    expect(describeToEdit('less color').basic.saturation).toBeLessThan(0)
    expect(describeToEdit('reduce the contrast').basic.contrast).toBe(-20)
    expect(describeToEdit('lower exposure').basic.exposure).toBe(-0.3)
    expect(describeToEdit('low saturation').basic.saturation).toBe(-20)
    expect(temp('a bit less warm')).toBe(-8)
    expect(temp('too warm')).toBeLessThan(0)
  })

  it('routes verbs through tonal nouns', () => {
    expect(describeToEdit('lift the shadows').basic.shadows).toBe(25)
    expect(describeToEdit('crush the shadows').basic.shadows).toBe(-25)
    expect(describeToEdit('tone down the highlights').basic.highlights).toBe(-20)
    expect(describeToEdit('more blacks').basic.blacks).toBe(-20)
  })

  it('lets a phrase double as a modifier only when a phrase follows', () => {
    expect(describeToEdit('light grain').basic).toEqual({ grain: 13 })
    expect(describeToEdit('light').basic.exposure).toBe(0.3)
    expect(describeToEdit('very light').basic.exposure).toBe(0.48)
    expect(describeToEdit('intense contrast').basic.contrast).toBe(36)
  })

  it('removes effects with "no X" regardless of order', () => {
    expect(describeToEdit('no vignette').basic).toEqual({})
    expect(describeToEdit('no vignette').matched).toEqual([
      { phrase: 'no vignette', effect: 'Vignette 0' },
    ])
    const moody = describeToEdit('moody').basic
    const withoutVignette = describeToEdit('moody, no vignette').basic
    expect(moody.vignette).toBeLessThan(0)
    expect(withoutVignette.vignette).toBeUndefined()
    expect(withoutVignette.contrast).toBe(moody.contrast)
    expect(describeToEdit('no vignette, moody').basic).toEqual(withoutVignette)
    expect(describeToEdit('film without grain').basic.grain).toBeUndefined()
    expect(describeToEdit('cinematic, remove the split toning').split).toBeUndefined()
    expect(describeToEdit('teal and orange, no teal and orange').split).toBeUndefined()
  })

  it('weakens toning on negation without flipping it', () => {
    const full = describeToEdit('teal and orange').split
    const weaker = describeToEdit('teal and orange, slightly less teal and orange').split
    expect(weaker?.shadowHue).toBe(full?.shadowHue)
    expect(weaker?.shadowSaturation).toBeLessThan(full?.shadowSaturation ?? 0)
    expect(describeToEdit('less teal and orange').split).toBeUndefined()
  })

  it('reports dangling modifiers as not understood', () => {
    expect(describeToEdit('very').unmatched).toEqual(['very'])
    expect(describeToEdit('warm, really zebra').unmatched).toEqual(['really zebra'])
  })

  it('caps stacked intensifiers and stays fast on long input', () => {
    expect(temp('very very very very extremely warm')).toBe(60)
    const long = Array.from({ length: 300 }, () => 'a little bit').join(' ')
    const r = describeToEdit(`${long} warmer`)
    expect(r.matched).toHaveLength(1)
    expect(r.unmatched).toEqual([])
  })
})

describe('lexicon coverage', () => {
  const phrases = LEXICON.flatMap((e) => e.phrases)

  it('parses every lexicon phrase on its own as exactly that phrase', () => {
    for (const phrase of phrases) {
      const r = describeToEdit(phrase)
      expect(
        r.matched.map((m) => m.phrase),
        phrase,
      ).toEqual([phrase])
      expect(r.unmatched, phrase).toEqual([])
    }
  })

  it('applies every modifier to the phrase that follows it', () => {
    for (const modifier of MODIFIERS.keys()) {
      const r = describeToEdit(`${modifier} warm`)
      expect(
        r.matched.map((m) => m.phrase),
        modifier,
      ).toEqual([`${modifier} warm`])
    }
  })

  it('keeps every output in range and at slider precision', () => {
    const isInt = (v: number) => Number.isInteger(v)
    for (const prefix of ['', 'extremely ', 'slightly ', 'very slightly ', 'less ', 'no ']) {
      for (const phrase of phrases) {
        const text = `${prefix}${phrase}, ${prefix}${phrase}, ${prefix}${phrase}`
        const { basic, hsl, split } = describeToEdit(text)
        for (const key of BASIC_KEYS) {
          const v = basic[key]
          if (v === undefined) continue
          const { min, max, precision } = basicSpec(key)
          expect(v, `${text}: ${key}`).not.toBe(0)
          expect(v, `${text}: ${key}`).toBeGreaterThanOrEqual(min)
          expect(v, `${text}: ${key}`).toBeLessThanOrEqual(max)
          expect(v, `${text}: ${key}`).toBe(Number(v.toFixed(precision)))
        }
        for (const shift of Object.values(hsl ?? {})) {
          for (const v of [shift.hue, shift.saturation, shift.luminance]) {
            expect(isInt(v) && Math.abs(v) <= 100, text).toBe(true)
          }
        }
        if (split) {
          expect(isInt(split.shadowHue) && split.shadowHue >= 0 && split.shadowHue < 360).toBe(true)
          expect(isInt(split.highlightHue) && split.highlightHue < 360).toBe(true)
          expect(split.shadowSaturation + split.highlightSaturation, text).toBeGreaterThan(0)
          expect(Math.max(split.shadowSaturation, split.highlightSaturation)).toBeLessThanOrEqual(
            100,
          )
          expect(Math.abs(split.balance)).toBeLessThanOrEqual(100)
        }
      }
    }
  })

  it('folds accents and curly apostrophes', () => {
    expect(describeToEdit('Vívid').basic).toEqual(describeToEdit('vivid').basic)
    expect(describeToEdit('don’t add grain, film').basic.grain).toBeUndefined()
  })
})

describe('describeEditInWords', () => {
  it('returns an empty string for default edits', () => {
    expect(describeEditInWords({})).toBe('')
    expect(describeEditInWords(defaultBasic())).toBe('')
    expect(describeEditInWords({ temperature: 3, fade: 2 })).toBe('')
  })

  it('describes sliders in a stable order with graded wording', () => {
    expect(describeEditInWords({ fade: 8, contrast: -20, exposure: 0.3, temperature: 20 })).toBe(
      'warm, bright, low contrast, slightly faded',
    )
    expect(describeEditInWords({ temperature: 8 })).toBe('slightly warm')
    expect(describeEditInWords({ temperature: 40 })).toBe('very warm')
    expect(describeEditInWords({ temperature: -20, vignette: -40 })).toBe('cool, strong vignette')
    expect(describeEditInWords({ saturation: -100, contrast: 20 })).toBe(
      'high contrast, black and white',
    )
  })

  it('round-trips with describeToEdit', () => {
    const words = describeEditInWords(describeToEdit('warm and bright').basic)
    expect(words).toContain('warm')
    expect(words).toContain('bright')
    for (const word of [
      'warm',
      'slightly warm',
      'very warm',
      'cool',
      'magenta tint',
      'green tint',
      'bright',
      'dark',
      'high contrast',
      'low contrast',
      'vivid',
      'muted',
      'black and white',
      'soft highlights',
      'lifted shadows',
      'deep shadows',
      'bright whites',
      'lifted blacks',
      'crushed blacks',
      'faded',
      'slightly faded',
      'grainy',
      'vignette',
    ]) {
      expect(describeEditInWords(describeToEdit(word).basic), word).toBe(word)
    }
  })
})
