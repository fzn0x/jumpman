import {
  autoMatch,
  deflicker,
  type EditOp,
  harmonize,
  type MacroTool,
  type MatchItem,
  type Norm,
  referenceMatch,
  sceneAutoLayers,
} from '@jumpman/core'
import type { Batch, Photo } from '../lib/types.ts'
import { activeBranch, dispatchMany, useLibrary } from '../state/library.ts'

type Item = MatchItem & { id: string }

function items(batch: Batch, photos: Record<string, Photo>, withNorm: boolean): Item[] {
  const branch = activeBranch(batch)
  return batch.photoIds.flatMap((id) => {
    const p = photos[id]
    if (!p?.stats) return []
    const s = branch.photos[id]
    return [
      {
        id,
        stats: p.stats,
        ...(withNorm && s?.norm ? { norm: s.norm } : {}),
        delta: s?.override.basicDeltas?.base ?? {},
      },
    ]
  })
}

function normsOp(list: Item[], norms: Norm[]): EditOp {
  return {
    type: 'setNorms',
    norms: Object.fromEntries(list.map((it, i) => [it.id, norms[i] ?? null])),
  }
}

export interface ToolOptions {
  exposure?: boolean
  whiteBalance?: boolean
  heroId?: string
  radius?: number
}

/** Ops for an analysis tool, computed from the batch's current stats. */
export function toolOps(
  batch: Batch,
  tool: MacroTool | 'referenceMatch' | 'clearNorms',
  opts: ToolOptions = {},
): EditOp[] {
  const photos = useLibrary.getState().photos
  switch (tool) {
    case 'autoMatch': {
      const list = items(batch, photos, false)
      return [
        normsOp(
          list,
          autoMatch(list, {
            exposure: opts.exposure ?? true,
            whiteBalance: opts.whiteBalance ?? true,
          }),
        ),
      ]
    }
    case 'harmonize': {
      const list = items(batch, photos, false)
      return [normsOp(list, harmonize(list))]
    }
    case 'referenceMatch': {
      const list = items(batch, photos, false)
      const hero = list.find((it) => it.id === opts.heroId) ?? list[0]
      if (!hero) return []
      return [normsOp(list, referenceMatch(hero, list))]
    }
    case 'sceneAuto': {
      const stats = batch.photoIds.flatMap((id) => (photos[id]?.stats ? [photos[id].stats] : []))
      const layers = sceneAutoLayers(stats)
      return layers.length ? [{ type: 'applyLayers', layers, mode: 'append' }] : []
    }
    case 'deflicker': {
      const ordered = items(batch, photos, true).sort(
        (a, b) => (photos[a.id]?.takenAt ?? 0) - (photos[b.id]?.takenAt ?? 0),
      )
      const offsets = deflicker(
        ordered.map((it) => it.stats),
        opts.radius ?? 3,
      )
      const norms: Record<string, Norm> = {}
      ordered.forEach((it, i) => {
        const base = {
          exposure: 0,
          temperature: 0,
          tint: 0,
          contrast: 0,
          saturation: 0,
          ...it.norm,
        }
        norms[it.id] = {
          ...base,
          exposure: Math.round((base.exposure + (offsets[i] ?? 0)) * 100) / 100,
        }
      })
      return [{ type: 'setNorms', norms }]
    }
    case 'clearNorms':
      return [
        { type: 'setNorms', norms: Object.fromEntries(batch.photoIds.map((id) => [id, null])) },
      ]
  }
}

export function runTool(
  batchId: string,
  tool: Parameters<typeof toolOps>[1],
  opts?: ToolOptions,
): number {
  const batch = useLibrary.getState().batches[batchId]
  if (!batch) return 0
  const ops = toolOps(batch, tool, opts)
  dispatchMany(batchId, ops)
  return ops.length
}
