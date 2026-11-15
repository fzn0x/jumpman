import {
  BASE_LAYER_ID,
  type BasicKey,
  type HueBand,
  type Layer,
  type MacroStep,
  recordStep,
} from '@jumpman/core'
import { create } from 'zustand'

export type EditorTab = 'adjust' | 'color' | 'looks' | 'layers' | 'crop' | 'auto' | 'series'
export type ColorTool = 'hsl' | 'curves' | 'split'
export type CurveChannel = 'master' | 'red' | 'green' | 'blue'
export type Sheet = null | 'branches' | 'export' | 'macros' | 'review' | 'describe' | 'shortcuts'

/** Brush settings for the next stroke. Sizes are fractions of the photo's shorter side. */
export interface BrushSettings {
  mode: 'paint' | 'erase'
  size: number
  feather: number
  flow: number
  /** Tint the painted area while painting. */
  overlay: boolean
}

export const BRUSH_SIZES = { min: 0.005, max: 0.3 } as const

export interface EditorState {
  index: number
  mode: 'global' | 'individual'
  tab: EditorTab
  activeKey: BasicKey
  colorTool: ColorTool
  hslBand: HueBand
  curveChannel: CurveChannel
  /** Layer that sliders write to. */
  layerId: string
  /** Layer whose mask is being edited (painted, for brush masks). */
  maskLayerId: string | null
  brush: BrushSettings
  compare: 'off' | 'hold' | 'split'
  splitPos: number
  clipboard: { layers: Layer[]; from: string } | null
  recording: MacroStep[] | null
  sheet: Sheet
  /** Selection inside the batch grid (for paste / reset). */
  gridSelection: string[]
  toast: { id: number; text: string; action?: { label: string; run: () => void } } | null
}

export const useEditor = create<EditorState>(() => ({
  index: 0,
  mode: 'global',
  tab: 'adjust',
  activeKey: 'brightness',
  colorTool: 'hsl',
  hslBand: 'red',
  curveChannel: 'master',
  layerId: BASE_LAYER_ID,
  maskLayerId: null,
  brush: { mode: 'paint', size: 0.06, feather: 0.6, flow: 1, overlay: false },
  compare: 'off',
  splitPos: 0.5,
  clipboard: null,
  recording: null,
  sheet: null,
  gridSelection: [],
  toast: null,
}))

export const editor = {
  set: useEditor.setState,
  get: useEditor.getState,
  reset() {
    useEditor.setState({
      index: 0,
      mode: 'global',
      layerId: BASE_LAYER_ID,
      maskLayerId: null,
      compare: 'off',
      sheet: null,
      gridSelection: [],
    })
  },
  setBrush(patch: Partial<BrushSettings>) {
    useEditor.setState((s) => ({ brush: { ...s.brush, ...patch } }))
  },
  /** Scales the brush size, e.g. 1.25 for larger. */
  scaleBrush(factor: number) {
    const { size } = useEditor.getState().brush
    const next = Math.min(BRUSH_SIZES.max, Math.max(BRUSH_SIZES.min, size * factor))
    editor.setBrush({ size: Math.round(next * 1000) / 1000 })
  },
  record(step: MacroStep) {
    const r = useEditor.getState().recording
    if (r) useEditor.setState({ recording: recordStep(r, step) })
  },
}

let toastId = 0
export function toast(text: string, action?: { label: string; run: () => void }): void {
  const id = ++toastId
  useEditor.setState({ toast: { id, text, ...(action ? { action } : {}) } })
  setTimeout(
    () => {
      if (useEditor.getState().toast?.id === id) useEditor.setState({ toast: null })
    },
    action ? 6000 : 3200,
  )
}
