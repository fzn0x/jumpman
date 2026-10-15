import { describe, expect, it } from 'vitest'
import { landscape, makeImage } from '../test/images.ts'
import { classifyScene, sceneAutoLayers } from './scene.ts'
import { computeStats } from './stats.ts'

describe('scene detection', () => {
  it('classifies landscapes and night shots', () => {
    expect(classifyScene(computeStats(landscape())).primary).toBe('landscape')
    const night = makeImage(32, 32, (u) => (u > 0.9 ? [0.9, 0.8, 0.4] : [0.04, 0.04, 0.07]))
    expect(classifyScene(computeStats(night)).primary).toBe('night')
  })

  it('builds sky and foliage aware layers', () => {
    const layers = sceneAutoLayers([computeStats(landscape())])
    const names = layers.map((l) => l.name)
    expect(names).toContain('Scene: color')
    expect(names).toContain('Scene: sky')
    const skyLayer = layers.find((l) => l.name === 'Scene: sky')
    expect(skyLayer?.mask?.type).toBe('sky')
  })

  it('returns nothing for an empty batch', () => {
    expect(sceneAutoLayers([])).toEqual([])
  })
})
