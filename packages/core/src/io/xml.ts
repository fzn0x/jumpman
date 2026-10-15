/**
 * A tiny, forgiving XML tokenizer for the preset formats we import (XMP,
 * Capture One styles). It does not validate nesting or resolve namespaces;
 * callers work with the raw qualified names. Malformed trailing markup ends
 * the token stream instead of throwing.
 */
export type XmlToken =
  | { type: 'open'; name: string; attrs: Map<string, string>; selfClosing: boolean }
  | { type: 'close'; name: string }
  | { type: 'text'; text: string }

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeXmlEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (raw, ref: string) => {
    if (ref.startsWith('#')) {
      const code = ref[1] === 'x' ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1))
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw
    }
    return NAMED_ENTITIES[ref] ?? raw
  })
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** The part of a qualified name after the namespace prefix. */
export function localName(qname: string): string {
  return qname.slice(qname.indexOf(':') + 1)
}

/** The namespace prefix of a qualified name ('' when unprefixed). */
export function prefixOf(qname: string): string {
  const i = qname.indexOf(':')
  return i < 0 ? '' : qname.slice(0, i)
}

const NAME = /[A-Za-z_][\w.:-]*/y
const ATTR_NAME = /[^\s=/>"']+/y
const SPACE = /\s*/y

function skipSpace(xml: string, i: number): number {
  SPACE.lastIndex = i
  SPACE.test(xml)
  return SPACE.lastIndex
}

function readStartTag(
  xml: string,
  lt: number,
): { token: XmlToken; end: number } | 'invalid' | 'truncated' {
  NAME.lastIndex = lt + 1
  const nameMatch = NAME.exec(xml)
  if (!nameMatch) return 'invalid'
  const attrs = new Map<string, string>()
  let i = NAME.lastIndex
  for (;;) {
    i = skipSpace(xml, i)
    if (i >= xml.length) return 'truncated'
    const ch = xml[i]
    if (ch === '>') return { token: open(nameMatch[0], attrs, false), end: i + 1 }
    if (ch === '/' && xml[i + 1] === '>') {
      return { token: open(nameMatch[0], attrs, true), end: i + 2 }
    }
    ATTR_NAME.lastIndex = i
    const attr = ATTR_NAME.exec(xml)
    if (!attr) return 'invalid'
    i = skipSpace(xml, ATTR_NAME.lastIndex)
    if (xml[i] !== '=') {
      attrs.set(attr[0], '')
      continue
    }
    i = skipSpace(xml, i + 1)
    const quote = xml[i]
    if (quote !== '"' && quote !== "'") return 'invalid'
    const close = xml.indexOf(quote, i + 1)
    if (close < 0) return 'truncated'
    attrs.set(attr[0], decodeXmlEntities(xml.slice(i + 1, close)))
    i = close + 1
  }
}

function open(name: string, attrs: Map<string, string>, selfClosing: boolean): XmlToken {
  return { type: 'open', name, attrs, selfClosing }
}

/** Splits markup into open/close/text tokens, skipping comments, PIs and doctypes. */
export function tokenizeXml(xml: string): XmlToken[] {
  const out: XmlToken[] = []
  const pushText = (text: string) => {
    if (text) out.push({ type: 'text', text })
  }
  let i = 0
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) {
      pushText(decodeXmlEntities(xml.slice(i)))
      break
    }
    pushText(decodeXmlEntities(xml.slice(i, lt)))
    let end = -1
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4)
      end = e < 0 ? -1 : e + 3
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9)
      if (e >= 0) pushText(xml.slice(lt + 9, e))
      end = e < 0 ? -1 : e + 3
    } else if (xml.startsWith('<?', lt)) {
      const e = xml.indexOf('?>', lt + 2)
      end = e < 0 ? -1 : e + 2
    } else if (xml.startsWith('<!', lt)) {
      const e = xml.indexOf('>', lt + 2)
      end = e < 0 ? -1 : e + 1
    } else if (xml[lt + 1] === '/') {
      const e = xml.indexOf('>', lt + 2)
      if (e >= 0) out.push({ type: 'close', name: xml.slice(lt + 2, e).trim() })
      end = e < 0 ? -1 : e + 1
    } else {
      const tag = readStartTag(xml, lt)
      if (tag === 'invalid') {
        pushText('<')
        end = lt + 1
      } else if (tag !== 'truncated') {
        out.push(tag.token)
        end = tag.end
      }
    }
    if (end < 0) break
    i = end
  }
  return out
}
