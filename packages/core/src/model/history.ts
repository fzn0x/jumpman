/** A bounded undo/redo stack of immutable snapshots. */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

export const HISTORY_LIMIT = 100

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/** Records a new present state; no-op when the state did not change. */
export function pushHistory<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h
  const past = [...h.past, h.present]
  if (past.length > limit) past.splice(0, past.length - limit)
  return { past, present: next, future: [] }
}

/** Replaces the present without creating an undo step (e.g. during a slider drag). */
export function replacePresent<T>(h: History<T>, next: T): History<T> {
  return { ...h, present: next }
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1]
  if (prev === undefined) return h
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...future] = h.future
  if (next === undefined) return h
  return { past: [...h.past, h.present], present: next, future }
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0
export const canRedo = <T>(h: History<T>) => h.future.length > 0
