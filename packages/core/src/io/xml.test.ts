import { describe, expect, it } from 'vitest'
import { decodeXmlEntities, escapeXml, localName, prefixOf, tokenizeXml } from './xml.ts'

describe('tokenizeXml', () => {
  it('tokenizes tags, attributes and text', () => {
    const tokens = tokenizeXml(
      `<?xml version="1.0"?><!-- <fake a="1"/> --><a x='1' y = "two > three"><b/>hi &amp; bye</a>`,
    )
    expect(tokens).toEqual([
      {
        type: 'open',
        name: 'a',
        attrs: new Map([
          ['x', '1'],
          ['y', 'two > three'],
        ]),
        selfClosing: false,
      },
      { type: 'open', name: 'b', attrs: new Map(), selfClosing: true },
      { type: 'text', text: 'hi & bye' },
      { type: 'close', name: 'a' },
    ])
  })

  it('keeps qualified names and handles CDATA, doctypes and valueless attributes', () => {
    const tokens = tokenizeXml('<!DOCTYPE x><ns:e ns:k="v" flag><![CDATA[<raw>&amp;]]></ns:e >')
    expect(tokens[0]).toMatchObject({ type: 'open', name: 'ns:e' })
    const first = tokens[0]
    expect(first?.type === 'open' && first.attrs.get('flag')).toBe('')
    expect(tokens[1]).toEqual({ type: 'text', text: '<raw>&amp;' })
    expect(tokens[2]).toEqual({ type: 'close', name: 'ns:e' })
  })

  it('stops quietly on truncated markup and treats stray "<" as text', () => {
    expect(tokenizeXml('<a b="1"><c d="unterminated')).toHaveLength(1)
    expect(tokenizeXml('<a><!-- never closed')).toHaveLength(1)
    expect(tokenizeXml('1 < 2')).toEqual([
      { type: 'text', text: '1 ' },
      { type: 'text', text: '<' },
      { type: 'text', text: ' 2' },
    ])
    expect(tokenizeXml('')).toEqual([])
  })
})

describe('xml helpers', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeXmlEntities('&lt;&#65;&#x42;&quot;&apos;&gt;&bogus;&#0;')).toBe(
      `<AB"'>&bogus;&#0;`,
    )
  })

  it('escapes text so it decodes back', () => {
    const s = `Tom & "Jerry's" <look>`
    expect(decodeXmlEntities(escapeXml(s))).toBe(s)
    expect(escapeXml(s)).not.toMatch(/[<>"']/)
  })

  it('splits qualified names', () => {
    expect(localName('crs:Exposure2012')).toBe('Exposure2012')
    expect(localName('plain')).toBe('plain')
    expect(prefixOf('crs:Exposure2012')).toBe('crs')
    expect(prefixOf('plain')).toBe('')
  })
})
