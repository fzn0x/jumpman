/** Scene detection heuristics and scene-aware automatic edits. */
import { defaultBasic } from '../model/basic.ts'
import { createLayer, defaultHsl, type Layer } from '../model/layers.ts'
import { clamp, mean, round } from '../util.ts'
import type { PhotoStats } from './stats.ts'

export const SCENE_TYPES = [
  'landscape',
  'portrait',
  'nature',
  'night',
  'urban',
  'golden',
  'everyday',
] as const
export type SceneType = (typeof SCENE_TYPES)[number]

export const SCENE_LABELS: Record<SceneType, string> = {
  landscape: 'Landscape',
  portrait: 'Portrait',
  nature: 'Foliage',
  night: 'Night',
  urban: 'Architecture',
  golden: 'Golden light',
  everyday: 'Everyday',
}

export function classifyScene(stats: PhotoStats): {
  primary: SceneType
  scores: Record<SceneType, number>
} {
  const s = stats.scene
  const scores: Record<SceneType, number> = {
    landscape: s.sky * 0.7 + Math.min(s.foliage * 2, 0.6) * 0.5,
    portrait: Math.min(1, s.skin * 3.5),
    nature: Math.min(1, s.foliage * 1.6),
    night: s.lowLight,
    urban: s.neutral * 0.8 * (1 - s.foliage) * (1 - s.skin * 2),
    golden: clamp(s.warmth * 2.2) * (1 - s.lowLight),
    everyday: 0.3,
  }
  let primary: SceneType = 'everyday'
  for (const t of SCENE_TYPES) if (scores[t] > scores[primary]) primary = t
  return { primary, scores }
}

/**
 * Scene-aware auto edit: detects sky, skin, foliage and architecture across
 * the batch and returns tuned layers (scaled by how present each region is).
 * Region targeting uses hue bands and the heuristic sky mask, so it
 * propagates naturally to similar compositions.
 */
export function sceneAutoLayers(statsList: PhotoStats[]): Layer[] {
  if (!statsList.length) return []
  const sky = mean(statsList.map((s) => s.scene.sky))
  const skin = mean(statsList.map((s) => s.scene.skin))
  const foliage = mean(statsList.map((s) => s.scene.foliage))
  const neutral = mean(statsList.map((s) => s.scene.neutral))
  const lowLight = mean(statsList.map((s) => s.scene.lowLight))
  const layers: Layer[] = []

  const hsl = defaultHsl()
  let touched = false
  if (sky > 0.08) {
    const k = clamp(sky * 2)
    hsl.blue = { hue: round(-4 * k, 0), saturation: round(18 * k, 0), luminance: round(-14 * k, 0) }
    hsl.aqua = { hue: 0, saturation: round(8 * k, 0), luminance: round(-6 * k, 0) }
    touched = true
  }
  if (foliage > 0.05) {
    const k = clamp(foliage * 2.5)
    hsl.green = { hue: round(-8 * k, 0), saturation: round(10 * k, 0), luminance: round(4 * k, 0) }
    hsl.yellow = { hue: round(-5 * k, 0), saturation: round(6 * k, 0), luminance: round(4 * k, 0) }
    touched = true
  }
  if (skin > 0.04) {
    const k = clamp(skin * 4)
    hsl.orange = { hue: round(2 * k, 0), saturation: round(-8 * k, 0), luminance: round(10 * k, 0) }
    hsl.red = { hue: round(3 * k, 0), saturation: round(-4 * k, 0), luminance: round(4 * k, 0) }
    touched = true
  }
  if (touched) layers.push(createLayer('hsl', { name: 'Scene: color', params: hsl }))

  if (sky > 0.08) {
    layers.push(
      createLayer('basic', {
        name: 'Scene: sky',
        mask: { type: 'sky' },
        params: {
          ...defaultBasic(),
          highlights: round(-30 * clamp(sky * 2), 0),
          whites: -8,
          vibrance: 10,
        },
      }),
    )
  }
  if (skin > 0.04) {
    layers.push(
      createLayer('basic', {
        name: 'Scene: subject',
        mask: { type: 'subject', size: 0.55 },
        params: { ...defaultBasic(), exposure: 0.15, shadows: 12, contrast: -5 },
      }),
    )
  }
  const tonal = { ...defaultBasic() }
  if (neutral > 0.35) {
    tonal.contrast = round(12 * clamp((neutral - 0.35) * 3), 0)
    tonal.whites = 6
  }
  if (lowLight > 0.45) {
    tonal.shadows = round(25 * clamp((lowLight - 0.45) * 3), 0)
    tonal.blacks = -6
  }
  if (Object.values(tonal).some((v) => v !== 0)) {
    layers.push(createLayer('basic', { name: 'Scene: tone', params: tonal }))
  }
  return layers
}
