import { deepClone } from '../util.ts'
import { addBasic, type Basic, compactBasic, defaultBasic, isBasicDefault } from './basic.ts'
import type { AspectId, CropPlacement } from './crop.ts'
import { createBaseLayer, createLayer, isLayerNoop, type Layer, newId } from './layers.ts'

/**
 * Automatic per-photo corrections produced by analysis tools
 * (auto-match, reference-match, harmonize, deflicker, adaptive mode).
 * Values use Basic slider units.
 */
export interface Norm {
  exposure: number
  temperature: number
  tint: number
  contrast: number
  saturation: number
}

export const NORM_KEYS = ['exposure', 'temperature', 'tint', 'contrast', 'saturation'] as const

export function zeroNorm(): Norm {
  return { exposure: 0, temperature: 0, tint: 0, contrast: 0, saturation: 0 }
}

export function addNorm(a: Partial<Norm> | undefined, b: Partial<Norm> | undefined): Norm {
  const out = zeroNorm()
  for (const k of NORM_KEYS) out[k] = (a?.[k] ?? 0) + (b?.[k] ?? 0)
  return out
}

export function isNormZero(n: Partial<Norm> | undefined): boolean {
  return !n || NORM_KEYS.every((k) => Math.abs(n[k] ?? 0) < 1e-4)
}

/** Manual per-photo deviations from the global edit ("Individual" mode). */
export interface PhotoOverride {
  /** Additive offsets for global basic layers, keyed by layer id. */
  basicDeltas?: Record<string, Partial<Basic>>
  /** Replacement params for global non-basic layers, keyed by layer id. */
  layerParams?: Record<string, Layer['params']>
  /** Opacity overrides for global layers. */
  opacity?: Record<string, number>
  /** Global layers switched off for this photo. */
  hidden?: string[]
  /** Layers that exist only on this photo, stacked above the global ones. */
  layers?: Layer[]
  /** Reposition of the shared crop for this photo. */
  crop?: Partial<CropPlacement>
}

export interface PhotoState {
  override: PhotoOverride
  norm?: Norm
}

export interface GlobalEdit {
  layers: Layer[]
  /** Adaptive mode: exposure and white balance act as targets, not offsets. */
  adaptive: boolean
  aspect: AspectId
}

/** One alternate look for a batch (e.g. "warm" vs "moody"). */
export interface Branch {
  id: string
  name: string
  createdAt: number
  global: GlobalEdit
  photos: Record<string, PhotoState>
}

export function createGlobalEdit(init: Partial<GlobalEdit> = {}): GlobalEdit {
  return {
    layers: init.layers ?? [createBaseLayer()],
    adaptive: init.adaptive ?? false,
    aspect: init.aspect ?? 'original',
  }
}

export function createBranch(name = 'Main', global?: GlobalEdit): Branch {
  return {
    id: newId('b'),
    name,
    createdAt: Date.now(),
    global: global ?? createGlobalEdit(),
    photos: {},
  }
}

export function forkBranch(source: Branch, name: string): Branch {
  return { ...deepClone(source), id: newId('b'), name, createdAt: Date.now() }
}

export function hasOverride(state: PhotoState | undefined): boolean {
  const o = state?.override
  if (!o) return false
  if (o.basicDeltas && Object.values(o.basicDeltas).some((d) => !isBasicDefault(d))) return true
  if (o.layerParams && Object.keys(o.layerParams).length) return true
  if (o.opacity && Object.keys(o.opacity).length) return true
  if (o.hidden?.length) return true
  if (o.layers?.length) return true
  if (o.crop && Object.keys(o.crop).length) return true
  return false
}

/** Lists the human-readable areas where a photo deviates from the global edit. */
export function describeOverride(state: PhotoState | undefined): string[] {
  const o = state?.override
  const out: string[] = []
  if (!o) return out
  const deltaKeys = new Set<string>()
  for (const d of Object.values(o.basicDeltas ?? {})) {
    for (const [k, v] of Object.entries(compactBasic(d))) if (v) deltaKeys.add(k)
  }
  out.push(...deltaKeys)
  if (o.layerParams && Object.keys(o.layerParams).length) out.push('layer settings')
  if (o.opacity && Object.keys(o.opacity).length) out.push('layer opacity')
  if (o.hidden?.length) out.push('hidden layers')
  if (o.layers?.length) out.push(`${o.layers.length} own layer${o.layers.length > 1 ? 's' : ''}`)
  if (o.crop && Object.keys(o.crop).length) out.push('crop')
  return out
}

export const NORM_LAYER_ID = '__norm'

export function normLayer(norm: Norm): Layer {
  return createLayer('basic', {
    id: NORM_LAYER_ID,
    name: 'Auto match',
    params: { ...defaultBasic(), ...norm },
  })
}

/**
 * Produces the concrete layer stack for one photo: auto corrections first,
 * then global layers with this photo's overrides, then its own layers.
 * No-op layers are dropped.
 */
export function resolveLayers(
  global: GlobalEdit,
  state: PhotoState | undefined,
  extraNorm?: Partial<Norm>,
): Layer[] {
  const o = state?.override ?? {}
  const out: Layer[] = []
  const norm = addNorm(state?.norm, extraNorm)
  if (!isNormZero(norm)) out.push(normLayer(norm))
  const hidden = new Set(o.hidden ?? [])
  for (const layer of global.layers) {
    if (hidden.has(layer.id) || layer.proposedBy) continue
    let resolved: Layer = layer
    const opacity = o.opacity?.[layer.id]
    if (opacity !== undefined) resolved = { ...resolved, opacity } as Layer
    if (resolved.kind === 'basic') {
      const delta = o.basicDeltas?.[layer.id]
      if (delta) resolved = { ...resolved, params: addBasic(resolved.params, delta) }
    } else {
      const params = o.layerParams?.[layer.id]
      if (params) resolved = { ...resolved, params } as Layer
    }
    out.push(resolved)
  }
  for (const layer of o.layers ?? []) if (!layer.proposedBy) out.push(layer)
  return out.filter((l) => !isLayerNoop(l))
}

/** The effective Basic values a photo sees on a given global basic layer. */
export function effectiveBasic(
  global: GlobalEdit,
  state: PhotoState | undefined,
  layerId: string,
): Basic {
  const layer = global.layers.find((l) => l.id === layerId)
  if (layer?.kind !== 'basic') return defaultBasic()
  return addBasic(layer.params, state?.override.basicDeltas?.[layerId])
}
