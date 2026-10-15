import { BUILTIN_LUT_PREFIX, builtinLut, type Lut3D, type LutResolver } from '@jumpman/core'
import { blobDb } from './db.ts'

export const CUSTOM_LUT_PREFIX = 'custom:'

const custom = new Map<string, Lut3D>()

export const lutKey = (id: string) => `lut:${id}`

export function registerLut(id: string, lut: Lut3D): void {
  custom.set(id, lut)
}

export function unregisterLut(id: string): void {
  custom.delete(id)
}

export async function persistLut(id: string, lut: Lut3D): Promise<void> {
  registerLut(id, lut)
  await blobDb.set(lutKey(id), lut.data.buffer.slice(0) as ArrayBuffer)
}

export async function loadLut(
  id: string,
  size: number,
  title?: string,
): Promise<Lut3D | undefined> {
  const buf = await blobDb.getBuffer(lutKey(id))
  if (!buf) return undefined
  const lut: Lut3D = { size, data: new Float32Array(buf), ...(title ? { title } : {}) }
  registerLut(id, lut)
  return lut
}

/** Resolves built-in LUTs (baked on demand) and user LUTs (loaded at startup). */
export const resolveLut: LutResolver = (id) => {
  if (id.startsWith(BUILTIN_LUT_PREFIX)) return builtinLut(id)
  return custom.get(id)
}
