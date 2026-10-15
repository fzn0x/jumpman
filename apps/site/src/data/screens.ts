/**
 * App screenshots shown in phone frames. Paths are relative to `public/` (the base path is added
 * when rendering). To use real captures, drop 390×844 (or any 390:844) PNGs into
 * `public/screenshots/` and change the `.svg` extensions below to `.png`.
 */
export interface Screen {
  id: 'collection' | 'editor' | 'layers' | 'grid'
  src: string
  alt: string
  caption: string
}

export const screens: Screen[] = [
  {
    id: 'collection',
    src: 'screenshots/collection.svg',
    alt: 'The Spring Pink collection in Jumpman with nine photos selected and an “Edit these images” button.',
    caption: 'Pick photos from a collection, then edit them together.',
  },
  {
    id: 'editor',
    src: 'screenshots/editor.svg',
    alt: 'Jumpman’s editor in Global mode: a summary bar of brightness, exposure, highlights, shadows and saturation above an exposure dial.',
    caption: 'One global edit, applied to all twelve photos.',
  },
  {
    id: 'layers',
    src: 'screenshots/layers.svg',
    alt: 'The layer stack in Jumpman: Adjust, a Spring Pink LUT at 70% opacity, Curves, HSL and Split toning.',
    caption: 'Stack layers and set each one’s opacity.',
  },
  {
    id: 'grid',
    src: 'screenshots/grid.svg',
    alt: 'A before-and-after grid of twelve photos, two marked as having individual edits.',
    caption: 'Check the whole batch before and after.',
  },
]

export function screen(id: Screen['id']): Screen {
  const found = screens.find((s) => s.id === id)
  if (!found) throw new Error(`Unknown screen: ${id}`)
  return found
}
