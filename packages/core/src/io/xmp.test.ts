import { describe, expect, it } from 'vitest'
import { defaultBasic } from '../model/basic.ts'
import {
  BASE_LAYER_ID,
  createBaseLayer,
  createLayer,
  defaultCurves,
  defaultHsl,
  defaultSplit,
  type Layer,
} from '../model/layers.ts'
import { layersToXmp, parseXmp, xmpToLayers } from './xmp.ts'

const wrap = (body: string, attrs = '') => `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    ${attrs}>
${body}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`

describe('parseXmp', () => {
  it('reads basic settings in attribute form with signed values', () => {
    const imp = parseXmp(
      wrap(
        '',
        `crs:ProcessVersion="11.0" crs:Exposure2012="+0.50" crs:Contrast2012="-12"
         crs:Highlights2012="-40" crs:Shadows2012="+35" crs:Whites2012="+5" crs:Blacks2012="-8"
         crs:IncrementalTemperature="+15" crs:IncrementalTint="-3" crs:Vibrance="+20"
         crs:Saturation="-10" crs:PostCropVignetteAmount="-25" crs:GrainAmount="30"
         crs:Clarity2012="0"`,
      ),
    )
    expect(imp.basic).toEqual({
      exposure: 0.5,
      contrast: -12,
      highlights: -40,
      shadows: 35,
      whites: 5,
      blacks: -8,
      temperature: 15,
      tint: -3,
      vibrance: 20,
      saturation: -10,
      vignette: -25,
      grain: 30,
    })
    expect(imp.hsl).toBeUndefined()
    expect(imp.split).toBeUndefined()
    expect(imp.curves).toBeUndefined()
    expect(imp.warnings).toEqual([])
  })

  it('reads element form, rdf:Seq tone curves and any prefix bound to the crs namespace', () => {
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description xmlns:cr="http://ns.adobe.com/camera-raw-settings/1.0/">
        <cr:Exposure2012>-1.25</cr:Exposure2012>
        <cr:HueAdjustmentRed>+10</cr:HueAdjustmentRed>
        <cr:LuminanceAdjustmentBlue>-30</cr:LuminanceAdjustmentBlue>
        <cr:ToneCurvePV2012>
          <rdf:Seq>
            <rdf:li>0, 20</rdf:li>
            <rdf:li>128, 128</rdf:li>
            <rdf:li>255, 235</rdf:li>
          </rdf:Seq>
        </cr:ToneCurvePV2012>
        <cr:ToneCurvePV2012Red><rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></cr:ToneCurvePV2012Red>
      </rdf:Description></rdf:RDF></x:xmpmeta>`
    const imp = parseXmp(xml)
    expect(imp.basic).toEqual({ exposure: -1.25 })
    expect(imp.hsl?.red).toEqual({ hue: 10, saturation: 0, luminance: 0 })
    expect(imp.hsl?.blue.luminance).toBe(-30)
    expect(imp.curves?.master).toEqual([
      { x: 0, y: 20 / 255 },
      { x: 128 / 255, y: 128 / 255 },
      { x: 1, y: 235 / 255 },
    ])
    expect(imp.curves?.red).toEqual(defaultCurves().red)
  })

  it('reads split toning and drops it when both saturations are zero', () => {
    const tones = (s: number) =>
      parseXmp(
        wrap(
          '',
          `crs:SplitToningShadowHue="220" crs:SplitToningShadowSaturation="${s}"
           crs:SplitToningHighlightHue="45" crs:SplitToningHighlightSaturation="0"
           crs:SplitToningBalance="+20"`,
        ),
      )
    expect(tones(25).split).toEqual({
      shadowHue: 220,
      shadowSaturation: 25,
      highlightHue: 45,
      highlightSaturation: 0,
      balance: 20,
    })
    expect(tones(0).split).toBeUndefined()
  })

  it('approximates absolute white balance unless it is As Shot', () => {
    const custom = parseXmp(
      wrap('', 'crs:WhiteBalance="Custom" crs:Temperature="6400" crs:Tint="+130"'),
    )
    expect(custom.basic).toEqual({ temperature: 20, tint: 100 })
    expect(custom.warnings.join()).toMatch(/6400 K/)
    expect(parseXmp(wrap('', 'crs:Temperature="20000"')).basic.temperature).toBe(100)
    const asShot = parseXmp(
      wrap('', 'crs:WhiteBalance="As Shot" crs:Temperature="4900" crs:Tint="+8"'),
    )
    expect(asShot.basic).toEqual({})
    const both = parseXmp(wrap('', 'crs:Temperature="9000" crs:IncrementalTemperature="-5"'))
    expect(both.basic.temperature).toBe(-5)
  })

  it('uses legacy Brightness only for pre-2012 process versions', () => {
    const legacy = parseXmp(wrap('', 'crs:ProcessVersion="5.7" crs:Brightness="+30"'))
    expect(legacy.basic.brightness).toBe(30)
    expect(legacy.warnings.join()).toMatch(/PV2010/)
    const modern = parseXmp(
      wrap('', 'crs:ProcessVersion="11.0" crs:Brightness="+50" crs:Exposure2012="0.00"'),
    )
    expect(modern.basic).toEqual({})
  })

  it('ignores settings nested in structs such as crs:Look', () => {
    const xml = wrap(
      `<crs:Look>
        <rdf:Description crs:Name="Adobe Color" crs:Amount="1">
          <crs:Parameters>
            <rdf:Description crs:Exposure2012="+3.00" crs:Contrast2012="+80">
              <crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 50</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012>
            </rdf:Description>
          </crs:Parameters>
        </rdf:Description>
      </crs:Look>
      <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">Warm &amp; Soft</rdf:li></rdf:Alt></crs:Name>`,
      'crs:Exposure2012="+0.30"',
    )
    const imp = parseXmp(xml)
    expect(imp.basic).toEqual({ exposure: 0.3 })
    expect(imp.curves).toBeUndefined()
    expect(imp.name).toBe('Warm & Soft')
  })

  it('reports bad, out-of-range and unsupported values', () => {
    const imp = parseXmp(
      wrap(
        '<crs:ToneCurvePV2012><rdf:Seq><rdf:li>zero, 1</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012><crs:GradientBasedCorrections><rdf:Seq/></crs:GradientBasedCorrections>',
        'crs:Exposure2012="abc" crs:Contrast2012="" crs:Shadows2012="+150" crs:Dehaze="+12" crs:Texture="5"',
      ),
    )
    expect(imp.basic).toEqual({ shadows: 100 })
    const w = imp.warnings.join('\n')
    expect(w).toMatch(/Exposure2012: "abc" is not a number/)
    expect(w).toMatch(/Contrast2012/)
    expect(w).toMatch(/Shadows2012 150 is outside/)
    expect(w).toMatch(/ToneCurvePV2012: malformed/)
    expect(w).toMatch(/Texture, Dehaze/)
    expect(w).toMatch(/Local adjustments/)
  })

  it('maps black & white conversion to full desaturation', () => {
    const imp = parseXmp(wrap('', 'crs:ConvertToGrayscale="True" crs:Saturation="+20"'))
    expect(imp.basic.saturation).toBe(-100)
  })

  it('returns an empty import for non-XMP or broken input', () => {
    for (const input of ['', 'not xml at all', '<a><b', '<x:xmpmeta><rdf:RDF></rdf:RDF>']) {
      const imp = parseXmp(input)
      expect(imp.basic).toEqual({})
      expect(imp.warnings).toEqual(['No Camera Raw (crs) settings found'])
    }
  })
})

describe('xmpToLayers', () => {
  it('builds a base layer plus curves, HSL and split layers', () => {
    const hsl = defaultHsl()
    hsl.green.saturation = -40
    const layers = xmpToLayers({
      basic: { exposure: 0.4 },
      hsl,
      split: { ...defaultSplit(), shadowSaturation: 10 },
      curves: {
        ...defaultCurves(),
        master: [
          { x: 0, y: 0.1 },
          { x: 1, y: 1 },
        ],
      },
      warnings: [],
    })
    expect(layers.map((l) => l.kind)).toEqual(['basic', 'curves', 'hsl', 'split'])
    const [base] = layers
    expect(base?.id).toBe(BASE_LAYER_ID)
    expect(base?.kind === 'basic' && base.params).toEqual({ ...defaultBasic(), exposure: 0.4 })
    hsl.green.saturation = 0
    const hslLayer = layers[2]
    expect(hslLayer?.kind === 'hsl' && hslLayer.params.green.saturation).toBe(-40)
  })

  it('returns just the base layer for an empty import', () => {
    expect(xmpToLayers({ basic: {}, warnings: [] })).toHaveLength(1)
  })
})

describe('layersToXmp', () => {
  it('writes a valid XMP packet with signed values', () => {
    const { xml, warnings } = layersToXmp([createBaseLayer({ exposure: 0.5, contrast: -12 })], {
      creatorTool: 'Jumpman 1.0',
    })
    expect(warnings).toEqual([])
    expect(xml).toMatch(/^<x:xmpmeta xmlns:x="adobe:ns:meta\/">/)
    expect(xml).toContain('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">')
    expect(xml).toContain('xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"')
    expect(xml).toContain('xmp:CreatorTool="Jumpman 1.0"')
    expect(xml).toContain('crs:ProcessVersion="11.0"')
    expect(xml).toContain('crs:HasSettings="True"')
    expect(xml).toContain('crs:Exposure2012="+0.50"')
    expect(xml).toContain('crs:Contrast2012="-12"')
    expect(xml).toContain('crs:Shadows2012="0"')
    expect(xml).toContain('crs:ToneCurveName2012="Linear"')
    expect(xml).not.toContain('crs:PresetType')
  })

  it('flattens basic layers by opacity and warns about unsupported layers', () => {
    const layers: Layer[] = [
      createBaseLayer({ exposure: 0.4, shadows: 80, brightness: 10 }),
      createLayer('basic', {
        opacity: 0.5,
        params: { ...defaultBasic(), exposure: 0.4, shadows: 60 },
      }),
      createLayer('basic', { enabled: false, params: { ...defaultBasic(), exposure: 3 } }),
      createLayer('basic', {
        name: 'Sky',
        mask: { type: 'sky' },
        params: { ...defaultBasic(), exposure: -1 },
      }),
      createLayer('basic', { proposedBy: 'client', params: { ...defaultBasic(), exposure: 2 } }),
      createLayer('lut', { name: 'Film', params: { lutId: 'film' } }),
    ]
    const { xml, warnings } = layersToXmp(layers)
    const back = parseXmp(xml)
    expect(back.basic.exposure).toBeCloseTo(0.6)
    expect(back.basic.shadows).toBe(100)
    expect(warnings.join('\n')).toMatch(/masked layer "Sky"/)
    expect(warnings.join('\n')).toMatch(/LUT layer "Film"/)
    expect(warnings.join('\n')).toMatch(/Brightness/)
  })

  it('bakes layer opacity into curves, HSL and split toning and keeps only the first of each', () => {
    const hsl = defaultHsl()
    hsl.red.hue = 40
    const layers: Layer[] = [
      createLayer('curves', {
        opacity: 0.5,
        params: {
          ...defaultCurves(),
          master: [
            { x: 0, y: 0.4 },
            { x: 1, y: 1 },
          ],
        },
      }),
      createLayer('curves', {
        name: 'Second',
        params: {
          ...defaultCurves(),
          red: [
            { x: 0, y: 1 },
            { x: 1, y: 0 },
          ],
        },
      }),
      createLayer('hsl', { opacity: 0.5, params: hsl }),
      createLayer('split', {
        opacity: 0.5,
        params: { ...defaultSplit(), highlightSaturation: 40 },
      }),
    ]
    const { xml, warnings } = layersToXmp(layers)
    const back = parseXmp(xml)
    expect(back.curves?.master[0]?.y).toBeCloseTo(0.2, 2)
    expect(back.curves?.red).toEqual(defaultCurves().red)
    expect(back.hsl?.red.hue).toBe(20)
    expect(back.split?.highlightSaturation).toBe(20)
    expect(warnings).toEqual(['Only the first curves layer is exported; skipped "Second"'])
  })

  it('adds Lightroom preset metadata when a name is given', () => {
    const { xml } = layersToXmp([createBaseLayer({ vibrance: 10 })], { name: 'Golden <hour>' })
    expect(xml).toContain('crs:PresetType="Normal"')
    expect(xml).toMatch(/crs:UUID="[0-9A-F]{32}"/)
    expect(parseXmp(xml).name).toBe('Golden <hour>')
  })

  it('round-trips through parseXmp', () => {
    const hsl = defaultHsl()
    hsl.orange = { hue: -5, saturation: 12, luminance: 20 }
    hsl.magenta.luminance = -7
    const split = {
      shadowHue: 210,
      shadowSaturation: 15,
      highlightHue: 35,
      highlightSaturation: 22,
      balance: -10,
    }
    const curves = {
      master: [
        { x: 0, y: 15 / 255 },
        { x: 64 / 255, y: 58 / 255 },
        { x: 192 / 255, y: 200 / 255 },
        { x: 1, y: 1 },
      ],
      red: [
        { x: 0, y: 0 },
        { x: 1, y: 245 / 255 },
      ],
      green: defaultCurves().green,
      blue: [
        { x: 0, y: 10 / 255 },
        { x: 1, y: 1 },
      ],
    }
    const basic = {
      exposure: -0.35,
      contrast: 15,
      highlights: -60,
      shadows: 40,
      whites: 10,
      blacks: -15,
      temperature: 12,
      tint: -4,
      vibrance: 25,
      saturation: -5,
      vignette: -20,
      grain: 18,
    }
    const { xml, warnings } = layersToXmp([
      createBaseLayer(basic),
      createLayer('curves', { params: curves }),
      createLayer('hsl', { params: hsl }),
      createLayer('split', { params: split }),
    ])
    expect(warnings).toEqual([])
    const back = parseXmp(xml)
    expect(back.warnings).toEqual([])
    expect(back.basic).toEqual(basic)
    expect(back.hsl).toEqual(hsl)
    expect(back.split).toEqual(split)
    for (const ch of ['master', 'red', 'green', 'blue'] as const) {
      expect(back.curves?.[ch]).toHaveLength(curves[ch].length)
      back.curves?.[ch].forEach((p, i) => {
        expect(p.x).toBeCloseTo(curves[ch][i]?.x ?? -1, 6)
        expect(p.y).toBeCloseTo(curves[ch][i]?.y ?? -1, 6)
      })
    }
  })
})
