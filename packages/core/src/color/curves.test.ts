import { describe, expect, it } from 'vitest'
import { defaultCurves } from '../model/layers.ts'
import { curveEvaluator, curvesTable, lookupCurve } from './curves.ts'

describe('tone curves', () => {
  it('identity curve maps x to x', () => {
    const f = curveEvaluator([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ])
    for (const x of [0, 0.25, 0.5, 0.9]) expect(f(x)).toBeCloseTo(x, 6)
  })

  it('passes through control points and stays monotone', () => {
    const pts = [
      { x: 0, y: 0.05 },
      { x: 0.25, y: 0.2 },
      { x: 0.75, y: 0.85 },
      { x: 1, y: 0.95 },
    ]
    const f = curveEvaluator(pts)
    for (const p of pts) expect(f(p.x)).toBeCloseTo(p.y, 6)
    let prev = -1
    for (let i = 0; i <= 100; i++) {
      const y = f(i / 100)
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = y
    }
  })

  it('composes channel curves with the master curve in the table', () => {
    const params = defaultCurves()
    params.master = [
      { x: 0, y: 0.1 },
      { x: 1, y: 1 },
    ]
    params.red = [
      { x: 0, y: 0 },
      { x: 1, y: 0.5 },
    ]
    const table = curvesTable(params)
    expect(lookupCurve(table, 0, 0)).toBeCloseTo(0.05, 4)
    expect(lookupCurve(table, 1, 0)).toBeCloseTo(0.1, 4)
    expect(lookupCurve(table, 2, 1)).toBeCloseTo(1, 4)
  })
})
