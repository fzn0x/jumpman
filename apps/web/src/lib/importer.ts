import type { PhotoStats } from '@jumpman/core'
import type { ImportResult } from './import.worker.ts'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

class WorkerPool {
  private workers: Worker[] = []
  private busy = new Map<Worker, number>()
  private pending = new Map<number, Pending>()
  private nextId = 1

  private spawn(): Worker {
    const w = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (
      e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>,
    ) => {
      const p = this.pending.get(e.data.id)
      this.pending.delete(e.data.id)
      this.busy.set(w, (this.busy.get(w) ?? 1) - 1)
      if (!p) return
      if (e.data.ok) p.resolve(e.data.result)
      else p.reject(new Error(e.data.error ?? 'Import failed'))
    }
    this.workers.push(w)
    this.busy.set(w, 0)
    return w
  }

  private pick(): Worker {
    const max = Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2)))
    const idle = this.workers.find((w) => (this.busy.get(w) ?? 0) === 0)
    if (idle) return idle
    if (this.workers.length < max) return this.spawn()
    return this.workers.reduce((a, b) =>
      (this.busy.get(a) ?? 0) <= (this.busy.get(b) ?? 0) ? a : b,
    )
  }

  run<T>(kind: 'import' | 'analyze', file: File): Promise<T> {
    const w = this.pick()
    const id = this.nextId++
    this.busy.set(w, (this.busy.get(w) ?? 0) + 1)
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      w.postMessage({ id, kind, file })
    })
  }
}

let pool: WorkerPool | null = null
const getPool = () => {
  pool ??= new WorkerPool()
  return pool
}

export const ACCEPTED_TYPES =
  'image/*,.dng,.cr2,.cr3,.crw,.nef,.nrw,.arw,.srf,.sr2,.raf,.orf,.rw2,.pef,.srw,.3fr,.iiq,.erf,.kdc,.dcr,.mrw,.x3f'

export function importFile(file: File): Promise<ImportResult> {
  return getPool().run<ImportResult>('import', file)
}

export function analyzeFile(file: File): Promise<PhotoStats> {
  return getPool().run<PhotoStats>('analyze', file)
}

/** Runs imports with bounded concurrency, reporting progress. */
export async function importFiles(
  files: File[],
  onEach: (result: ImportResult | null, file: File, error?: Error) => void | Promise<void>,
): Promise<void> {
  let i = 0
  const lanes = Math.min(4, files.length)
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      while (i < files.length) {
        const file = files[i++] as File
        try {
          await onEach(await importFile(file), file)
        } catch (err) {
          await onEach(null, file, err as Error)
        }
      }
    }),
  )
}

export type { ImportResult }
