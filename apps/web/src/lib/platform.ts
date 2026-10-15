/**
 * Saving and sharing across the web app and the Capacitor (Android) shell.
 * Native plugins are imported lazily so the web bundle stays small.
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

export function isNative(): boolean {
  return !!(globalThis as { Capacitor?: CapacitorGlobal }).Capacitor?.isNativePlatform?.()
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

async function writeNative(name: string, blob: Blob, cache = false): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const result = await Filesystem.writeFile({
    path: cache ? name : `Jumpman/${name}`,
    data: await blobToBase64(blob),
    directory: cache ? Directory.Cache : Directory.Documents,
    recursive: true,
  })
  return result.uri
}

/** Saves one file: a download on the web, Documents/Jumpman on Android. */
export async function saveFile(name: string, blob: Blob): Promise<string> {
  if (isNative()) {
    await writeNative(name, blob)
    return `Saved to Documents/Jumpman/${name}`
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return `Downloaded ${name}`
}

export function canShareFiles(): boolean {
  if (isNative()) return true
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'x.jpg', { type: 'image/jpeg' })] })
  } catch {
    return false
  }
}

/** Opens the system share sheet with files (social apps, cloud drives, messages). */
export async function shareFiles(files: File[], title = 'Jumpman'): Promise<void> {
  if (isNative()) {
    const uris = await Promise.all(files.map((f) => writeNative(f.name, f, true)))
    const { Share } = await import('@capacitor/share')
    await Share.share({ title, files: uris })
    return
  }
  await navigator.share({ files, title })
}

export function canPickDirectory(): boolean {
  return !isNative() && 'showDirectoryPicker' in globalThis
}

/** Writes files into a folder the user picks (Chromium desktop). */
export async function saveToDirectory(files: { name: string; blob: Blob }[]): Promise<void> {
  const picker = (
    globalThis as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }
  ).showDirectoryPicker
  if (!picker) throw new Error('Folder saving is not supported here')
  const dir = await picker({ mode: 'readwrite' })
  for (const f of files) {
    const handle = await dir.getFileHandle(f.name, { create: true })
    const w = await handle.createWritable()
    await w.write(f.blob)
    await w.close()
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Public URL of the deployed app, used for share links. */
export function appUrl(): string {
  if (
    !isNative() &&
    location.protocol.startsWith('http') &&
    !location.hostname.match(/^(localhost|127\.)/)
  ) {
    return `${location.origin}${location.pathname}`
  }
  return 'https://fzn0x.github.io/jumpman/app/'
}
