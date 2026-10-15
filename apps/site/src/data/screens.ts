/**
 * App screenshots shown in phone frames. Paths are relative to `public/` (the base path is added
 * when rendering). Captures are 390:844 phone screenshots of the web app.
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
    src: 'screenshots/collection.jpg',
    alt: 'The Spring Pink collection in Jumpman with four of ten photos selected and an “Edit these images” button.',
    caption: 'Pick photos from a collection, then edit them together.',
  },
  {
    id: 'editor',
    src: 'screenshots/editor.jpg',
    alt: 'Jumpman’s editor in Global mode: the summary bar shows Brightness +12, Exposure +0.30 and Highlights −20 above the red Brightness row and the dial.',
    caption: 'One global edit, applied to all ten photos.',
  },
  {
    id: 'layers',
    src: 'screenshots/layers.jpg',
    alt: 'The layer stack in Jumpman: auto match, a Spring Pink LUT at 80% and the global adjust layer.',
    caption: 'Stack layers and set each one’s opacity.',
  },
  {
    id: 'grid',
    src: 'screenshots/grid.jpg',
    alt: 'A side-by-side before-and-after grid of the whole batch in the Spring Pink look.',
    caption: 'Check the whole batch before and after.',
  },
]

export function screen(id: Screen['id']): Screen {
  const found = screens.find((s) => s.id === id)
  if (!found) throw new Error(`Unknown screen: ${id}`)
  return found
}
