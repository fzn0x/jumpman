/** Export filename patterns, e.g. "{collection}-{n:3}" → "spring-pink-001.jpg". */

export interface FilenameContext {
  /** Original file name without extension. */
  name: string
  /** 1-based position in the export. */
  index: number
  collection?: string
  branch?: string
  takenAt?: number
  width?: number
  height?: number
}

export const FILENAME_TOKENS = [
  { token: '{name}', help: 'Original file name' },
  { token: '{n}', help: 'Sequence number (use {n:3} for 001)' },
  { token: '{collection}', help: 'Collection name' },
  { token: '{branch}', help: 'Version branch name' },
  { token: '{date}', help: 'Capture date, YYYY-MM-DD' },
  { token: '{time}', help: 'Capture time, HHmmss' },
  { token: '{w}x{h}', help: 'Output size' },
] as const

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Removes characters that are invalid in file names on common systems. */
export function sanitizeFilename(s: string): string {
  const cleaned = s
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.]+$/g, '')
    .slice(0, 120)
  return cleaned || 'photo'
}

export function formatFilename(pattern: string, ctx: FilenameContext): string {
  const d = ctx.takenAt !== undefined ? new Date(ctx.takenAt) : undefined
  const out = pattern.replace(/\{(\w+)(?::(\d+))?\}/g, (match, key: string, width?: string) => {
    switch (key) {
      case 'name':
        return ctx.name
      case 'n':
        return pad(ctx.index, width ? Number(width) : 1)
      case 'collection':
        return slugify(ctx.collection ?? '')
      case 'branch':
        return slugify(ctx.branch ?? '')
      case 'date':
        return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : ''
      case 'time':
        return d ? `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` : ''
      case 'w':
        return ctx.width !== undefined ? String(ctx.width) : ''
      case 'h':
        return ctx.height !== undefined ? String(ctx.height) : ''
      default:
        return match
    }
  })
  return sanitizeFilename(out)
}

/** De-duplicates names case-insensitively by appending -2, -3, … */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>()
  return names.map((n) => {
    let candidate = n
    let i = 2
    while (used.has(candidate.toLowerCase())) candidate = `${n}-${i++}`
    used.add(candidate.toLowerCase())
    return candidate
  })
}

export function stripExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i > 0 ? fileName.slice(0, i) : fileName
}
