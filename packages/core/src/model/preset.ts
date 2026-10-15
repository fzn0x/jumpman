/** Presets ("recipes"): reusable, shareable global edits. */
import { builtinLutId } from '../color/looks.ts'
import type { Lut3D } from '../color/lut.ts'
import { base64Decode, base64Encode, utf8Decode, utf8Encode } from '../encoding.ts'
import { defaultBasic } from './basic.ts'
import { aspectRatioOf } from './crop.ts'
import type { GlobalEdit } from './edit.ts'
import {
  BASE_LAYER_ID,
  createBaseLayer,
  createLayer,
  defaultSplit,
  type Layer,
  newId,
} from './layers.ts'
import { sanitizeLayers, str } from './sanitize.ts'

export const PRESET_SCHEMA = 'jumpman.preset/1'

export interface EmbeddedLut {
  size: number
  title?: string
  /** Base64 of little-endian uint16 values (0..65535 → 0..1). */
  data: string
}

export interface Preset {
  schema: typeof PRESET_SCHEMA
  id: string
  name: string
  author?: string
  description?: string
  tags?: string[]
  createdAt: number
  layers: Layer[]
  adaptive?: boolean
  aspect?: string
  /** Custom LUTs referenced by the layers, embedded so presets stay portable. */
  luts?: Record<string, EmbeddedLut>
  forkedFrom?: { id: string; name: string; author?: string }
}

export function encodeLut(lut: Lut3D): EmbeddedLut {
  const bytes = new Uint8Array(lut.data.length * 2)
  for (let i = 0; i < lut.data.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, lut.data[i] as number)) * 65535)
    bytes[i * 2] = v & 255
    bytes[i * 2 + 1] = v >> 8
  }
  return { size: lut.size, ...(lut.title ? { title: lut.title } : {}), data: base64Encode(bytes) }
}

export function decodeLut(e: EmbeddedLut): Lut3D {
  const size = Math.round(e.size)
  if (!(size >= 2 && size <= 65)) throw new Error('Unsupported LUT size')
  const bytes = base64Decode(e.data)
  const count = size ** 3 * 3
  if (bytes.length !== count * 2) throw new Error('LUT data has the wrong length')
  const data = new Float32Array(count)
  for (let i = 0; i < count; i++)
    data[i] = ((bytes[i * 2] as number) | ((bytes[i * 2 + 1] as number) << 8)) / 65535
  return e.title ? { size, data, title: e.title } : { size, data }
}

export function createPreset(
  name: string,
  edit: Pick<GlobalEdit, 'layers'> & Partial<GlobalEdit>,
  meta: Partial<Pick<Preset, 'author' | 'description' | 'tags' | 'luts' | 'forkedFrom'>> = {},
): Preset {
  return {
    schema: PRESET_SCHEMA,
    id: newId('p'),
    name,
    createdAt: Date.now(),
    layers: structuredLayers(edit.layers),
    ...(edit.adaptive ? { adaptive: true } : {}),
    ...(edit.aspect && edit.aspect !== 'original' ? { aspect: edit.aspect } : {}),
    ...meta,
  }
}

function structuredLayers(layers: Layer[]): Layer[] {
  return JSON.parse(JSON.stringify(layers.filter((l) => !l.proposedBy))) as Layer[]
}

/** Validates and normalizes untrusted preset JSON. Throws on unusable input. */
export function parsePreset(input: unknown): Preset {
  const v = typeof input === 'string' ? (JSON.parse(input) as unknown) : input
  if (typeof v !== 'object' || v === null) throw new Error('Not a preset')
  const o = v as Record<string, unknown>
  if (o.schema !== PRESET_SCHEMA) throw new Error('Unknown preset format')
  const layers = sanitizeLayers(o.layers)
  if (!layers.length) throw new Error('Preset has no layers')
  const luts: Record<string, EmbeddedLut> = {}
  if (typeof o.luts === 'object' && o.luts !== null) {
    for (const [id, l] of Object.entries(o.luts as Record<string, unknown>).slice(0, 8)) {
      const e = l as Partial<EmbeddedLut>
      if (typeof e?.data === 'string' && typeof e.size === 'number') {
        decodeLut(e as EmbeddedLut)
        luts[str(id, 120)] = {
          size: e.size,
          data: e.data,
          ...(e.title ? { title: str(e.title, 80) } : {}),
        }
      }
    }
  }
  const fork = o.forkedFrom as Record<string, unknown> | undefined
  const aspect = str(o.aspect, 12)
  return {
    schema: PRESET_SCHEMA,
    id: str(o.id, 64) || newId('p'),
    name: str(o.name, 80) || 'Untitled preset',
    ...(o.author ? { author: str(o.author, 80) } : {}),
    ...(o.description ? { description: str(o.description, 500) } : {}),
    ...(Array.isArray(o.tags)
      ? {
          tags: o.tags
            .slice(0, 12)
            .map((t) => str(t, 32))
            .filter(Boolean),
        }
      : {}),
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    layers,
    ...(o.adaptive === true ? { adaptive: true } : {}),
    ...(aspect && aspectRatioOf(aspect) !== null ? { aspect } : {}),
    ...(Object.keys(luts).length ? { luts } : {}),
    ...(fork && typeof fork === 'object'
      ? {
          forkedFrom: {
            id: str(fork.id, 64),
            name: str(fork.name, 80),
            ...(fork.author ? { author: str(fork.author, 80) } : {}),
          },
        }
      : {}),
  }
}

/** Forks a preset (marketplace remixing): new id, attribution kept. */
export function forkPreset(source: Preset, author?: string): Preset {
  return {
    ...JSON.parse(JSON.stringify(source)),
    id: newId('p'),
    name: `${source.name} (remix)`,
    createdAt: Date.now(),
    ...(author ? { author } : {}),
    forkedFrom: {
      id: source.id,
      name: source.name,
      ...(source.author ? { author: source.author } : {}),
    },
  }
}

/** Compact, URL-safe share string (custom LUTs are not included). */
export function presetToShareString(preset: Preset): string {
  const { luts: _luts, ...rest } = preset
  return base64Encode(utf8Encode(JSON.stringify(rest)), true)
}

export function presetFromShareString(s: string): Preset {
  return parsePreset(utf8Decode(base64Decode(s)))
}

const lut = (id: string, opacity = 1) =>
  createLayer('lut', { name: 'LUT', opacity, params: { lutId: builtinLutId(id) } })
const base = (p: Parameters<typeof createBaseLayer>[0]) => createBaseLayer(p)

/** Presets that ship with the app. */
export function builtinPresets(): Preset[] {
  const make = (
    id: string,
    name: string,
    description: string,
    tags: string[],
    layers: Layer[],
  ): Preset => ({
    schema: PRESET_SCHEMA,
    id: `builtin-${id}`,
    name,
    author: 'Jumpman',
    description,
    tags,
    createdAt: 0,
    layers,
  })
  return [
    make(
      'spring-pink',
      'Spring Pink',
      'Soft coral glow for blossoms, portraits and pastel days.',
      ['pink', 'soft', 'spring'],
      [base({ exposure: 0.15, shadows: 12, highlights: -8 }), lut('spring-pink', 0.85)],
    ),
    make(
      'clean-bright',
      'Clean & Bright',
      'Airy, true-to-life lift for everyday sets.',
      ['bright', 'natural'],
      [base({ exposure: 0.25, highlights: -20, shadows: 18, vibrance: 12, whites: 8 })],
    ),
    make(
      'moody-forest',
      'Moody Forest',
      'Deep greens, cool shadows and quiet highlights.',
      ['moody', 'nature'],
      [
        base({ exposure: -0.2, contrast: 14, highlights: -25, saturation: -10, temperature: -6 }),
        createLayer('hsl', {
          name: 'HSL',
          params: {
            red: { hue: 0, saturation: 0, luminance: 0 },
            orange: { hue: 0, saturation: -6, luminance: 4 },
            yellow: { hue: -20, saturation: -20, luminance: -10 },
            green: { hue: 20, saturation: -25, luminance: -18 },
            aqua: { hue: 0, saturation: -10, luminance: -10 },
            blue: { hue: -6, saturation: -15, luminance: -12 },
            purple: { hue: 0, saturation: 0, luminance: 0 },
            magenta: { hue: 0, saturation: 0, luminance: 0 },
          },
        }),
        createLayer('split', {
          name: 'Split toning',
          params: {
            ...defaultSplit(),
            shadowHue: 190,
            shadowSaturation: 30,
            highlightHue: 45,
            highlightSaturation: 12,
          },
        }),
      ],
    ),
    make(
      'warm-film',
      'Warm Film',
      'Negative-film warmth with soft roll-off.',
      ['film', 'warm'],
      [base({ shadows: 6 }), lut('warm-film')],
    ),
    make(
      'teal-orange',
      'Teal & Orange',
      'Cinematic complementary grade.',
      ['cinematic'],
      [base({ contrast: 6 }), lut('teal-orange', 0.9)],
    ),
    make(
      'golden-hour',
      'Golden Hour',
      'Bottled sunset light.',
      ['warm', 'sunset'],
      [base({ exposure: 0.1 }), lut('golden-hour', 0.9)],
    ),
    make(
      'nordic',
      'Nordic Minimal',
      'Cool, clean and calm.',
      ['cool', 'minimal'],
      [base({ exposure: 0.1 }), lut('nordic')],
    ),
    make(
      'pastel-dream',
      'Pastel Dream',
      'Low-contrast candy tones.',
      ['pastel', 'soft'],
      [base({ exposure: 0.1 }), lut('pastel', 0.8)],
    ),
    make(
      'street-noir',
      'Street Noir',
      'Gritty black and white for street sets.',
      ['bw', 'street'],
      [base({ ...defaultBasic(), grain: 25, vignette: -25 }), lut('noir')],
    ),
  ]
}

export function isBuiltinPreset(p: Preset): boolean {
  return p.id.startsWith('builtin-')
}

/** Layers to apply for a preset (the base layer keeps the reserved id). */
export function presetLayers(p: Preset): Layer[] {
  return p.layers.map((l) => (l.id === BASE_LAYER_ID ? l : { ...l, id: newId() }))
}
