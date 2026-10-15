import {
  applyOp,
  type Branch,
  builtinPresets,
  createBranch,
  createHistory,
  decodeLut,
  type EditOp,
  forkBranch,
  type Lut3D,
  type Macro,
  newId,
  type Preset,
  type Review,
} from '@jumpman/core'
import { create } from 'zustand'
import { blobDb, metaDb, photoKeys } from '../lib/db.ts'
import { type ImportResult, importFiles } from '../lib/importer.ts'
import {
  CUSTOM_LUT_PREFIX,
  loadLut,
  lutKey,
  persistLut,
  registerLut,
  unregisterLut,
} from '../lib/luts.ts'
import type {
  Batch,
  BatchHistory,
  BatchLook,
  Collection,
  CustomLutMeta,
  Photo,
  Settings,
} from '../lib/types.ts'

export interface ImportProgress {
  total: number
  done: number
  errors: string[]
  collectionId: string
}

export interface LibraryState {
  ready: boolean
  photos: Record<string, Photo>
  collections: Record<string, Collection>
  batches: Record<string, Batch>
  histories: Record<string, BatchHistory>
  presets: Preset[]
  macros: Macro[]
  luts: CustomLutMeta[]
  settings: Settings
  importing: ImportProgress | null
  /** Bumped when custom LUT data changes so renders refresh. */
  lutVersion: number
}

export const DEFAULT_SETTINGS: Settings = {
  author: '',
  exportFormat: 'image/jpeg',
  exportQuality: 0.9,
  exportMaxEdge: 0,
  exportPattern: '{collection}-{n:3}',
  watermark: '',
  watermarkPosition: 'bottom-right',
  watermarkOpacity: 0.7,
  includeXmp: false,
  onboarded: false,
}

export const useLibrary = create<LibraryState>(() => ({
  ready: false,
  photos: {},
  collections: {},
  batches: {},
  histories: {},
  presets: [],
  macros: [],
  luts: [],
  settings: DEFAULT_SETTINGS,
  importing: null,
  lutVersion: 0,
}))

const set = useLibrary.setState
const get = useLibrary.getState

/* ------------------------------------------------------------------ */
/* Persistence                                                          */
/* ------------------------------------------------------------------ */

type EntityMap = 'photos' | 'collections' | 'batches' | 'histories'
const PREFIX: Record<EntityMap, string> = {
  photos: 'photo:',
  collections: 'collection:',
  batches: 'batch:',
  histories: 'history:',
}
const HISTORY_PERSIST_LIMIT = 30

let saved: Pick<LibraryState, EntityMap | 'presets' | 'macros' | 'luts' | 'settings'> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

function persistable(map: EntityMap, value: unknown): unknown {
  if (map !== 'histories') return value
  const h = value as BatchHistory
  return {
    past: h.past.slice(-HISTORY_PERSIST_LIMIT),
    future: h.future.slice(0, HISTORY_PERSIST_LIMIT),
  }
}

async function flush() {
  flushTimer = null
  const s = get()
  if (!saved) return
  const writes: [string, unknown][] = []
  const deletes: string[] = []
  for (const map of Object.keys(PREFIX) as EntityMap[]) {
    const cur = s[map] as Record<string, unknown>
    const prev = saved[map] as Record<string, unknown>
    if (cur === prev) continue
    for (const [id, v] of Object.entries(cur))
      if (prev[id] !== v) writes.push([PREFIX[map] + id, persistable(map, v)])
    for (const id of Object.keys(prev)) if (!(id in cur)) deletes.push(PREFIX[map] + id)
  }
  for (const key of ['presets', 'macros', 'luts', 'settings'] as const) {
    if (s[key] !== saved[key]) writes.push([key, s[key]])
  }
  saved = {
    photos: s.photos,
    collections: s.collections,
    batches: s.batches,
    histories: s.histories,
    presets: s.presets,
    macros: s.macros,
    luts: s.luts,
    settings: s.settings,
  }
  if (writes.length) await metaDb.setMany(writes)
  if (deletes.length) await metaDb.delMany(deletes)
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => void flush(), 400)
}

export function flushNow(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer)
  return flush()
}

export async function initLibrary(): Promise<void> {
  const all = await metaDb.entries<unknown>()
  const photos: Record<string, Photo> = {}
  const collections: Record<string, Collection> = {}
  const batches: Record<string, Batch> = {}
  const stored: Record<string, { past: BatchLook[]; future: BatchLook[] }> = {}
  let presets: Preset[] = []
  let macros: Macro[] = []
  let luts: CustomLutMeta[] = []
  let settings = DEFAULT_SETTINGS
  for (const [key, value] of all) {
    if (key.startsWith('photo:')) photos[key.slice(6)] = value as Photo
    else if (key.startsWith('collection:')) collections[key.slice(11)] = value as Collection
    else if (key.startsWith('batch:')) batches[key.slice(6)] = value as Batch
    else if (key.startsWith('history:'))
      stored[key.slice(8)] = value as { past: BatchLook[]; future: BatchLook[] }
    else if (key === 'presets') presets = value as Preset[]
    else if (key === 'macros') macros = value as Macro[]
    else if (key === 'luts') luts = value as CustomLutMeta[]
    else if (key === 'settings') settings = { ...DEFAULT_SETTINGS, ...(value as Partial<Settings>) }
  }
  const histories: Record<string, BatchHistory> = {}
  for (const [id, b] of Object.entries(batches)) {
    const h = stored[id]
    histories[id] = { past: h?.past ?? [], present: b.look, future: h?.future ?? [], pending: null }
  }
  await Promise.all(luts.map((l) => loadLut(l.id, l.size, l.name)))
  set({ ready: true, photos, collections, batches, histories, presets, macros, luts, settings })
  const s = get()
  saved = {
    photos: s.photos,
    collections: s.collections,
    batches: s.batches,
    histories: s.histories,
    presets: s.presets,
    macros: s.macros,
    luts: s.luts,
    settings: s.settings,
  }
  useLibrary.subscribe(scheduleFlush)
  addEventListener('pagehide', () => void flushNow())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushNow()
  })
}

/* ------------------------------------------------------------------ */
/* Collections & photos                                                 */
/* ------------------------------------------------------------------ */

export function createCollection(name: string): string {
  const id = newId('c')
  const now = Date.now()
  set((s) => ({
    collections: {
      ...s.collections,
      [id]: { id, name, photoIds: [], createdAt: now, updatedAt: now },
    },
  }))
  return id
}

export function renameCollection(id: string, name: string): void {
  set((s) => {
    const c = s.collections[id]
    return c
      ? { collections: { ...s.collections, [id]: { ...c, name, updatedAt: Date.now() } } }
      : {}
  })
}

function addImported(collectionId: string, r: ImportResult): string {
  const id = newId('ph')
  const photo: Photo = {
    id,
    name: r.name,
    type: r.type,
    size: r.size,
    width: r.width,
    height: r.height,
    takenAt: r.takenAt,
    addedAt: Date.now(),
    ...(r.raw ? { raw: r.raw } : {}),
    stats: r.stats,
    collectionId,
  }
  set((s) => {
    const c = s.collections[collectionId]
    if (!c) return {}
    return {
      photos: { ...s.photos, [id]: photo },
      collections: {
        ...s.collections,
        [collectionId]: { ...c, photoIds: [...c.photoIds, id], updatedAt: Date.now() },
      },
    }
  })
  return id
}

/** Imports files into a collection in the background. Returns the new photo ids. */
export async function addFiles(collectionId: string, files: File[]): Promise<string[]> {
  if (!files.length) return []
  const ids: string[] = []
  set({ importing: { total: files.length, done: 0, errors: [], collectionId } })
  await importFiles(files, async (result, file, error) => {
    if (result) {
      const id = addImported(collectionId, result)
      await blobDb.setMany([
        [photoKeys.source(id), result.source],
        [photoKeys.preview(id), result.preview],
        [photoKeys.thumb(id), result.thumb],
      ])
      ids.push(id)
    }
    set((s) =>
      s.importing
        ? {
            importing: {
              ...s.importing,
              done: s.importing.done + 1,
              errors: error
                ? [...s.importing.errors, `${file.name}: ${error.message}`]
                : s.importing.errors,
            },
          }
        : {},
    )
  })
  const errors = get().importing?.errors ?? []
  set({
    importing: errors.length
      ? { total: files.length, done: files.length, errors, collectionId }
      : null,
  })
  // Keep the collection in capture order.
  set((s) => {
    const c = s.collections[collectionId]
    if (!c) return {}
    const photoIds = [...c.photoIds].sort(
      (a, b) => (s.photos[a]?.takenAt ?? 0) - (s.photos[b]?.takenAt ?? 0),
    )
    return { collections: { ...s.collections, [collectionId]: { ...c, photoIds } } }
  })
  return ids
}

export function dismissImportErrors(): void {
  set({ importing: null })
}

export async function removePhotos(ids: string[]): Promise<void> {
  const gone = new Set(ids)
  set((s) => {
    const photos = { ...s.photos }
    for (const id of ids) delete photos[id]
    const collections = { ...s.collections }
    for (const [cid, c] of Object.entries(s.collections)) {
      if (c.photoIds.some((p) => gone.has(p)))
        collections[cid] = { ...c, photoIds: c.photoIds.filter((p) => !gone.has(p)) }
    }
    const batches = { ...s.batches }
    const histories = { ...s.histories }
    for (const [bid, b] of Object.entries(s.batches)) {
      if (!b.photoIds.some((p) => gone.has(p))) continue
      const photoIds = b.photoIds.filter((p) => !gone.has(p))
      if (!photoIds.length) {
        delete batches[bid]
        delete histories[bid]
      } else {
        batches[bid] = { ...b, photoIds, look: withoutPhotos(b.look, gone) }
      }
    }
    return { photos, collections, batches, histories }
  })
  await blobDb.delMany(ids.flatMap(photoKeys.all))
}

export async function deleteCollection(id: string): Promise<void> {
  const c = get().collections[id]
  if (!c) return
  await removePhotos(c.photoIds)
  set((s) => {
    const collections = { ...s.collections }
    delete collections[id]
    return { collections }
  })
}

export function setReview(collectionId: string, review: Review): void {
  set((s) => {
    const c = s.collections[collectionId]
    return c ? { collections: { ...s.collections, [collectionId]: { ...c, review } } } : {}
  })
}

/* ------------------------------------------------------------------ */
/* Batches                                                              */
/* ------------------------------------------------------------------ */

function withoutPhotos(look: BatchLook, gone: Set<string>): BatchLook {
  return {
    ...look,
    branches: look.branches.map((b) => ({
      ...b,
      photos: Object.fromEntries(Object.entries(b.photos).filter(([id]) => !gone.has(id))),
    })),
  }
}

function onlyPhotos(look: BatchLook, keep: Set<string>): BatchLook {
  return {
    ...look,
    branches: look.branches.map((b) => ({
      ...b,
      photos: Object.fromEntries(Object.entries(b.photos).filter(([id]) => keep.has(id))),
    })),
  }
}

export function activeBranch(batch: Batch): Branch {
  return (batch.look.branches.find((b) => b.id === batch.look.activeBranchId) ??
    batch.look.branches[0]) as Branch
}

/**
 * Opens (or creates) the batch for a selection. Photos already edited
 * together keep their batch; a new selection inherits the look of the batch
 * its first photo belonged to.
 */
export function openBatch(collectionId: string, photoIds: string[]): string {
  const s = get()
  const collection = s.collections[collectionId]
  if (!collection || !photoIds.length) throw new Error('Nothing selected')
  const selected = new Set(photoIds)
  const ordered = collection.photoIds.filter((id) => selected.has(id))
  const batchIds = [
    ...new Set(ordered.map((id) => s.photos[id]?.batchId).filter((b): b is string => !!b)),
  ]
  const only = batchIds.length === 1 ? s.batches[batchIds[0] as string] : undefined
  if (
    only &&
    only.photoIds.length === ordered.length &&
    only.photoIds.every((id) => selected.has(id))
  )
    return only.id

  const sourceBatch = s.batches[s.photos[ordered[0] as string]?.batchId ?? '']
  const look: BatchLook = sourceBatch
    ? onlyPhotos(structuredClone(sourceBatch.look), selected)
    : (() => {
        const b = createBranch('Main')
        return { branches: [b], activeBranchId: b.id }
      })()
  const id = newId('b')
  const now = Date.now()
  set((st) => {
    const batches = { ...st.batches }
    const histories = { ...st.histories }
    for (const bid of batchIds) {
      const b = batches[bid]
      if (!b) continue
      const remaining = b.photoIds.filter((p) => !selected.has(p))
      if (!remaining.length) {
        delete batches[bid]
        delete histories[bid]
      } else {
        batches[bid] = { ...b, photoIds: remaining, look: withoutPhotos(b.look, selected) }
        const h = histories[bid]
        if (h) histories[bid] = { ...h, present: batches[bid].look }
      }
    }
    batches[id] = { id, collectionId, photoIds: ordered, createdAt: now, updatedAt: now, look }
    histories[id] = { ...createHistory(look), pending: null }
    const photos = { ...st.photos }
    for (const pid of ordered) {
      const p = photos[pid]
      if (p) photos[pid] = { ...p, batchId: id }
    }
    return { batches, histories, photos }
  })
  return id
}

function writeLook(
  batchId: string,
  look: BatchLook,
  mode: 'commit' | 'transient' | 'silent',
): void {
  set((s) => {
    const b = s.batches[batchId]
    const h = s.histories[batchId]
    if (!b || !h) return {}
    let history: BatchHistory
    if (mode === 'transient') history = { ...h, pending: h.pending ?? h.present, present: look }
    else if (mode === 'silent') history = { ...h, present: look }
    else {
      const past = [...h.past, h.pending ?? h.present].slice(-100)
      history = { past, present: look, future: [], pending: null }
    }
    return {
      batches: { ...s.batches, [batchId]: { ...b, look, updatedAt: Date.now() } },
      histories: { ...s.histories, [batchId]: history },
    }
  })
}

/** Applies an edit op to the active branch of a batch. */
export function dispatch(batchId: string, op: EditOp, opts: { transient?: boolean } = {}): void {
  const b = get().batches[batchId]
  if (!b) return
  const branch = activeBranch(b)
  const next = applyOp(branch, op)
  if (next === branch) return
  const look = {
    ...b.look,
    branches: b.look.branches.map((br) => (br.id === branch.id ? next : br)),
  }
  writeLook(batchId, look, opts.transient ? 'transient' : 'commit')
}

export function dispatchMany(batchId: string, ops: EditOp[]): void {
  const b = get().batches[batchId]
  if (!b || !ops.length) return
  const branch = activeBranch(b)
  const next = ops.reduce(applyOp, branch)
  writeLook(
    batchId,
    { ...b.look, branches: b.look.branches.map((br) => (br.id === branch.id ? next : br)) },
    'commit',
  )
}

/** Ends a slider drag: records one undo step for the whole gesture. */
export function commit(batchId: string): void {
  const h = get().histories[batchId]
  if (!h?.pending) return
  writeLook(batchId, h.present, 'commit')
}

export function undo(batchId: string): void {
  const h = get().histories[batchId]
  const prev = h?.past[h.past.length - 1]
  if (!h || !prev) return
  set((s) => {
    const b = s.batches[batchId]
    if (!b) return {}
    return {
      batches: { ...s.batches, [batchId]: { ...b, look: prev, updatedAt: Date.now() } },
      histories: {
        ...s.histories,
        [batchId]: {
          past: h.past.slice(0, -1),
          present: prev,
          future: [h.present, ...h.future],
          pending: null,
        },
      },
    }
  })
}

export function redo(batchId: string): void {
  const h = get().histories[batchId]
  const [next, ...future] = h?.future ?? []
  if (!h || !next) return
  set((s) => {
    const b = s.batches[batchId]
    if (!b) return {}
    return {
      batches: { ...s.batches, [batchId]: { ...b, look: next, updatedAt: Date.now() } },
      histories: {
        ...s.histories,
        [batchId]: { past: [...h.past, h.present], present: next, future, pending: null },
      },
    }
  })
}

/* Version branches */

export function addBranch(batchId: string, name: string, copyCurrent = true): void {
  const b = get().batches[batchId]
  if (!b) return
  const branch = copyCurrent ? forkBranch(activeBranch(b), name) : createBranch(name)
  writeLook(
    batchId,
    { branches: [...b.look.branches, branch], activeBranchId: branch.id },
    'commit',
  )
}

export function switchBranch(batchId: string, branchId: string): void {
  const b = get().batches[batchId]
  if (!b || b.look.activeBranchId === branchId) return
  writeLook(batchId, { ...b.look, activeBranchId: branchId }, 'commit')
}

export function renameBranch(batchId: string, branchId: string, name: string): void {
  const b = get().batches[batchId]
  if (!b) return
  writeLook(
    batchId,
    {
      ...b.look,
      branches: b.look.branches.map((br) => (br.id === branchId ? { ...br, name } : br)),
    },
    'commit',
  )
}

export function deleteBranch(batchId: string, branchId: string): void {
  const b = get().batches[batchId]
  if (!b || b.look.branches.length < 2) return
  const branches = b.look.branches.filter((br) => br.id !== branchId)
  const activeBranchId =
    b.look.activeBranchId === branchId ? (branches[0]?.id ?? '') : b.look.activeBranchId
  writeLook(batchId, { branches, activeBranchId }, 'commit')
}

/** Revert to original for every batch in a collection (undoable per batch). */
export function revertCollection(collectionId: string): void {
  for (const b of Object.values(get().batches)) {
    if (b.collectionId === collectionId) dispatch(b.id, { type: 'resetAll' })
  }
}

/* ------------------------------------------------------------------ */
/* Presets, macros, LUTs, settings                                      */
/* ------------------------------------------------------------------ */

export const BUILTIN_PRESETS = builtinPresets()

export function addPreset(preset: Preset): void {
  set((s) => ({ presets: [preset, ...s.presets.filter((p) => p.id !== preset.id)] }))
}

export function deletePreset(id: string): void {
  set((s) => ({ presets: s.presets.filter((p) => p.id !== id) }))
}

export function saveMacro(macro: Macro): void {
  set((s) => ({ macros: [macro, ...s.macros.filter((m) => m.id !== macro.id)] }))
}

export function deleteMacro(id: string): void {
  set((s) => ({ macros: s.macros.filter((m) => m.id !== id) }))
}

export async function addCustomLut(
  name: string,
  lut: Lut3D,
  source: CustomLutMeta['source'],
): Promise<string> {
  const id = `${CUSTOM_LUT_PREFIX}${newId('lut')}`
  await persistLut(id, { ...lut, title: name })
  set((s) => ({
    luts: [{ id, name, size: lut.size, createdAt: Date.now(), source }, ...s.luts],
    lutVersion: s.lutVersion + 1,
  }))
  return id
}

export async function deleteCustomLut(id: string): Promise<void> {
  unregisterLut(id)
  await blobDb.del(lutKey(id))
  set((s) => ({ luts: s.luts.filter((l) => l.id !== id), lutVersion: s.lutVersion + 1 }))
}

/** Registers LUTs embedded in a preset so its layers render. */
export async function importPresetLuts(preset: Preset): Promise<void> {
  for (const [id, embedded] of Object.entries(preset.luts ?? {})) {
    if (get().luts.some((l) => l.id === id)) continue
    const lut = decodeLut(embedded)
    if (id.startsWith(CUSTOM_LUT_PREFIX)) {
      await persistLut(id, lut)
      set((s) => ({
        luts: [
          {
            id,
            name: embedded.title ?? preset.name,
            size: lut.size,
            createdAt: Date.now(),
            source: 'preset',
          },
          ...s.luts,
        ],
        lutVersion: s.lutVersion + 1,
      }))
    } else {
      registerLut(id, lut)
    }
  }
}

export function updateSettings(patch: Partial<Settings>): void {
  set((s) => ({ settings: { ...s.settings, ...patch } }))
}

export async function resetEverything(): Promise<void> {
  await metaDb.clear()
  await blobDb.clear()
  location.reload()
}
