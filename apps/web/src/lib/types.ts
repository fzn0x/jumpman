import type { Branch, History, Macro, PhotoStats, Preset, Review } from '@jumpman/core'

export interface Photo {
  id: string
  /** Original file name. */
  name: string
  type: string
  size: number
  /** Dimensions of the full-resolution source, after orientation. */
  width: number
  height: number
  /** Capture time from EXIF, falling back to the file date. */
  takenAt?: number
  addedAt: number
  /** Set when the photo came from a camera RAW file (we edit its embedded preview). */
  raw?: { format: string; orientation: number }
  stats?: PhotoStats
  collectionId: string
  /** The batch whose edit this photo currently shows. */
  batchId?: string
}

export interface Collection {
  id: string
  name: string
  photoIds: string[]
  createdAt: number
  updatedAt: number
  review?: Review
}

export interface BatchLook {
  branches: Branch[]
  activeBranchId: string
}

export interface Batch {
  id: string
  collectionId: string
  photoIds: string[]
  createdAt: number
  updatedAt: number
  look: BatchLook
}

export interface BatchHistory extends History<BatchLook> {
  /** State before an in-progress slider drag, committed on release. */
  pending?: BatchLook | null
}

export interface CustomLutMeta {
  id: string
  name: string
  size: number
  createdAt: number
  source: 'cube' | 'sample' | 'preset' | 'look'
}

export interface Settings {
  author: string
  exportFormat: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'
  exportQuality: number
  exportMaxEdge: number
  exportPattern: string
  watermark: string
  watermarkPosition: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'center'
  watermarkOpacity: number
  includeXmp: boolean
  onboarded: boolean
}

export type { Macro, Preset }
