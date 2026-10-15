import { describe, expect, it } from 'vitest'
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  replacePresent,
  undo,
} from './history.ts'

describe('history', () => {
  it('undoes and redoes', () => {
    let h = createHistory(1)
    h = pushHistory(h, 2)
    h = pushHistory(h, 3)
    expect(canUndo(h)).toBe(true)
    h = undo(h)
    expect(h.present).toBe(2)
    expect(canRedo(h)).toBe(true)
    h = redo(h)
    expect(h.present).toBe(3)
    expect(redo(h)).toBe(h)
  })

  it('drops the redo branch on new edits and bounds its size', () => {
    let h = createHistory(0)
    for (let i = 1; i <= 10; i++) h = pushHistory(h, i, 5)
    expect(h.past).toEqual([5, 6, 7, 8, 9])
    h = pushHistory(undo(h), 42)
    expect(h.future).toEqual([])
  })

  it('replaces the present without an undo step', () => {
    const h = replacePresent(createHistory('a'), 'b')
    expect(h.present).toBe('b')
    expect(canUndo(h)).toBe(false)
  })
})
