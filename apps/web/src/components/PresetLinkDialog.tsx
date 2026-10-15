import { type Preset, presetFromShareString } from '@jumpman/core'
import { useEffect, useMemo, useState } from 'react'
import { PresetCard } from '../screens/PresetsScreen.tsx'
import { toast } from '../state/editor.ts'
import { useLibrary } from '../state/library.ts'
import { takeDeepLink } from '../state/router.ts'
import { Sheet } from '../ui/primitives.tsx'

/** Handles `#preset=…` share links: preview the preset on your photos, then save or apply. */
export function PresetLinkDialog() {
  const [preset, setPreset] = useState<Preset | null>(null)
  const batches = useLibrary((s) => s.batches)
  const photos = useLibrary((s) => s.photos)
  useEffect(() => {
    const check = () => {
      const { preset: encoded } = takeDeepLink()
      if (!encoded) return
      try {
        setPreset(presetFromShareString(encoded))
      } catch {
        toast('That preset link is damaged or from a newer version.')
      }
    }
    check()
    addEventListener('hashchange', check)
    return () => removeEventListener('hashchange', check)
  }, [])
  const { previews, batchId } = useMemo(() => {
    const batch = Object.values(batches).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const ids = batch?.photoIds ?? Object.keys(photos)
    return {
      previews: ids.slice(0, 3).flatMap((id) => (photos[id] ? [photos[id]] : [])),
      batchId: batch?.id ?? null,
    }
  }, [batches, photos])
  if (!preset) return null
  return (
    <Sheet open onClose={() => setPreset(null)} title="Shared preset">
      <div className="pb-3">
        <PresetCard preset={preset} previews={previews} batchId={batchId} />
      </div>
    </Sheet>
  )
}
