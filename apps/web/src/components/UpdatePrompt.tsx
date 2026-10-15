import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from '../ui/primitives.tsx'

/** Offers to reload when a new version of the PWA has been downloaded. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div className="fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4rem)] z-[70] flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-ink shadow-2xl">
        A new version of Jumpman is ready.
        <Button size="sm" variant="primary" onClick={() => void updateServiceWorker(true)}>
          Reload
        </Button>
        <button type="button" className="text-ink/60" onClick={() => setNeedRefresh(false)}>
          Later
        </button>
      </div>
    </div>
  )
}
