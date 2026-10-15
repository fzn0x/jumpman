import { describe, expect, it } from 'vitest'
import { renderImage } from '../color/pipeline.ts'
import { type Norm, normLayer } from '../model/edit.ts'
import { landscape } from '../test/images.ts'
import {
  adaptiveNorms,
  autoMatch,
  consistency,
  harmonize,
  MIDDLE_GRAY_EV,
  measure,
  referenceMatch,
} from './match.ts'
import { computeStats } from './stats.ts'

const batch = () => [
  landscape({ gain: 0.55, cast: [1.15, 1, 0.8] }),
  landscape({ gain: 0.85 }),
  landscape({ gain: 0.7, cast: [0.85, 1, 1.15] }),
]
const noLuts = () => undefined

describe('auto-match', () => {
  it('brings exposure and white balance together, verified by re-rendering', () => {
    const imgs = batch()
    const items = imgs.map((img) => ({ stats: computeStats(img) }))
    const before = consistency(items)
    const norms = autoMatch(items)
    const after = imgs.map((img, i) =>
      computeStats(renderImage(img, [normLayer(norms[i] as Norm)], noLuts)),
    )
    const rendered = consistency(after.map((stats) => ({ stats })))
    expect(rendered.exposure.spread).toBeLessThan(before.exposure.spread / 3)
    expect(rendered.temperature.spread).toBeLessThan(before.temperature.spread / 3)
    expect(rendered.score).toBeGreaterThan(before.score)
  })

  it('predicts the measurements after correction', () => {
    const items = batch().map((img) => ({ stats: computeStats(img) }))
    const norms = autoMatch(items)
    const evs = items.map((item, i) => measure({ ...item, norm: norms[i] }).ev)
    expect(Math.max(...evs) - Math.min(...evs)).toBeLessThan(0.02)
  })
})

describe('reference-match and adaptive mode', () => {
  it('matches the batch to a hero photo and leaves the hero alone', () => {
    const items = batch().map((img) => ({ stats: computeStats(img) }))
    const hero = items[0]
    if (!hero) throw new Error('missing hero')
    const norms = referenceMatch(hero, items)
    expect(norms[0]?.exposure).toBe(0)
    const heroEv = measure(hero).ev
    expect(
      measure({ ...items[1], stats: items[1]?.stats ?? hero.stats, norm: norms[1] }).ev,
    ).toBeCloseTo(heroEv, 1)
  })

  it('targets middle gray in adaptive mode', () => {
    const stats = batch().map((img) => computeStats(img))
    const norms = adaptiveNorms(stats)
    stats.forEach((s, i) => {
      expect(measure({ stats: s, norm: norms[i] }).ev).toBeCloseTo(MIDDLE_GRAY_EV, 1)
    })
  })
})

describe('consistency', () => {
  it('scores a uniform batch as perfect and flags outliers', () => {
    const same = [landscape(), landscape(), landscape()].map((img) => ({
      stats: computeStats(img),
    }))
    expect(consistency(same).score).toBe(100)
    const mixed = [landscape(), landscape(), landscape({ gain: 0.3 })].map((img) => ({
      stats: computeStats(img),
    }))
    const c = consistency(mixed)
    expect(c.score).toBeLessThan(80)
    expect(c.outliers[0]).toBe(2)
  })

  it('harmonize improves the score', () => {
    const items = batch().map((img) => ({ stats: computeStats(img) }))
    const norms = harmonize(items)
    const after = consistency(items.map((item, i) => ({ ...item, norm: norms[i] })))
    expect(after.score).toBeGreaterThan(95)
  })
})
