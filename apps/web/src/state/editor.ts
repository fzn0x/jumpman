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
  /** Layer whose mask is being edited. */
  maskLayerId: string | null
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
