import { addFiles, createCollection } from '../state/library.ts'
import { navigate } from '../state/router.ts'
import { defaultCollectionName } from './format.ts'

interface LaunchParams {
  files: { getFile(): Promise<File> }[]
}

/** Imports photos opened with the installed PWA ("Open with Jumpman"). */
export function handleLaunchQueue(): void {
  const queue = (
    globalThis as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }
  ).launchQueue
  queue?.setConsumer(async (params) => {
    if (!params.files.length) return
    const files = await Promise.all(params.files.map((h) => h.getFile()))
    const id = createCollection(defaultCollectionName())
    navigate({ name: 'collection', id })
    await addFiles(id, files)
  })
}
