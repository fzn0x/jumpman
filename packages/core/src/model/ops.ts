/**
 * Every edit is a serializable operation applied by a pure reducer. This gives
 * undo/redo, copy/paste and recordable/replayable macros ("edit replay").
 */
import { deepClone } from '../util.ts'
import {
  addBasic,
  type Basic,
  type BasicKey,
  clampBasicValue,
  compactBasic,
  isBasicDefault,
} from './basic.ts'
import type { AspectId, CropPlacement } from './crop.ts'
import {
  type Branch,
  createGlobalEdit,
  isNormZero,
  type Norm,
  type PhotoOverride,
  type PhotoState,
} from './edit.ts'
import { BASE_LAYER_ID, cloneLayer, createBaseLayer, type Layer, type Mask } from './layers.ts'

export type Scope = { kind: 'global' } | { kind: 'photo'; photoId: string }

export const GLOBAL: Scope = { kind: 'global' }

export interface LayerPatch {
  name?: string
  enabled?: boolean
  opacity?: number
  /** null removes the mask. */
  mask?: Mask | null
}

export type EditOp =
  /** Sets the effective value of a basic slider (photo scope stores a delta). */
  | { type: 'setBasic'; layerId: string; key: BasicKey; value: number; scope: Scope }
  | { type: 'setLayerParams'; layerId: string; params: Layer['params']; scope: Scope }
  | { type: 'addLayer'; layer: Layer; scope: Scope; index?: number }
  | { type: 'removeLayer'; layerId: string; scope: Scope }
  | { type: 'updateLayer'; layerId: string; patch: LayerPatch; scope: Scope }
  | { type: 'moveLayer'; layerId: string; toIndex: number; scope: Scope }
  | { type: 'setAdaptive'; value: boolean }
  | { type: 'setAspect'; aspect: AspectId }
  | { type: 'setCrop'; photoId: string; placement: Partial<CropPlacement> }
  | { type: 'setNorms'; norms: Record<string, Norm | null> }
  | { type: 'setOverrides'; overrides: Record<string, PhotoOverride> }
  | { type: 'resetPhoto'; photoId: string; keepNorm?: boolean }
  | { type: 'resetAll' }
  | {
      type: 'applyLayers'
      layers: Layer[]
      mode: 'replace' | 'append'
      adaptive?: boolean
      aspect?: AspectId
    }
  | { type: 'pasteToPhotos'; photoIds: string[]; layers: Layer[] }
  | { type: 'acceptProposal'; layerId: string; scope: Scope }

function photoState(branch: Branch, photoId: string): PhotoState {
  return branch.photos[photoId] ?? { override: {} }
}

function withPhoto(branch: Branch, photoId: string, fn: (s: PhotoState) => PhotoState): Branch {
  return { ...branch, photos: { ...branch.photos, [photoId]: fn(photoState(branch, photoId)) } }
}

function withOverride(
  branch: Branch,
  photoId: string,
  fn: (o: PhotoOverride) => PhotoOverride,
): Branch {
  return withPhoto(branch, photoId, (s) => ({
    ...s,
    override: tidyOverride(fn({ ...s.override })),
  }))
}

/** Drops empty containers so overrides stay small and `hasOverride` stays honest. */
export function tidyOverride(o: PhotoOverride): PhotoOverride {
  const out: PhotoOverride = {}
  if (o.basicDeltas) {
    const deltas: Record<string, Partial<Basic>> = {}
    for (const [id, d] of Object.entries(o.basicDeltas))
      if (!isBasicDefault(d)) deltas[id] = compactBasic(d)
    if (Object.keys(deltas).length) out.basicDeltas = deltas
  }
  if (o.layerParams && Object.keys(o.layerParams).length) out.layerParams = o.layerParams
  if (o.opacity && Object.keys(o.opacity).length) out.opacity = o.opacity
  if (o.hidden?.length) out.hidden = [...new Set(o.hidden)]
  if (o.layers?.length) out.layers = o.layers
  if (o.crop && Object.keys(o.crop).length) out.crop = o.crop
  return out
}

function mapGlobalLayers(branch: Branch, fn: (layers: Layer[]) => Layer[]): Branch {
  return { ...branch, global: { ...branch.global, layers: fn(branch.global.layers) } }
}

function patchLayer<L extends Layer>(layer: L, patch: LayerPatch): L {
  const next = { ...layer }
  if (patch.name !== undefined) next.name = patch.name
  if (patch.enabled !== undefined) next.enabled = patch.enabled
  if (patch.opacity !== undefined) next.opacity = Math.min(1, Math.max(0, patch.opacity))
  if (patch.mask === null) delete next.mask
  else if (patch.mask !== undefined) next.mask = patch.mask
  return next
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const out = [...arr]
  const [item] = out.splice(from, 1)
  if (item === undefined) return arr
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item)
  return out
}

/**
 * Builds the override that makes a photo resolve to `layers` on top of the
 * global edit: matching ids become deltas/replacements, missing global layers
 * are hidden and the rest become photo-only layers.
 */
export function overrideFromLayers(globalLayers: Layer[], layers: Layer[]): PhotoOverride {
  const o: PhotoOverride = { basicDeltas: {}, layerParams: {}, opacity: {}, hidden: [], layers: [] }
  const byId = new Map(layers.map((l) => [l.id, l]))
  for (const g of globalLayers) {
    const l = byId.get(g.id)
    if (!l || l.kind !== g.kind || !l.enabled) {
      o.hidden?.push(g.id)
      continue
    }
    byId.delete(g.id)
    if (l.opacity !== g.opacity && o.opacity) o.opacity[g.id] = l.opacity
    if (l.kind === 'basic' && g.kind === 'basic') {
      const d: Partial<Basic> = {}
      for (const [k, v] of Object.entries(l.params) as [BasicKey, number][]) {
        const diff = v - g.params[k]
        if (Math.abs(diff) > 1e-9) d[k] = diff
      }
      if (o.basicDeltas) o.basicDeltas[g.id] = d
    } else if (JSON.stringify(l.params) !== JSON.stringify(g.params) && o.layerParams) {
      o.layerParams[g.id] = deepClone(l.params)
    }
  }
  o.layers = [...byId.values()].filter((l) => l.enabled).map((l) => cloneLayer(l))
  return tidyOverride(o)
}

export function applyOp(branch: Branch, op: EditOp): Branch {
  switch (op.type) {
    case 'setBasic': {
      const value = clampBasicValue(op.key, op.value)
      if (op.scope.kind === 'global') {
        return mapGlobalLayers(branch, (ls) =>
          ls.map((l) =>
            l.id === op.layerId && l.kind === 'basic'
              ? { ...l, params: { ...l.params, [op.key]: value } }
              : l,
          ),
        )
      }
      const { photoId } = op.scope
      const own = photoState(branch, photoId).override.layers?.find((l) => l.id === op.layerId)
      if (own) {
        return withOverride(branch, photoId, (o) => ({
          ...o,
          layers: o.layers?.map((l) =>
            l.id === op.layerId && l.kind === 'basic'
              ? { ...l, params: { ...l.params, [op.key]: value } }
              : l,
          ),
        }))
      }
      const g = branch.global.layers.find((l) => l.id === op.layerId)
      if (g?.kind !== 'basic') return branch
      return withOverride(branch, photoId, (o) => ({
        ...o,
        basicDeltas: {
          ...o.basicDeltas,
          [op.layerId]: { ...o.basicDeltas?.[op.layerId], [op.key]: value - g.params[op.key] },
        },
      }))
    }
    case 'setLayerParams': {
      if (op.scope.kind === 'global') {
        return mapGlobalLayers(branch, (ls) =>
          ls.map((l) =>
            l.id === op.layerId ? ({ ...l, params: deepClone(op.params) } as Layer) : l,
          ),
        )
      }
      const own = photoState(branch, op.scope.photoId).override.layers?.some(
        (l) => l.id === op.layerId,
      )
      return withOverride(branch, op.scope.photoId, (o) =>
        own
          ? {
              ...o,
              layers: o.layers?.map((l) =>
                l.id === op.layerId ? ({ ...l, params: deepClone(op.params) } as Layer) : l,
              ),
            }
          : { ...o, layerParams: { ...o.layerParams, [op.layerId]: deepClone(op.params) } },
      )
    }
    case 'addLayer': {
      const insert = (ls: Layer[]) => {
        const out = [...ls]
        out.splice(op.index ?? out.length, 0, cloneLayer(op.layer))
        return out
      }
      if (op.scope.kind === 'global') return mapGlobalLayers(branch, insert)
      return withOverride(branch, op.scope.photoId, (o) => ({
        ...o,
        layers: insert(o.layers ?? []),
      }))
    }
    case 'removeLayer': {
      if (op.scope.kind === 'global') {
        const photos: Record<string, PhotoState> = {}
        for (const [id, s] of Object.entries(branch.photos)) {
          const o = { ...s.override }
          if (o.basicDeltas?.[op.layerId]) o.basicDeltas = { ...o.basicDeltas, [op.layerId]: {} }
          if (o.layerParams?.[op.layerId]) {
            const { [op.layerId]: _, ...rest } = o.layerParams
            o.layerParams = rest
          }
          if (o.opacity?.[op.layerId] !== undefined) {
            const { [op.layerId]: _, ...rest } = o.opacity
            o.opacity = rest
          }
          o.hidden = o.hidden?.filter((h) => h !== op.layerId)
          photos[id] = { ...s, override: tidyOverride(o) }
        }
        return { ...mapGlobalLayers(branch, (ls) => ls.filter((l) => l.id !== op.layerId)), photos }
      }
      const { photoId } = op.scope
      const own = photoState(branch, photoId).override.layers?.some((l) => l.id === op.layerId)
      return withOverride(branch, photoId, (o) =>
        own
          ? { ...o, layers: o.layers?.filter((l) => l.id !== op.layerId) }
          : { ...o, hidden: [...(o.hidden ?? []), op.layerId] },
      )
    }
    case 'updateLayer': {
      if (op.scope.kind === 'global') {
        return mapGlobalLayers(branch, (ls) =>
          ls.map((l) => (l.id === op.layerId ? patchLayer(l, op.patch) : l)),
        )
      }
      const { photoId } = op.scope
      const own = photoState(branch, photoId).override.layers?.some((l) => l.id === op.layerId)
      if (own) {
        return withOverride(branch, photoId, (o) => ({
          ...o,
          layers: o.layers?.map((l) => (l.id === op.layerId ? patchLayer(l, op.patch) : l)),
        }))
      }
      return withOverride(branch, photoId, (o) => {
        const next = { ...o }
        if (op.patch.enabled === false) next.hidden = [...(o.hidden ?? []), op.layerId]
        if (op.patch.enabled === true) next.hidden = o.hidden?.filter((h) => h !== op.layerId)
        if (op.patch.opacity !== undefined)
          next.opacity = { ...o.opacity, [op.layerId]: op.patch.opacity }
        return next
      })
    }
    case 'moveLayer': {
      if (op.scope.kind === 'global') {
        return mapGlobalLayers(branch, (ls) => {
          const from = ls.findIndex((l) => l.id === op.layerId)
          return from < 0 ? ls : moveItem(ls, from, op.toIndex)
        })
      }
      return withOverride(branch, op.scope.photoId, (o) => {
        const ls = o.layers ?? []
        const from = ls.findIndex((l) => l.id === op.layerId)
        return from < 0 ? o : { ...o, layers: moveItem(ls, from, op.toIndex) }
      })
    }
    case 'setAdaptive':
      return { ...branch, global: { ...branch.global, adaptive: op.value } }
    case 'setAspect':
      return { ...branch, global: { ...branch.global, aspect: op.aspect } }
    case 'setCrop':
      return withOverride(branch, op.photoId, (o) => ({
        ...o,
        crop: { ...o.crop, ...op.placement },
      }))
    case 'setNorms': {
      let next = branch
      for (const [photoId, norm] of Object.entries(op.norms)) {
        next = withPhoto(next, photoId, (s) => {
          const { norm: _, ...rest } = s
          return norm && !isNormZero(norm) ? { ...rest, norm } : rest
        })
      }
      return next
    }
    case 'setOverrides': {
      let next = branch
      for (const [photoId, override] of Object.entries(op.overrides)) {
        next = withPhoto(next, photoId, (s) => ({
          ...s,
          override: tidyOverride(deepClone(override)),
        }))
      }
      return next
    }
    case 'resetPhoto':
      return withPhoto(branch, op.photoId, (s) =>
        op.keepNorm && s.norm ? { override: {}, norm: s.norm } : { override: {} },
      )
    case 'resetAll': {
      const photos: Record<string, PhotoState> = {}
      for (const id of Object.keys(branch.photos)) photos[id] = { override: {} }
      return { ...branch, global: createGlobalEdit(), photos }
    }
    case 'applyLayers': {
      const fresh = op.layers.map((l) => cloneLayer(l, l.id !== BASE_LAYER_ID))
      let layers: Layer[]
      if (op.mode === 'replace') {
        layers = fresh.some((l) => l.id === BASE_LAYER_ID) ? fresh : [createBaseLayer(), ...fresh]
      } else {
        const incomingBase = fresh.find((l) => l.id === BASE_LAYER_ID)
        layers = branch.global.layers.map((l) =>
          l.id === BASE_LAYER_ID && l.kind === 'basic' && incomingBase?.kind === 'basic'
            ? { ...l, params: addBasic(l.params, incomingBase.params) }
            : l,
        )
        layers.push(
          ...fresh.filter(
            (l) => l.id !== BASE_LAYER_ID || !layers.some((x) => x.id === BASE_LAYER_ID),
          ),
        )
      }
      return {
        ...branch,
        global: {
          layers,
          adaptive: op.adaptive ?? branch.global.adaptive,
          aspect: op.aspect ?? branch.global.aspect,
        },
      }
    }
    case 'pasteToPhotos': {
      let next = branch
      for (const photoId of op.photoIds) {
        const crop = photoState(next, photoId).override.crop
        const o = overrideFromLayers(next.global.layers, op.layers)
        next = withPhoto(next, photoId, (s) => ({
          ...s,
          override: tidyOverride({ ...o, ...(crop ? { crop } : {}) }),
        }))
      }
      return next
    }
    case 'acceptProposal': {
      const accept = (ls: Layer[]) =>
        ls.map((l) => {
          if (l.id !== op.layerId) return l
          const { proposedBy: _, ...rest } = l
          return rest as Layer
        })
      if (op.scope.kind === 'global') return mapGlobalLayers(branch, accept)
      return withOverride(branch, op.scope.photoId, (o) => ({
        ...o,
        layers: accept(o.layers ?? []),
      }))
    }
  }
}

export function applyOps(branch: Branch, ops: EditOp[]): Branch {
  return ops.reduce(applyOp, branch)
}

/** Analysis-driven steps a macro can replay with the new batch's stats. */
export const MACRO_TOOLS = ['autoMatch', 'harmonize', 'sceneAuto', 'deflicker'] as const
export type MacroTool = (typeof MACRO_TOOLS)[number]

export type MacroStep = { kind: 'op'; op: EditOp } | { kind: 'tool'; tool: MacroTool }

export interface Macro {
  id: string
  name: string
  createdAt: number
  steps: MacroStep[]
}

/** True for ops that make sense on another batch (no photo-specific state). */
export function isReplayable(op: EditOp): boolean {
  if ('scope' in op && op.scope.kind === 'photo') return false
  return !['setCrop', 'setNorms', 'setOverrides', 'resetPhoto', 'pasteToPhotos'].includes(op.type)
}

/** Appends a step, merging consecutive slider moves on the same control. */
export function recordStep(steps: MacroStep[], step: MacroStep): MacroStep[] {
  if (step.kind === 'op' && !isReplayable(step.op)) return steps
  const last = steps[steps.length - 1]
  if (
    last?.kind === 'op' &&
    step.kind === 'op' &&
    last.op.type === 'setBasic' &&
    step.op.type === 'setBasic' &&
    last.op.layerId === step.op.layerId &&
    last.op.key === step.op.key
  ) {
    return [...steps.slice(0, -1), step]
  }
  if (
    last?.kind === 'op' &&
    step.kind === 'op' &&
    last.op.type === 'setLayerParams' &&
    step.op.type === 'setLayerParams' &&
    last.op.layerId === step.op.layerId
  ) {
    return [...steps.slice(0, -1), step]
  }
  return [...steps, step]
}

/** Human-readable label of a macro step. */
export function describeStep(step: MacroStep): string {
  if (step.kind === 'tool') {
    return {
      autoMatch: 'Auto-match',
      harmonize: 'Harmonize',
      sceneAuto: 'Scene auto edit',
      deflicker: 'Deflicker',
    }[step.tool]
  }
  const op = step.op
  switch (op.type) {
    case 'setBasic':
      return `Set ${op.key} to ${op.value}`
    case 'setLayerParams':
      return 'Adjust layer'
    case 'addLayer':
      return `Add ${op.layer.name}`
    case 'removeLayer':
      return 'Remove layer'
    case 'updateLayer':
      return 'Update layer'
    case 'moveLayer':
      return 'Reorder layers'
    case 'setAdaptive':
      return op.value ? 'Adaptive mode on' : 'Adaptive mode off'
    case 'setAspect':
      return `Crop to ${op.aspect}`
    case 'applyLayers':
      return op.mode === 'replace' ? 'Apply look' : 'Add look'
    case 'resetAll':
      return 'Revert to original'
    default:
      return op.type
  }
}
