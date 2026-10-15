import { addFiles, createCollection } from '../state/library.ts'

interface SampleManifest {
  collection: string
  photos: { file: string; author: string; source: string }[]
}

/** Creates the bundled "Spring Pink" sample collection; photos keep importing in the background. */
export async function loadSamples(): Promise<string> {
  const base = import.meta.env.BASE_URL
  const manifest = (await fetch(`${base}samples/samples.json`).then((r) =>
    r.json(),
  )) as SampleManifest
  const start = Date.UTC(2026, 3, 12, 9, 0)
  const files = await Promise.all(
    manifest.photos.map(async (p, i) => {
      const blob = await fetch(`${base}samples/${p.file}`).then((r) => r.blob())
      // Two "moments" a few hours apart, so time-based smart selection has something to find.
      const t = start + i * 6 * 60_000 + (i >= 5 ? 3 * 3_600_000 : 0)
      return new File([blob], p.file, { type: 'image/jpeg', lastModified: t })
    }),
  )
  const id = createCollection(manifest.collection)
  void addFiles(id, files)
  return id
}
