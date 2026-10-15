// Validates every community preset: `node scripts/validate-presets.ts`
import { readdirSync, readFileSync } from 'node:fs'
import { parsePreset } from '../packages/core/src/index.ts'

const dir = new URL('../community/presets/', import.meta.url)
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
const ids = new Set<string>()
let failed = 0
for (const file of files) {
  try {
    const raw = JSON.parse(readFileSync(new URL(file, dir), 'utf8'))
    const p = parsePreset(raw)
    if (p.layers.length !== raw.layers.length) throw new Error('contains invalid layers')
    if (!p.author) throw new Error('missing author')
    if (ids.has(p.id)) throw new Error(`duplicate id ${p.id}`)
    ids.add(p.id)
    console.log(`ok  ${file}  ${p.name} by ${p.author}`)
  } catch (err) {
    failed++
    console.error(`ERR ${file}: ${(err as Error).message}`)
  }
}
if (failed) process.exit(1)
console.log(`${files.length} presets valid`)
