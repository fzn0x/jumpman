// One-off generator for the seed community presets (kept for reference).
import { writeFileSync } from 'node:fs'
import {
  builtinLutId,
  createBaseLayer,
  createLayer,
  defaultHsl,
  defaultSplit,
  PRESET_SCHEMA,
  type Preset,
} from '../packages/core/src/index.ts'

const presets: Preset[] = [
  {
    schema: PRESET_SCHEMA,
    id: 'community-kyoto-blossom',
    name: 'Kyoto Blossom',
    author: 'jumpman-community',
    description: 'Cherry-blossom pinks with a quiet, misty sky.',
    tags: ['pink', 'spring', 'travel'],
    createdAt: Date.UTC(2026, 9, 1),
    layers: [
      createBaseLayer({
        exposure: 0.2,
        highlights: -25,
        shadows: 15,
        temperature: 4,
        tint: 12,
        vibrance: 10,
      }),
      createLayer('lut', {
        name: 'Spring Pink',
        opacity: 0.7,
        params: { lutId: builtinLutId('spring-pink') },
      }),
      createLayer('hsl', {
        params: {
          ...defaultHsl(),
          blue: { hue: -10, saturation: -25, luminance: 15 },
          magenta: { hue: 0, saturation: 15, luminance: 5 },
        },
      }),
    ],
  },
  {
    schema: PRESET_SCHEMA,
    id: 'community-desert-road',
    name: 'Desert Road',
    author: 'jumpman-community',
    description: 'Dusty ambers, faded blacks and road-trip warmth.',
    tags: ['warm', 'film', 'travel'],
    createdAt: Date.UTC(2026, 9, 2),
    layers: [
      createBaseLayer({ temperature: 22, contrast: 8, fade: 18, saturation: -10, highlights: -15 }),
      createLayer('split', {
        params: {
          ...defaultSplit(),
          shadowHue: 200,
          shadowSaturation: 18,
          highlightHue: 38,
          highlightSaturation: 30,
        },
      }),
    ],
  },
  {
    schema: PRESET_SCHEMA,
    id: 'community-neon-tokyo',
    name: 'Neon Tokyo',
    author: 'jumpman-community',
    description: 'Night streets in magenta and cyan.',
    tags: ['night', 'street', 'cinematic'],
    createdAt: Date.UTC(2026, 9, 3),
    layers: [
      createBaseLayer({ exposure: 0.15, shadows: 20, contrast: 10 }),
      createLayer('lut', { name: 'Neon Night', params: { lutId: builtinLutId('cyber') } }),
    ],
  },
  {
    schema: PRESET_SCHEMA,
    id: 'community-coastal-morning',
    name: 'Coastal Morning',
    author: 'jumpman-community',
    description: 'Clean blues and soft sand for beach sets.',
    tags: ['bright', 'summer', 'beach'],
    createdAt: Date.UTC(2026, 9, 4),
    layers: [
      createBaseLayer({
        exposure: 0.3,
        highlights: -30,
        shadows: 10,
        whites: 10,
        vibrance: 15,
        temperature: -4,
      }),
      createLayer('hsl', {
        params: {
          ...defaultHsl(),
          aqua: { hue: 5, saturation: 15, luminance: 5 },
          blue: { hue: -5, saturation: 10, luminance: -5 },
          orange: { hue: 0, saturation: -10, luminance: 8 },
        },
      }),
    ],
  },
  {
    schema: PRESET_SCHEMA,
    id: 'community-forest-floor',
    name: 'Forest Floor',
    author: 'jumpman-community',
    description: 'Earthy greens and mossy shadows.',
    tags: ['nature', 'moody'],
    createdAt: Date.UTC(2026, 9, 5),
    layers: [
      createBaseLayer({ exposure: -0.1, contrast: 12, highlights: -20, saturation: -8 }),
      createLayer('lut', {
        name: 'Green Film',
        opacity: 0.8,
        params: { lutId: builtinLutId('green-film') },
      }),
    ],
  },
  {
    schema: PRESET_SCHEMA,
    id: 'community-airy-wedding',
    name: 'Airy Wedding',
    author: 'jumpman-community',
    description: 'Bright, creamy and skin-friendly.',
    tags: ['wedding', 'bright', 'portrait'],
    createdAt: Date.UTC(2026, 9, 6),
    layers: [
      createBaseLayer({
        exposure: 0.35,
        contrast: -12,
        highlights: -20,
        shadows: 20,
        temperature: 6,
        fade: 8,
      }),
      createLayer('hsl', {
        params: {
          ...defaultHsl(),
          orange: { hue: 3, saturation: -12, luminance: 12 },
          green: { hue: 15, saturation: -30, luminance: 0 },
        },
      }),
    ],
  },
]

for (const p of presets) {
  writeFileSync(
    new URL(`../community/presets/${p.id.replace('community-', '')}.json`, import.meta.url),
    `${JSON.stringify(p, null, 2)}\n`,
  )
}
console.log(`wrote ${presets.length} presets`)
