import { describe, expect, it } from 'vitest'
import { basicToCostyle, parseCostyle } from './costyle.ts'

const style = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<SL Engine="1300">
\t<E K="Name" V="Moody &amp; Warm" />
\t<E K="UUID" V="0B1C3E4F" />
\t<E K="Exposure" V="0.5" />
\t<E V="10" K="Contrast" />
\t<E K="Brightness" V="-5"></E>
\t<E K='Saturation' V='-20'/>
\t<E K="HighlightRecoveryEx" V="40" />
\t<E K="ShadowRecovery" V="25" />
\t<E K="WhiteRecovery" V="10" />
\t<E K="BlackRecovery" V="15" />
\t<E K="Vignetting" V="-1.2" />
\t<E K="ColorBalance" V="1;1;1" />
\t<E K="Clarity" V="12" />
</SL>`

describe('parseCostyle', () => {
  it('maps known keys with the documented approximations', () => {
    const imp = parseCostyle(style)
    expect(imp.basic).toEqual({
      exposure: 0.5,
      contrast: 20,
      brightness: -10,
      saturation: -20,
      highlights: -40,
      shadows: 25,
      whites: -10,
      blacks: 15,
      vignette: -30,
    })
    expect(imp.name).toBe('Moody & Warm')
    expect(imp.warnings).toEqual([
      'Unsupported Capture One settings ignored: ColorBalance, Clarity',
    ])
  })

  it('accepts the legacy HighlightRecovery key and clamps out-of-range values', () => {
    const imp = parseCostyle(
      '<SL><E K="HighlightRecovery" V="30"/><E K="Vignetting" V="-6"/><E K="Exposure" V="9"/></SL>',
    )
    expect(imp.basic).toEqual({ highlights: -30, vignette: -100, exposure: 5 })
    expect(imp.warnings).toEqual([])
  })

  it('warns about non-numeric values and settings nested in layers', () => {
    const imp = parseCostyle(
      '<SL Engine="1300"><E K="Contrast" V="lots"/><E K="Saturation"/><LDS><LD><E K="Exposure" V="2"/></LD></LDS></SL>',
    )
    expect(imp.basic).toEqual({})
    expect(imp.warnings).toEqual([
      'Ignored Contrast: "lots" is not a number',
      'Ignored Saturation: "" is not a number',
      'Ignored 1 settings inside style layers',
    ])
  })

  it('rejects documents without an SL root', () => {
    for (const input of [
      '',
      'garbage',
      '<x:xmpmeta/>',
      '<Root><SL><E K="Exposure" V="1"/></SL></Root>',
    ]) {
      const imp = parseCostyle(input)
      expect(imp.basic).toEqual({})
      expect(imp.warnings[0]).toMatch(/missing <SL>/)
    }
  })

  it('handles truncated files without throwing', () => {
    const imp = parseCostyle('<SL Engine="1300"><E K="Exposure" V="0.3" /><E K="Contr')
    expect(imp.basic).toEqual({ exposure: 0.3 })
  })
})

describe('basicToCostyle', () => {
  it('writes only the sliders Capture One can express', () => {
    const xml = basicToCostyle(
      { exposure: 0.25, contrast: 30, highlights: 20, shadows: -10, temperature: 15, fade: 10 },
      'My <look>',
    )
    expect(xml).toMatch(/^<\?xml version="1.0"/)
    expect(xml).toContain('<SL Engine="1300">')
    expect(xml).toContain('<E K="Name" V="My &lt;look&gt;" />')
    expect(xml).toContain('<E K="Exposure" V="0.25" />')
    expect(xml).toContain('<E K="Contrast" V="15" />')
    expect(xml).not.toMatch(/HighlightRecoveryEx|ShadowRecovery|Temperature|Fade/)
  })

  it('round-trips the representable subset', () => {
    const basic = {
      exposure: -0.7,
      brightness: 12,
      contrast: -24,
      saturation: 35,
      highlights: -55,
      shadows: 40,
      whites: -20,
      blacks: 8,
      vignette: -50,
    }
    const back = parseCostyle(basicToCostyle(basic, 'Round trip'))
    expect(back.basic).toEqual(basic)
    expect(back.name).toBe('Round trip')
    expect(back.warnings).toEqual([])
  })

  it('writes an empty style for neutral settings', () => {
    expect(parseCostyle(basicToCostyle({})).basic).toEqual({})
  })
})
