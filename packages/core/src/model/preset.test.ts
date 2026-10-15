import { describe, expect, it } from 'vitest'
import { identityLut } from '../color/lut.ts'
import { BASE_LAYER_ID, createBaseLayer, createLayer } from './layers.ts'
import {
  builtinPresets,
  createPreset,
  decodeLut,
  encodeLut,
  forkPreset,
  parsePreset,
  presetFromShareString,
  presetLayers,
  presetToShareString,
} from './preset.ts'

describe('presets', () => {
  it('round-trips through a share string', () => {
    const p = createPreset(
      'Weekend',
      { layers: [createBaseLayer({ exposure: 0.4 })] },
      { author: 'Ana', tags: ['warm'] },
    )
    const back = presetFromShareString(presetToShareString(p))
    expect(back.name).toBe('Weekend')
    expect(back.layers[0]?.kind === 'basic' && back.layers[0].params.exposure).toBe(0.4)
    expect(presetToShareString(p)).not.toMatch(/[+/=]/)
  })

  it('embeds custom LUTs with 16-bit precision', () => {
    const lut = identityLut(5)
    const back = decodeLut(encodeLut(lut))
    expect(back.size).toBe(5)
    for (let i = 0; i < lut.data.length; i++)
      expect(back.data[i]).toBeCloseTo(lut.data[i] as number, 4)
    expect(() => decodeLut({ size: 5, data: 'AAAA' })).toThrow()
  })

  it('validates untrusted presets', () => {
    expect(() => parsePreset({ schema: 'other' })).toThrow()
    expect(() => parsePreset({ schema: 'jumpman.preset/1', layers: [] })).toThrow()
    const p = parsePreset(
      JSON.stringify({
        schema: 'jumpman.preset/1',
        name: 'x'.repeat(500),
        layers: [{ kind: 'lut', params: { lutId: 'builtin:mono' } }],
        aspect: 'bogus',
      }),
    )
    expect(p.name).toHaveLength(80)
    expect(p.aspect).toBeUndefined()
  })

  it('forks with attribution', () => {
    const src = builtinPresets()[0]
    if (!src) throw new Error('no presets')
    const fork = forkPreset(src, 'me')
    expect(fork.id).not.toBe(src.id)
    expect(fork.forkedFrom).toEqual({ id: src.id, name: src.name, author: 'Jumpman' })
  })

  it('ships valid built-in presets that keep the base layer id', () => {
    for (const p of builtinPresets()) {
      expect(parsePreset(JSON.parse(JSON.stringify(p))).layers.length).toBe(p.layers.length)
      const layers = presetLayers(p)
      expect(layers.filter((l) => l.id === BASE_LAYER_ID).length).toBeLessThanOrEqual(1)
    }
    const l = createLayer('lut', { params: { lutId: 'x' } })
    expect(presetLayers(createPreset('a', { layers: [l] }))[0]?.id).not.toBe(l.id)
  })
})
