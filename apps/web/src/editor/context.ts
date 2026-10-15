import {
  BASE_LAYER_ID,
  type BasicKey,
  type Branch,
  createLayer,
  defaultBasic,
  type EditOp,
  effectiveBasic,
  GLOBAL,
  type Layer,
  type LayerKind,
  type LayerOf,
  type PhotoState,
  type Scope,
} from '@jumpman/core'
import type { Batch, Photo } from '../lib/types.ts'
import { editor, useEditor } from '../state/editor.ts'
import { activeBranch, commit, dispatch, useLibrary } from '../state/library.ts'

export interface BatchContext {
  batch: Batch
  branch: Branch
  photos: Photo[]
  index: number
  current: Photo | undefined
  state: PhotoState | undefined
  mode: 'global' | 'individual'
  scope: Scope
}

export function useBatchContext(batchId: string): BatchContext | null {
  const batch = useLibrary((s) => s.batches[batchId])
  const photosById = useLibrary((s) => s.photos)
  const rawIndex = useEditor((s) => s.index)
  const mode = useEditor((s) => s.mode)
  if (!batch) return null
  const branch = activeBranch(batch)
  const photos = batch.photoIds.map((id) => photosById[id]).filter((p): p is Photo => !!p)
  const index = Math.min(Math.max(0, rawIndex), Math.max(0, photos.length - 1))
  const current = photos[index]
  const scope: Scope =
    mode === 'individual' && current ? { kind: 'photo', photoId: current.id } : GLOBAL
  return {
    batch,
    branch,
    photos,
    index,
    current,
    state: current ? branch.photos[current.id] : undefined,
    mode,
    scope,
  }
}

/** Runs an op on the batch and records it into an active macro. */
export function run(ctx: BatchContext, op: EditOp, transient = false): void {
  dispatch(ctx.batch.id, op, { transient })
  editor.record({ kind: 'op', op })
}

export function finish(ctx: BatchContext): void {
  commit(ctx.batch.id)
}

/** A layer by id, from the global stack or the current photo's own layers. */
export function findLayer(ctx: BatchContext, id: string): { layer: Layer; own: boolean } | null {
  const g = ctx.branch.global.layers.find((l) => l.id === id)
  if (g) return { layer: g, own: false }
  const o = ctx.state?.override.layers?.find((l) => l.id === id)
  return o ? { layer: o, own: true } : null
}

/** Value a slider should show for the current scope. */
export function basicValue(ctx: BatchContext, layerId: string, key: BasicKey): number {
  const found = findLayer(ctx, layerId)
  if (found?.layer.kind !== 'basic') return 0
  if (found.own || ctx.mode === 'global') return found.layer.params[key]
  return effectiveBasic(ctx.branch.global, ctx.state, layerId)[key]
}

/** Params a non-basic layer has for the current scope (individual overrides included). */
export function paramsOf<K extends LayerKind>(
  ctx: BatchContext,
  layer: LayerOf<K>,
): LayerOf<K>['params'] {
  if (ctx.mode === 'individual') {
    const o = ctx.state?.override.layerParams?.[layer.id]
    if (o) return o as LayerOf<K>['params']
  }
  return layer.params as LayerOf<K>['params']
}

/** Layers listed for the current scope: global ones, then this photo's own ones. */
export function scopeLayers(ctx: BatchContext): { layer: Layer; own: boolean; hidden: boolean }[] {
  const hidden = new Set(ctx.mode === 'individual' ? (ctx.state?.override.hidden ?? []) : [])
  const out = ctx.branch.global.layers.map((layer) => ({
    layer,
    own: false,
    hidden: hidden.has(layer.id),
  }))
  if (ctx.mode === 'individual') {
    for (const layer of ctx.state?.override.layers ?? [])
      out.push({ layer, own: true, hidden: false })
  }
  return out
}

/** The layer the color tools should edit, if one exists. */
export function targetLayer<K extends LayerKind>(ctx: BatchContext, kind: K): LayerOf<K> | null {
  const selected = findLayer(ctx, useEditor.getState().layerId)
  if (selected?.layer.kind === kind) return selected.layer as LayerOf<K>
  const candidates = scopeLayers(ctx).filter((l) => l.layer.kind === kind && !l.layer.proposedBy)
  // Prefer the photo's own layer in individual mode.
  const pick =
    ctx.mode === 'individual' ? (candidates.find((c) => c.own) ?? candidates[0]) : candidates[0]
  return (pick?.layer as LayerOf<K> | undefined) ?? null
}

/** Returns the target layer of a kind, creating it in the current scope if missing. */
export function ensureLayer<K extends LayerKind>(
  ctx: BatchContext,
  kind: K,
  init?: Partial<LayerOf<K>>,
): LayerOf<K> {
  const existing = targetLayer(ctx, kind)
  if (existing) return existing
  const layer = createLayer(kind, init as Parameters<typeof createLayer<K>>[1])
  run(ctx, { type: 'addLayer', layer, scope: ctx.scope })
  return layer
}

export function baseLayerExists(ctx: BatchContext): boolean {
  return ctx.branch.global.layers.some((l) => l.id === BASE_LAYER_ID)
}

/** Basic values for the summary bar of the selected (or base) layer. */
export function summaryValues(ctx: BatchContext, layerId: string) {
  const found = findLayer(ctx, layerId)
  if (found?.layer.kind !== 'basic') return defaultBasic()
  if (found.own || ctx.mode === 'global') return found.layer.params
  return effectiveBasic(ctx.branch.global, ctx.state, layerId)
}
