import {
  BUILTIN_LUT_PREFIX,
  bakeLut,
  batchLabStats,
  colorTransferLut,
  createBaseLayer,
  createLayer,
  createPreset,
  encodeLut,
  type Layer,
  labStatsOf,
  type Preset,
  parseCostyle,
  parseCube,
  parsePreset,
  parseXmp,
  presetLayers,
  presetToShareString,
  serializeCube,
  slugify,
  stripExtension,
  xmpToLayers,
} from '@jumpman/core'
import { analyzeFile } from '../lib/importer.ts'
import { CUSTOM_LUT_PREFIX, resolveLut } from '../lib/luts.ts'
import { appUrl, copyText, saveFile } from '../lib/platform.ts'
import type { Photo } from '../lib/types.ts'
import { editor, toast } from '../state/editor.ts'
import {
  addCustomLut,
  addPreset,
  dispatch,
  importPresetLuts,
  undo,
  useLibrary,
} from '../state/library.ts'
import { type BatchContext, run } from './context.ts'

/** Applies a preset to the whole batch (replacing the global look), with undo. */
export async function applyPreset(
  batchId: string,
  preset: Preset,
  mode: 'replace' | 'append' = 'replace',
): Promise<void> {
  await importPresetLuts(preset)
  const op = {
    type: 'applyLayers' as const,
    layers: presetLayers(preset),
    mode,
    ...(preset.adaptive !== undefined ? { adaptive: preset.adaptive } : {}),
    ...(preset.aspect ? { aspect: preset.aspect } : {}),
  }
  dispatch(batchId, op)
  editor.record({ kind: 'op', op })
  toast(`Applied “${preset.name}”`, { label: 'Undo', run: () => undo(batchId) })
}

/** Builds a preset from the batch's global edit, embedding any custom LUTs it uses. */
export function presetFromBatch(ctx: BatchContext, name: string, description?: string): Preset {
  const { settings } = useLibrary.getState()
  const luts: NonNullable<Preset['luts']> = {}
  for (const l of ctx.branch.global.layers) {
    if (l.kind === 'lut' && l.params.lutId.startsWith(CUSTOM_LUT_PREFIX)) {
      const lut = resolveLut(l.params.lutId)
      if (lut) luts[l.params.lutId] = encodeLut(lut)
    }
  }
  return createPreset(name, ctx.branch.global, {
    ...(settings.author ? { author: settings.author } : {}),
    ...(description ? { description } : {}),
    ...(Object.keys(luts).length ? { luts } : {}),
  })
}

export function savePresetFromBatch(ctx: BatchContext, name: string): Preset {
  const preset = presetFromBatch(ctx, name)
  addPreset(preset)
  toast(`Saved preset “${name}”`)
  return preset
}

export function presetLink(preset: Preset): string {
  return `${appUrl()}#preset=${presetToShareString(preset)}`
}

export async function sharePresetLink(preset: Preset): Promise<void> {
  const url = presetLink(preset)
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: `${preset.name} · Jumpman preset`, url })
      return
    } catch {
      // fall through to copying
    }
  }
  toast((await copyText(url)) ? 'Preset link copied' : url)
}

export async function exportPresetFile(preset: Preset): Promise<void> {
  const blob = new Blob([`${JSON.stringify(preset, null, 2)}\n`], { type: 'application/json' })
  toast(await saveFile(`${slugify(preset.name) || 'preset'}.jumpman-preset.json`, blob))
}

/** Adds (or swaps) a LUT layer for the current scope. */
export function applyLutLayer(ctx: BatchContext, lutId: string, name: string, stack = false): void {
  const selected = selectedLayerOf(ctx)
  const existing = selected?.kind === 'lut' ? selected : stack ? null : findLut(ctx)
  if (existing) {
    const own = ctx.state?.override.layers?.some((l) => l.id === existing.id)
    const scope =
      own && ctx.current ? ({ kind: 'photo', photoId: ctx.current.id } as const) : ctx.scope
    run(ctx, { type: 'setLayerParams', layerId: existing.id, params: { lutId }, scope })
    run(ctx, { type: 'updateLayer', layerId: existing.id, patch: { name }, scope })
    return
  }
  const layer = createLayer('lut', { name, params: { lutId } })
  run(ctx, { type: 'addLayer', layer, scope: ctx.scope })
  editor.set({ layerId: layer.id })
}

function selectedLayerOf(ctx: BatchContext): Layer | undefined {
  const id = editor.get().layerId
  return (
    ctx.branch.global.layers.find((l) => l.id === id) ??
    ctx.state?.override.layers?.find((l) => l.id === id)
  )
}

export function findLut(ctx: BatchContext): Layer | undefined {
  if (ctx.mode === 'individual') {
    const own = ctx.state?.override.layers?.find((l) => l.kind === 'lut' && !l.proposedBy)
    if (own) return own
  }
  return ctx.branch.global.layers.find((l) => l.kind === 'lut' && !l.proposedBy)
}

/** Imports a .cube, Lightroom .xmp, Capture One .costyle/.copreset or Jumpman preset file. */
export async function importLookFile(ctx: BatchContext, file: File): Promise<void> {
  const ext = file.name.toLowerCase().split('.').pop() ?? ''
  const text = await file.text()
  const name = stripExtension(file.name).replace(/\.jumpman-preset$/, '')
  if (ext === 'cube') {
    const lut = parseCube(text)
    const id = await addCustomLut(lut.title || name, lut, 'cube')
    applyLutLayer(ctx, id, lut.title || name, true)
    toast(`Imported LUT “${lut.title || name}”`)
    return
  }
  if (ext === 'xmp') {
    const imp = parseXmp(text)
    const layers = xmpToLayers(imp)
    const match = ctx.photos.find(
      (p) => stripExtension(p.name).toLowerCase() === name.toLowerCase(),
    )
    if (match) {
      run(ctx, { type: 'pasteToPhotos', photoIds: [match.id], layers })
      toast(
        `Applied XMP to ${match.name}${imp.warnings.length ? ` (${imp.warnings.length} settings approximated)` : ''}`,
      )
    } else {
      run(ctx, { type: 'applyLayers', layers, mode: 'replace' })
      toast(
        `Applied XMP to the batch${imp.warnings.length ? ` (${imp.warnings.length} settings approximated)` : ''}`,
      )
    }
    return
  }
  if (ext === 'costyle' || ext === 'copreset') {
    const imp = parseCostyle(text)
    run(ctx, { type: 'applyLayers', layers: [createBaseLayer(imp.basic)], mode: 'append' })
    toast(
      `Applied Capture One style${imp.warnings.length ? ` (${imp.warnings.length} settings skipped)` : ''}`,
    )
    return
  }
  if (ext === 'json') {
    const preset = parsePreset(text)
    addPreset(preset)
    await applyPreset(ctx.batch.id, preset)
    return
  }
  throw new Error(`Unsupported file: ${file.name}`)
}

/** Imports many Lightroom sidecars at once, matching them to photos by file name. */
export async function importXmpSidecars(ctx: BatchContext, files: File[]): Promise<number> {
  const byName = new Map(ctx.photos.map((p) => [stripExtension(p.name).toLowerCase(), p]))
  const overrides: Record<string, Layer[]> = {}
  for (const f of files) {
    const p = byName.get(stripExtension(f.name).toLowerCase())
    if (p) overrides[p.id] = xmpToLayers(parseXmp(await f.text()))
  }
  for (const [photoId, layers] of Object.entries(overrides)) {
    run(ctx, { type: 'pasteToPhotos', photoIds: [photoId], layers })
  }
  return Object.keys(overrides).length
}

/** "Edit from a sample image": derive a LUT that approximates the sample's look. */
export async function lookFromSample(
  ctx: BatchContext,
  file: File,
  strength = 0.85,
): Promise<void> {
  const sample = await analyzeFile(file)
  const stats = ctx.photos.map((p) => p.stats).filter((s): s is NonNullable<Photo['stats']> => !!s)
  if (!stats.length) throw new Error('Photos are still being analyzed')
  const title = `Look of ${stripExtension(file.name)}`.slice(0, 60)
  const lut = colorTransferLut(batchLabStats(stats), labStatsOf(sample), { strength, title })
  const id = await addCustomLut(title, lut, 'sample')
  applyLutLayer(ctx, id, title, true)
  toast(`Created “${title}”`)
}

/** Bakes the batch's global look into a .cube file for other apps. */
export async function exportLookAsCube(ctx: BatchContext, name: string): Promise<void> {
  const lut = bakeLut(ctx.branch.global.layers, resolveLut, 33, name)
  const blob = new Blob([serializeCube(lut, name)], { type: 'text/plain' })
  toast(await saveFile(`${slugify(name) || 'jumpman-look'}.cube`, blob))
}

export function isBuiltinLut(id: string): boolean {
  return id.startsWith(BUILTIN_LUT_PREFIX)
}
