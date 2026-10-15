import type { Basic, BasicKey } from '../model/basic.ts'
import type { HslShift, HueBand, SplitParams } from '../model/layers.ts'

/**
 * Phrase lexicon for "edit by description". Values are the change a plain word makes
 * (tasteful but noticeable); intensity words scale them. Sign conventions follow the
 * sliders: +temperature is warmer, +tint is magenta, negative vignette darkens the edges.
 *
 * Phrases are stored normalized: lowercase, a-z/0-9 words separated by single spaces,
 * US spelling ("color", "gray"). British spellings the normalizer does not rewrite
 * ("cosy", "sombre") are listed explicitly.
 */

/** Something "no X" can switch off: a basic slider, an HSL band or split toning. */
export type ResetTarget = BasicKey | HueBand | 'split'

export interface LexEntry {
  phrases: readonly string[]
  basic?: Partial<Basic>
  hsl?: Partial<Record<HueBand, Partial<HslShift>>>
  /** Toning implied by a look; saturations scale with intensity. */
  split?: SplitParams
  /** What "no X" switches off; defaults to the entry's dominant slider. */
  clears?: readonly ResetTarget[]
  /** Reset-only phrases ("neutral") that zero these targets instead of adding. */
  resets?: readonly ResetTarget[]
}

const tone = (
  shadowHue: number,
  shadowSaturation: number,
  highlightHue: number,
  highlightSaturation: number,
  balance = 0,
): SplitParams => ({ shadowHue, shadowSaturation, highlightHue, highlightSaturation, balance })

export const LEXICON: readonly LexEntry[] = [
  // White balance
  {
    phrases: ['warm', 'warmer', 'warmth', 'warming', 'warmed', 'warm up', 'amber', 'toasty'],
    basic: { temperature: 20 },
  },
  {
    phrases: ['cool', 'cooler', 'cooled', 'cool down', 'bluer', 'bluish', 'blueish', 'blue tint'],
    basic: { temperature: -20 },
  },
  {
    phrases: ['cold', 'colder', 'chilly', 'icy', 'icier', 'frosty', 'frozen'],
    basic: { whites: 5, temperature: -30, saturation: -10 },
  },
  {
    phrases: ['magenta', 'magenta tint', 'pink', 'pink tint', 'pinkish', 'pinker', 'rosy'],
    basic: { tint: 15 },
  },
  {
    phrases: ['green tint', 'greenish', 'green cast', 'greener tint', 'olive tint'],
    basic: { tint: -15 },
  },
  {
    phrases: ['neutral', 'neutral white balance', 'color cast', 'cast'],
    resets: ['temperature', 'tint'],
  },
  { phrases: ['tint', 'untinted'], resets: ['tint'] },

  // Light
  {
    phrases: [
      'bright',
      'brighter',
      'brighten',
      'brightened',
      'light',
      'lighter',
      'lighten',
      'lightened',
      'well lit',
    ],
    basic: { exposure: 0.3, shadows: 5 },
  },
  {
    phrases: ['dark', 'darker', 'darken', 'darkened', 'dim', 'dimmer', 'dimmed', 'shadowy'],
    basic: { exposure: -0.3, shadows: -5 },
  },
  { phrases: ['exposure'], basic: { exposure: 0.3 } },
  { phrases: ['brightness'], basic: { brightness: 15 } },

  // Contrast
  {
    phrases: ['contrast', 'more contrast', 'higher contrast', 'high contrast', 'contrasty'],
    basic: { contrast: 20 },
  },
  { phrases: ['less contrast', 'lower contrast', 'low contrast'], basic: { contrast: -20 } },
  {
    phrases: ['punchy', 'punchier', 'punch', 'pop', 'poppy', 'snappy', 'bold', 'bolder'],
    basic: { contrast: 20, blacks: -5, vibrance: 15 },
  },
  { phrases: ['flat', 'flatter', 'flat profile'], basic: { contrast: -25, whites: -5, blacks: 5 } },
  {
    phrases: ['soft', 'softer', 'soften', 'softened', 'gentle', 'gentler'],
    basic: { highlights: -10, shadows: 5, contrast: -12 },
  },
  {
    phrases: [
      'crisp',
      'crisper',
      'sharp',
      'sharper',
      'clear',
      'clearer',
      'clarity',
      'defined',
      'definition',
      'detail',
    ],
    basic: { contrast: 12, whites: 8, blacks: -8 },
  },
  { phrases: ['harsh', 'harsher'], basic: { contrast: 30, whites: 10, blacks: -10 } },

  // Tonal ranges. A bare noun means "raise that slider", so "lift the shadows" and
  // "crush the shadows" both work through intensity words.
  {
    phrases: ['highlights', 'brighter highlights', 'bright highlights', 'glowing highlights'],
    basic: { highlights: 20 },
  },
  {
    phrases: [
      'softer highlights',
      'soft highlights',
      'gentle highlights',
      'muted highlights',
      'darker highlights',
      'recover highlights',
      'recovered highlights',
      'highlight recovery',
      'tame highlights',
      'tamed highlights',
      'rolled off highlights',
    ],
    basic: { highlights: -25 },
  },
  {
    phrases: [
      'shadows',
      'shadow detail',
      'lifted shadows',
      'lift shadows',
      'raised shadows',
      'open shadows',
      'brighter shadows',
      'lighter shadows',
      'bright shadows',
    ],
    basic: { shadows: 25 },
  },
  {
    phrases: [
      'deeper shadows',
      'deep shadows',
      'darker shadows',
      'dark shadows',
      'crushed shadows',
      'rich shadows',
      'inky shadows',
    ],
    basic: { shadows: -20, blacks: -5 },
  },
  {
    phrases: [
      'blacks',
      'lifted blacks',
      'lift blacks',
      'raised blacks',
      'milky blacks',
      'faded blacks',
      'matte blacks',
      'gray blacks',
    ],
    basic: { blacks: 20 },
  },
  {
    phrases: [
      'crushed blacks',
      'crush blacks',
      'deep blacks',
      'deeper blacks',
      'rich blacks',
      'inky blacks',
      'true blacks',
      'darker blacks',
      'more blacks',
    ],
    basic: { blacks: -20 },
  },
  {
    phrases: ['whites', 'brighter whites', 'bright whites', 'clean whites', 'crisp whites'],
    basic: { whites: 20 },
  },
  {
    phrases: ['softer whites', 'muted whites', 'dimmer whites', 'darker whites', 'creamy whites'],
    basic: { whites: -20 },
  },

  // Fade, haze and film
  {
    phrases: ['faded', 'fade', 'washed out', 'washed', 'bleached'],
    basic: { contrast: -5, saturation: -5, fade: 20 },
  },
  { phrases: ['matte', 'matt'], basic: { contrast: -5, blacks: 10, fade: 15 } },
  {
    phrases: ['hazy', 'haze', 'foggy', 'fog', 'misty', 'mist'],
    basic: { exposure: 0.1, highlights: 5, contrast: -15, saturation: -10, fade: 15 },
  },
  {
    phrases: ['film', 'filmic', 'analog', 'analogue', 'film stock', '35mm', 'nineties', '90s'],
    basic: { highlights: -10, contrast: -5, temperature: 5, saturation: -5, fade: 10, grain: 20 },
  },
  {
    phrases: ['vintage', 'old', 'old school', 'aged', 'nostalgic', 'antique'],
    basic: {
      contrast: -8,
      temperature: 12,
      saturation: -15,
      fade: 18,
      vignette: -15,
      grain: 10,
    },
    split: tone(200, 10, 45, 15, 10),
  },
  {
    phrases: ['retro', '70s', 'seventies'],
    basic: { contrast: -5, temperature: 15, tint: 5, saturation: -10, fade: 15 },
    split: tone(180, 10, 35, 20),
  },
  {
    phrases: ['polaroid', 'instant film'],
    basic: { highlights: -5, contrast: -5, temperature: 8, tint: 4, fade: 15, vignette: -10 },
    split: tone(190, 12, 50, 15),
  },
  {
    phrases: ['sepia', 'sepia toned'],
    basic: { contrast: -5, saturation: -100, fade: 5 },
    split: tone(30, 25, 40, 30),
    clears: ['saturation', 'split'],
  },
  {
    phrases: ['bleach bypass', 'silver retention'],
    basic: { highlights: -5, contrast: 30, whites: 10, blacks: -10, saturation: -45 },
  },
  {
    phrases: ['cross processed', 'cross process', 'cross processing', 'xpro'],
    basic: { contrast: 20, tint: -8, saturation: 10 },
    split: tone(230, 25, 60, 30),
  },
  {
    phrases: ['lomo', 'lomography', 'toy camera'],
    basic: { contrast: 25, temperature: 5, saturation: 20, vignette: -40 },
  },

  // Grain and vignette
  { phrases: ['grain', 'grainy', 'grainier', 'noise', 'noisy'], basic: { grain: 25 } },
  { phrases: ['film grain', 'analog grain'], basic: { grain: 30 } },
  { phrases: ['fine grain'], basic: { grain: 15 } },
  { phrases: ['coarse grain', 'gritty grain'], basic: { grain: 45 } },
  {
    phrases: [
      'vignette',
      'vignetted',
      'vignetting',
      'dark edges',
      'darker edges',
      'dark corners',
      'darker corners',
      'edge burn',
    ],
    basic: { vignette: -25 },
  },
  {
    phrases: ['white vignette', 'bright edges', 'brighter edges', 'light edges', 'bright corners'],
    basic: { vignette: 20 },
  },

  // Color intensity
  {
    phrases: ['vibrant', 'vibrance', 'vivid', 'colorful', 'lively', 'juicy', 'rich', 'richer'],
    basic: { vibrance: 25, saturation: 5 },
  },
  {
    phrases: ['saturated', 'saturation', 'more color', 'more colors', 'add color'],
    basic: { saturation: 20 },
  },
  {
    phrases: ['muted', 'subdued', 'understated', 'less color', 'less colors'],
    basic: { vibrance: -5, saturation: -20 },
  },
  {
    phrases: [
      'desaturated',
      'desaturate',
      'desat',
      'unsaturated',
      'undersaturated',
      'dull',
      'duller',
    ],
    basic: { saturation: -30 },
  },
  {
    phrases: ['pastel', 'pastels', 'soft colors'],
    basic: { exposure: 0.15, shadows: 10, contrast: -15, saturation: -15, fade: 12 },
  },
  {
    phrases: [
      'black and white',
      'bw',
      'bnw',
      'monochrome',
      'monochromatic',
      'mono',
      'grayscale',
      'gray scale',
      'no color',
      'no colors',
      'colorless',
    ],
    basic: { saturation: -100 },
  },
  {
    phrases: ['noir', 'film noir'],
    basic: {
      shadows: -15,
      contrast: 35,
      blacks: -20,
      saturation: -100,
      vignette: -25,
      grain: 15,
    },
  },

  // Individual hues
  {
    phrases: ['lush', 'lush greens', 'greener', 'greener foliage', 'vibrant greens', 'greens'],
    hsl: { green: { saturation: 25, luminance: -5 }, yellow: { saturation: 10 } },
  },
  {
    phrases: ['muted greens', 'desaturated greens', 'less green'],
    hsl: { green: { saturation: -25 }, yellow: { saturation: -10 } },
  },
  {
    phrases: ['blue sky', 'bluer sky', 'bluer skies', 'deep blue sky', 'deeper blues', 'blues'],
    hsl: { blue: { saturation: 20, luminance: -10 } },
  },
  {
    phrases: ['softer skin', 'soft skin', 'smooth skin', 'flattering skin', 'better skin'],
    hsl: { red: { saturation: -5 }, orange: { saturation: -10, luminance: 10 } },
  },
  {
    phrases: ['tan', 'tanned', 'sun kissed', 'bronzed'],
    basic: { temperature: 8 },
    hsl: { orange: { saturation: 12, luminance: -8 } },
  },

  // Toning
  {
    phrases: ['teal and orange', 'orange and teal', 'teal orange', 'orange teal', 'blockbuster'],
    basic: { contrast: 10, vibrance: 10 },
    hsl: { orange: { saturation: 10 }, blue: { hue: -15 } },
    split: tone(190, 35, 32, 30),
    clears: ['split'],
  },
  { phrases: ['teal', 'teal shadows', 'cyan shadows'], split: tone(185, 25, 40, 0) },
  { phrases: ['cool shadows', 'blue shadows', 'cold shadows'], split: tone(215, 20, 40, 0) },
  { phrases: ['warm shadows'], split: tone(30, 15, 40, 0) },
  {
    phrases: ['warm highlights', 'golden highlights', 'orange highlights', 'amber highlights'],
    split: tone(220, 0, 38, 20),
  },
  { phrases: ['cool highlights', 'blue highlights'], split: tone(220, 0, 210, 15) },
  {
    phrases: ['split toning', 'split tone', 'split toned', 'toning'],
    split: tone(210, 15, 40, 15),
  },

  // Looks
  {
    phrases: ['moody', 'brooding', 'somber', 'sombre', 'gloomy'],
    basic: {
      exposure: -0.3,
      highlights: -20,
      contrast: 15,
      saturation: -15,
      fade: 10,
      vignette: -10,
    },
    split: tone(210, 15, 40, 0),
  },
  {
    phrases: ['airy', 'light and airy', 'bright and airy', 'ethereal', 'breezy'],
    basic: {
      exposure: 0.4,
      highlights: -10,
      shadows: 25,
      contrast: -15,
      whites: 10,
      saturation: -10,
      fade: 5,
    },
  },
  {
    phrases: ['dreamy', 'soft and dreamy', 'dreamlike', 'whimsical'],
    basic: {
      exposure: 0.2,
      highlights: -5,
      shadows: 15,
      contrast: -20,
      tint: 5,
      saturation: -10,
      fade: 15,
    },
    split: tone(260, 8, 330, 12),
  },
  {
    phrases: ['romantic'],
    basic: { contrast: -10, temperature: 10, tint: 8, fade: 10, vignette: -10 },
  },
  {
    phrases: ['glow', 'glowy', 'glowing', 'bloom', 'luminous', 'radiant'],
    basic: { exposure: 0.15, highlights: 10, shadows: 10, contrast: -10, fade: 5 },
  },
  {
    phrases: ['cozy', 'cosy', 'hygge'],
    basic: {
      exposure: -0.1,
      highlights: -10,
      contrast: -5,
      temperature: 20,
      tint: 3,
      saturation: -5,
      vignette: -10,
    },
  },
  {
    phrases: ['cinematic', 'cinema', 'movie'],
    basic: {
      exposure: -0.1,
      highlights: -20,
      contrast: 15,
      blacks: -10,
      saturation: -10,
      vignette: -15,
    },
    split: tone(190, 20, 35, 15),
  },
  {
    phrases: ['dramatic', 'drama', 'epic', 'intense', 'striking'],
    basic: {
      highlights: -25,
      shadows: -15,
      contrast: 30,
      whites: 10,
      blacks: -10,
      vibrance: 10,
      vignette: -25,
    },
  },
  {
    phrases: ['natural', 'realistic', 'true to life', 'lifelike', 'true color', 'true colors'],
    basic: { highlights: -5, shadows: 5, contrast: 5, vibrance: 8 },
  },
  {
    phrases: ['clean', 'cleaner', 'fresh', 'fresher'],
    basic: { exposure: 0.15, contrast: 8, whites: 10, blacks: -5, temperature: -3, vibrance: 10 },
  },
  {
    phrases: ['editorial', 'magazine', 'fashion', 'commercial', 'polished'],
    basic: { highlights: -10, contrast: 12, whites: 10, blacks: -8, vibrance: 5, saturation: -10 },
  },
  {
    phrases: ['golden hour', 'golden', 'golden light', 'golden glow', 'magic hour'],
    basic: { exposure: 0.1, highlights: -10, shadows: 10, temperature: 30, tint: 5, vibrance: 15 },
    split: tone(25, 10, 40, 25, 20),
  },
  {
    phrases: ['sunset', 'sundown', 'dusk', 'sunrise', 'dawn'],
    basic: { highlights: -15, contrast: 10, temperature: 35, tint: 10, vibrance: 15 },
    split: tone(290, 10, 25, 30, 10),
  },
  {
    phrases: ['summer', 'summery', 'sunny', 'sunshine', 'beachy'],
    basic: {
      exposure: 0.2,
      highlights: -10,
      shadows: 10,
      contrast: 5,
      temperature: 15,
      vibrance: 20,
    },
    split: tone(220, 0, 45, 10),
  },
  {
    phrases: ['autumn', 'autumnal', 'fall'],
    basic: { contrast: 10, temperature: 20, tint: 5, vibrance: 10, saturation: 5 },
    hsl: {
      red: { saturation: 10 },
      orange: { saturation: 20 },
      yellow: { hue: -10, saturation: 10 },
      green: { hue: -30, saturation: -20 },
    },
    split: tone(220, 0, 35, 15),
  },
  {
    phrases: ['winter', 'wintry', 'wintery', 'wintertime', 'snowy'],
    basic: {
      exposure: 0.15,
      highlights: -5,
      contrast: 5,
      whites: 15,
      temperature: -25,
      saturation: -20,
    },
    hsl: { blue: { saturation: 10 } },
    split: tone(210, 15, 40, 0),
  },
  {
    phrases: ['spring', 'springtime', 'springy'],
    basic: { exposure: 0.2, shadows: 10, contrast: -5, temperature: 5, tint: 5, vibrance: 15 },
    hsl: { green: { hue: -10, saturation: 15, luminance: 10 }, magenta: { saturation: 10 } },
  },
  {
    phrases: ['spring pink', 'pink spring', 'cherry blossom', 'sakura', 'blush', 'blush pink'],
    basic: { exposure: 0.25, shadows: 15, contrast: -10, tint: 15, saturation: -5, fade: 10 },
    hsl: { red: { hue: 10 }, magenta: { saturation: 15, luminance: 10 } },
    split: tone(300, 8, 330, 15),
  },
  {
    phrases: ['nordic', 'scandinavian', 'scandi', 'minimal', 'minimalist'],
    basic: {
      exposure: 0.2,
      highlights: -5,
      contrast: -5,
      whites: 10,
      temperature: -12,
      saturation: -20,
      fade: 8,
    },
    split: tone(210, 10, 40, 0),
  },
  {
    phrases: ['tropical', 'tropics', 'caribbean', 'paradise'],
    basic: { exposure: 0.1, contrast: 10, temperature: 10, vibrance: 30, saturation: 10 },
    hsl: {
      yellow: { saturation: 10 },
      green: { saturation: 15 },
      aqua: { hue: -5, saturation: 20 },
      blue: { saturation: 15 },
    },
  },
  {
    phrases: ['high key', 'highkey'],
    basic: { exposure: 0.5, shadows: 20, contrast: -10, whites: 10, blacks: 10, saturation: -5 },
  },
  {
    phrases: ['low key', 'lowkey'],
    basic: {
      exposure: -0.5,
      highlights: -10,
      shadows: -20,
      contrast: 20,
      blacks: -15,
      vignette: -15,
    },
  },
  {
    phrases: ['hdr', 'high dynamic range', 'tone mapped'],
    basic: { highlights: -40, shadows: 40, contrast: 5, whites: 10, blacks: -10, vibrance: 20 },
  },
  {
    phrases: ['gritty', 'grungy', 'grunge', 'urban', 'street'],
    basic: {
      contrast: 25,
      blacks: -10,
      temperature: -5,
      saturation: -25,
      vignette: -15,
      grain: 15,
    },
  },
  {
    phrases: ['stormy', 'storm'],
    basic: {
      exposure: -0.2,
      highlights: -20,
      contrast: 20,
      temperature: -15,
      saturation: -20,
      vignette: -15,
    },
  },
  {
    phrases: ['neon', 'cyberpunk', 'synthwave', 'vaporwave', '80s', 'eighties'],
    basic: { contrast: 20, temperature: -20, tint: 20, vibrance: 25 },
    split: tone(260, 30, 320, 25),
  },
  {
    phrases: ['earthy', 'earth tones', 'rustic'],
    basic: { contrast: 5, temperature: 10, saturation: -15, fade: 5 },
    hsl: {
      orange: { saturation: 5 },
      green: { hue: -20, saturation: -25 },
      blue: { saturation: -20 },
    },
  },
]

/** Words that carry no adjustment ("make it look a bit warmer, please"). */
export const FILLERS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'some',
  'of',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'them',
  'me',
  'my',
  'i',
  'im',
  'we',
  'want',
  'would',
  'like',
  'love',
  'need',
  'please',
  'pls',
  'make',
  'making',
  'give',
  'get',
  'go',
  'going',
  'for',
  'to',
  'be',
  'is',
  'are',
  'look',
  'looks',
  'looking',
  'feel',
  'feeling',
  'feels',
  'vibe',
  'vibes',
  'style',
  'mood',
  'tone',
  'tones',
  'color',
  'colors',
  'photo',
  'photos',
  'image',
  'images',
  'picture',
  'pictures',
  'pic',
  'pics',
  'shot',
  'shots',
  'edit',
  'effect',
  'filter',
  'aesthetic',
  'overall',
  'just',
  'in',
  'on',
  'at',
  'as',
  'everything',
  'all',
  'whole',
  'finish',
  'grade',
  'grading',
  'treatment',
  'up',
  'down',
  'thanks',
])

/** Words that separate clauses unless they sit inside a known phrase ("black and white"). */
export const SOFT_SEPARATORS: ReadonlySet<string> = new Set([
  'and',
  'with',
  'but',
  'plus',
  'also',
  'yet',
  'then',
  'while',
  'or',
])
