import { describe, expect, it } from 'vitest'
import {
  formatFilename,
  sanitizeFilename,
  slugify,
  stripExtension,
  uniqueNames,
} from './filename.ts'

describe('filename patterns', () => {
  const takenAt = new Date(2026, 3, 9, 7, 5, 3).getTime()

  it('expands tokens', () => {
    expect(
      formatFilename('{collection}-{n:3}', { name: 'IMG_1', index: 7, collection: 'Spring Pink' }),
    ).toBe('spring-pink-007')
    expect(formatFilename('{date}_{time}_{name}', { name: 'IMG_1', index: 1, takenAt })).toBe(
      '2026-04-09_070503_IMG_1',
    )
    expect(
      formatFilename('{name}-{w}x{h}', { name: 'a', index: 1, width: 1080, height: 1350 }),
    ).toBe('a-1080x1350')
    expect(formatFilename('{unknown}', { name: 'a', index: 1 })).toBe('{unknown}')
  })

  it('sanitizes and de-duplicates', () => {
    expect(sanitizeFilename('a/b:c*?')).toBe('a-b-c-')
    expect(sanitizeFilename('...')).toBe('photo')
    expect(slugify('Café Été!')).toBe('cafe-ete')
    expect(uniqueNames(['a', 'A', 'a', 'b'])).toEqual(['a', 'A-2', 'a-3', 'b'])
    expect(stripExtension('photo.final.JPG')).toBe('photo.final')
    expect(stripExtension('.hidden')).toBe('.hidden')
  })
})
