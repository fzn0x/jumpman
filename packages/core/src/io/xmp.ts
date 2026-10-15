import {
  BASIC_KEYS,
  type Basic,
  type BasicKey,
  basicSpec,
  clampBasicValue,
  compactBasic,
  defaultBasic,
} from '../model/basic.ts'
import {
  type CurvePoint,
  type CurvesParams,
  createBaseLayer,
  createLayer,
  defaultCurves,
  defaultHsl,
  defaultSplit,
  type HslParams,
  type HslShift,
  HUE_BANDS,
  type HueBand,
  isCurveIdentity,
  isLayerNoop,
  type Layer,
  type SplitParams,
} from '../model/layers.ts'
import { clamp, deepClone } from '../util.ts'
import { escapeXml, localName, prefixOf, tokenizeXml } from './xml.ts'

export const CRS_NAMESPACE = 'http://ns.adobe.com/camera-raw-settings/1.0/'

export interface XmpImport {
  basic: Partial<Basic>
  hsl?: HslParams
  split?: SplitParams
  curves?: CurvesParams
  /** Preset name (`crs:Name`), when the file is a Lightroom preset. */
  name?: string
  warnings: string[]
}

export interface XmpExportOptions {
  /** Written as `xmp:CreatorTool`. Defaults to "Jumpman". */
  creatorTool?: string
  /** When set, adds the metadata Lightroom needs to import the file as a named preset. */
  name?: string
}

/** Lightroom PV2012+ settings that map 1:1 onto Basic sliders. */
const BASIC_MAP: readonly (readonly [string, BasicKey])[] = [
  ['IncrementalTemperature', 'temperature'],
  ['IncrementalTint', 'tint'],
  ['Exposure2012', 'exposure'],
  ['Contrast2012', 'contrast'],
  ['Highlights2012', 'highlights'],
  ['Shadows2012', 'shadows'],
  ['Whites2012', 'whites'],
  ['Blacks2012', 'blacks'],
  ['Vibrance', 'vibrance'],
  ['Saturation', 'saturation'],
  ['PostCropVignetteAmount', 'vignette'],
  ['GrainAmount', 'grain'],
]

const BAND_NAMES: Record<HueBand, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  aqua: 'Aqua',
  blue: 'Blue',
  purple: 'Purple',
  magenta: 'Magenta',
}

const HSL_PREFIXES: readonly (readonly [keyof HslShift, string])[] = [
  ['hue', 'HueAdjustment'],
  ['saturation', 'SaturationAdjustment'],
  ['luminance', 'LuminanceAdjustment'],
]

const SPLIT_MAP: readonly (readonly [string, keyof SplitParams, number, number])[] = [
  ['SplitToningShadowHue', 'shadowHue', 0, 360],
  ['SplitToningShadowSaturation', 'shadowSaturation', 0, 100],
  ['SplitToningHighlightHue', 'highlightHue', 0, 360],
  ['SplitToningHighlightSaturation', 'highlightSaturation', 0, 100],
  ['SplitToningBalance', 'balance', -100, 100],
]

const CURVE_MAP: readonly (readonly [string, keyof CurvesParams])[] = [
  ['ToneCurvePV2012', 'master'],
  ['ToneCurvePV2012Red', 'red'],
  ['ToneCurvePV2012Green', 'green'],
  ['ToneCurvePV2012Blue', 'blue'],
]

/** Numeric settings with no Jumpman equivalent, reported when non-zero. */
const UNSUPPORTED = [
  'Texture',
  'Clarity2012',
  'Dehaze',
  'ParametricShadows',
  'ParametricDarks',
  'ParametricLights',
  'ParametricHighlights',
  'ColorGradeMidtoneSat',
  'ColorGradeGlobalSat',
]

const LOCAL_CORRECTIONS = [
  'GradientBasedCorrections',
  'CircularGradientBasedCorrections',
  'PaintBasedCorrections',
  'MaskGroupBasedCorrections',
]

/** Top-level crs properties: plain values, or the items of an rdf:Seq / rdf:Alt. */
type Props = Map<string, string | string[]>

function collectProps(xml: string): Props {
  const tokens = tokenizeXml(xml)
  const prefixes = new Set(['crs'])
  for (const t of tokens) {
    if (t.type !== 'open') continue
    for (const [k, v] of t.attrs)
      if (k.startsWith('xmlns:') && v === CRS_NAMESPACE) prefixes.add(k.slice(6))
  }
  const isCrs = (qname: string) => qname.includes(':') && prefixes.has(prefixOf(qname))

  const props: Props = new Map()
  let depth = 0
  // The crs element being read; anything nested inside it (e.g. the
  // parameters of a crs:Look struct) is not a top-level setting.
  let current: { name: string; depth: number; text: string; items: string[] } | null = null
  let item: string | null = null
  for (const t of tokens) {
    if (t.type === 'open') {
      if (!current) {
        for (const [k, v] of t.attrs) if (isCrs(k)) props.set(localName(k), v)
        if (isCrs(t.name) && !t.selfClosing) {
          current = { name: localName(t.name), depth, text: '', items: [] }
        }
      } else if (localName(t.name) === 'li') {
        if (t.selfClosing) current.items.push('')
        else item = ''
      }
      if (!t.selfClosing) depth++
    } else if (t.type === 'text') {
      if (item !== null) item += t.text
      else if (current) current.text += t.text
    } else {
      depth--
      if (!current) continue
      if (item !== null && localName(t.name) === 'li') {
        current.items.push(item.trim())
        item = null
      } else if (depth <= current.depth) {
        props.set(current.name, current.items.length ? current.items : current.text.trim())
        current = null
        item = null
      }
    }
  }
  return props
}

function readString(props: Props, key: string): string | undefined {
  const v = props.get(key)
  return Array.isArray(v) ? v[0] : v
}

function readNumber(props: Props, key: string, warnings: string[]): number | undefined {
  const raw = props.get(key)
  if (raw === undefined) return undefined
  const v = typeof raw === 'string' && raw.trim() ? Number(raw.trim()) : Number.NaN
  if (Number.isFinite(v)) return v
  warnings.push(`Ignored crs:${key}: ${JSON.stringify(raw)} is not a number`)
  return undefined
}

function clampWarn(key: string, v: number, lo: number, hi: number, warnings: string[]): number {
  if (v >= lo && v <= hi) return v
  const c = clamp(v, lo, hi)
  warnings.push(`crs:${key} ${v} is outside ${lo}..${hi}; clamped to ${c}`)
  return c
}

function parseCurve(raw: string | string[]): CurvePoint[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null
  const points: CurvePoint[] = []
  for (const entry of raw) {
    const m = /^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/.exec(entry.trim())
    if (!m) return null
    points.push({ x: clamp(Number(m[1]) / 255), y: clamp(Number(m[2]) / 255) })
  }
  return points.sort((a, b) => a.x - b.x)
}

/**
 * Reads Lightroom / Camera Raw develop settings (the `crs` namespace) from an
 * XMP sidecar or preset. Accepts attribute and element forms.
 *
 * White balance: the relative `IncrementalTemperature` / `IncrementalTint`
 * (non-raw files) map 1:1. When only absolute raw values exist, they are
 * approximated as temperature ≈ (K − 5500) / 45 and tint ≈ Tint, both clamped
 * to −100..100; "As Shot" white balance is left untouched. Legacy PV2010
 * `Brightness` is used only when the file has no PV2012+ settings.
 */
export function parseXmp(xml: string): XmpImport {
  const warnings: string[] = []
  const props = collectProps(xml)
  const basic: Partial<Basic> = {}
  if (!props.size) warnings.push('No Camera Raw (crs) settings found')

  for (const [key, field] of BASIC_MAP) {
    const v = readNumber(props, key, warnings)
    if (v === undefined) continue
    const { min, max } = basicSpec(field)
    basic[field] = clampWarn(key, v, min, max, warnings)
  }

  if (readString(props, 'WhiteBalance') !== 'As Shot') {
    const kelvin = props.has('IncrementalTemperature')
      ? undefined
      : readNumber(props, 'Temperature', warnings)
    if (kelvin !== undefined) {
      basic.temperature = Math.round(clamp((kelvin - 5500) / 45, -100, 100))
      warnings.push(`Absolute white balance (${kelvin} K) approximated as relative temperature`)
    }
    const tint = props.has('IncrementalTint') ? undefined : readNumber(props, 'Tint', warnings)
    if (tint !== undefined) basic.tint = clamp(tint, -100, 100)
  }

  const pv = Number(readString(props, 'ProcessVersion'))
  const isPv2012 = pv >= 6.7 || [...props.keys()].some((k) => k.endsWith('2012'))
  if (!isPv2012) {
    const b = readNumber(props, 'Brightness', warnings)
    if (b) {
      basic.brightness = clampBasicValue('brightness', b)
      warnings.push('Imported legacy (PV2010) Brightness; the result may differ from Lightroom')
    }
  }

  if (readString(props, 'ConvertToGrayscale') === 'True') {
    basic.saturation = -100
    warnings.push('Black & white conversion approximated with saturation −100')
  }

  const out: XmpImport = { basic: compactBasic(basic), warnings }
  const name = readString(props, 'Name')?.trim()
  if (name) out.name = name

  const hsl = defaultHsl()
  for (const band of HUE_BANDS) {
    for (const [field, prefix] of HSL_PREFIXES) {
      const key = prefix + BAND_NAMES[band]
      const v = readNumber(props, key, warnings)
      if (v !== undefined) hsl[band][field] = clampWarn(key, v, -100, 100, warnings)
    }
  }
  if (HUE_BANDS.some((b) => hsl[b].hue || hsl[b].saturation || hsl[b].luminance)) out.hsl = hsl

  const split = defaultSplit()
  for (const [key, field, lo, hi] of SPLIT_MAP) {
    const v = readNumber(props, key, warnings)
    if (v !== undefined) split[field] = clampWarn(key, v, lo, hi, warnings)
  }
  if (split.shadowSaturation || split.highlightSaturation) out.split = split

  const curves = defaultCurves()
  for (const [key, channel] of CURVE_MAP) {
    const raw = props.get(key)
    if (raw === undefined) continue
    const points = parseCurve(raw)
    if (points) curves[channel] = points
    else warnings.push(`Ignored crs:${key}: malformed tone curve`)
  }
  if (CURVE_MAP.some(([, c]) => !isCurveIdentity(curves[c]))) out.curves = curves

  const unsupported = UNSUPPORTED.filter((k) => {
    const v = Number(readString(props, k))
    return Number.isFinite(v) && v !== 0
  })
  if (unsupported.length) {
    warnings.push(`Settings with no Jumpman equivalent were ignored: ${unsupported.join(', ')}`)
  }
  if (LOCAL_CORRECTIONS.some((k) => props.has(k))) {
    warnings.push('Local adjustments (masks, brushes, gradients) were ignored')
  }
  return out
}

/** Turns an XMP import into a layer stack: base adjustments, then curves, HSL and split toning. */
export function xmpToLayers(imp: XmpImport): Layer[] {
  const layers: Layer[] = [createBaseLayer(imp.basic)]
  if (imp.curves) layers.push(createLayer('curves', { params: deepClone(imp.curves) }))
  if (imp.hsl) layers.push(createLayer('hsl', { params: deepClone(imp.hsl) }))
  if (imp.split) layers.push(createLayer('split', { params: { ...imp.split } }))
  return layers
}

/** Blends a curve toward identity, matching how layer opacity mixes it with the input. */
function scaleCurve(points: CurvePoint[], opacity: number): CurvePoint[] {
  return points.map((p) => ({ x: p.x, y: p.x + (p.y - p.x) * opacity }))
}

function signed(v: number, decimals = 0): string {
  const s = v.toFixed(decimals)
  if (Number(s) === 0) return (0).toFixed(decimals)
  return v > 0 ? `+${s}` : s
}

function unsigned(v: number): string {
  return String(Math.round(v) || 0)
}

function curveToSeq(points: CurvePoint[]): string[] {
  const byX = new Map<number, number>()
  for (const p of [...points].sort((a, b) => a.x - b.x)) {
    byX.set(Math.round(clamp(p.x) * 255), Math.round(clamp(p.y) * 255))
  }
  if (byX.size < 2) return ['0, 0', '255, 255']
  return [...byX].map(([x, y]) => `${x}, ${y}`)
}

function randomUuid(): string {
  let s = ''
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s.toUpperCase()
}

/**
 * Flattens a layer stack into Lightroom develop settings. Enabled, unmasked
 * basic layers are summed (weighted by opacity, then clamped); the first
 * curves, HSL and split-toning layers are used with their opacity baked in.
 * Settings Lightroom cannot express are reported in `warnings`.
 */
export function layersToXmp(
  layers: Layer[],
  opts: XmpExportOptions = {},
): { xml: string; warnings: string[] } {
  const warnings: string[] = []
  const sum = defaultBasic()
  let curves: CurvesParams | undefined
  let hsl: HslParams | undefined
  let split: SplitParams | undefined
  const skipped = (kind: string, name: string) =>
    warnings.push(`Only the first ${kind} layer is exported; skipped "${name}"`)

  for (const layer of layers) {
    if (layer.proposedBy || isLayerNoop(layer)) continue
    if (layer.mask) {
      warnings.push(`Skipped masked layer "${layer.name}": local adjustments are not exported`)
      continue
    }
    const o = Math.min(layer.opacity, 1)
    switch (layer.kind) {
      case 'basic':
        for (const k of BASIC_KEYS) sum[k] += layer.params[k] * o
        break
      case 'curves':
        if (curves) skipped('curves', layer.name)
        else {
          const p = layer.params
          curves = {
            master: scaleCurve(p.master, o),
            red: scaleCurve(p.red, o),
            green: scaleCurve(p.green, o),
            blue: scaleCurve(p.blue, o),
          }
        }
        break
      case 'hsl':
        if (hsl) skipped('HSL', layer.name)
        else {
          hsl = defaultHsl()
          for (const b of HUE_BANDS) {
            const s = layer.params[b]
            hsl[b] = { hue: s.hue * o, saturation: s.saturation * o, luminance: s.luminance * o }
          }
        }
        break
      case 'split':
        if (split) skipped('split toning', layer.name)
        else {
          const p = layer.params
          split = {
            ...p,
            shadowSaturation: p.shadowSaturation * o,
            highlightSaturation: p.highlightSaturation * o,
          }
        }
        break
      case 'lut':
        warnings.push(`Skipped LUT layer "${layer.name}": Lightroom settings cannot embed LUTs`)
        break
    }
  }

  const basic = defaultBasic()
  for (const k of BASIC_KEYS) basic[k] = clampBasicValue(k, sum[k])
  if (Math.round(basic.brightness)) {
    warnings.push('Brightness has no Lightroom equivalent and was not exported')
  }
  if (Math.round(basic.fade)) warnings.push('Fade has no Lightroom equivalent and was not exported')

  const attrs: [string, string][] = [['xmp:CreatorTool', opts.creatorTool ?? 'Jumpman']]
  const name = opts.name?.trim()
  if (name) {
    attrs.push(
      ['crs:PresetType', 'Normal'],
      ['crs:UUID', randomUuid()],
      ['crs:SupportsAmount', 'False'],
      ['crs:SupportsColor', 'True'],
      ['crs:SupportsMonochrome', 'True'],
    )
  }
  attrs.push(['crs:Version', '15.0'], ['crs:ProcessVersion', '11.0'])
  for (const [key, field] of BASIC_MAP) {
    const v = basic[field]
    attrs.push([
      `crs:${key}`,
      field === 'exposure' ? signed(v, 2) : field === 'grain' ? unsigned(v) : signed(v),
    ])
  }
  const h = hsl ?? defaultHsl()
  for (const [field, prefix] of HSL_PREFIXES) {
    for (const band of HUE_BANDS)
      attrs.push([`crs:${prefix}${BAND_NAMES[band]}`, signed(h[band][field])])
  }
  const s = split ?? { ...defaultSplit(), shadowHue: 0, highlightHue: 0 }
  for (const [key, field] of SPLIT_MAP) {
    attrs.push([`crs:${key}`, field === 'balance' ? signed(s[field]) : unsigned(s[field])])
  }
  const c = curves ?? defaultCurves()
  const linear = CURVE_MAP.every(([, ch]) => isCurveIdentity(c[ch]))
  attrs.push(['crs:ToneCurveName2012', linear ? 'Linear' : 'Custom'], ['crs:HasSettings', 'True'])

  const lines = [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '  <rdf:Description rdf:about=""',
    '    xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    `    xmlns:crs="${CRS_NAMESPACE}"`,
    ...attrs.map(([k, v], i) => `    ${k}="${escapeXml(v)}"${i === attrs.length - 1 ? '>' : ''}`),
  ]
  if (name) {
    lines.push(
      '   <crs:Name>',
      '    <rdf:Alt>',
      `     <rdf:li xml:lang="x-default">${escapeXml(name)}</rdf:li>`,
      '    </rdf:Alt>',
      '   </crs:Name>',
    )
  }
  for (const [key, ch] of CURVE_MAP) {
    lines.push(`   <crs:${key}>`, '    <rdf:Seq>')
    for (const li of curveToSeq(c[ch])) lines.push(`     <rdf:li>${li}</rdf:li>`)
    lines.push('    </rdf:Seq>', `   </crs:${key}>`)
  }
  lines.push('  </rdf:Description>', ' </rdf:RDF>', '</x:xmpmeta>', '')
  return { xml: lines.join('\n'), warnings }
}
