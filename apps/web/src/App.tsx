import { lazy, Suspense, useEffect } from 'react'
import { ImportStatus, Toaster, Wordmark } from './components/Chrome.tsx'
import { requestPersistence } from './lib/db.ts'
import { CollectionScreen } from './screens/CollectionScreen.tsx'
import { LibraryScreen } from './screens/LibraryScreen.tsx'
import { initLibrary, useLibrary } from './state/library.ts'
import { useRoute } from './state/router.ts'

const EditorScreen = lazy(() =>
  import('./screens/EditorScreen.tsx').then((m) => ({ default: m.EditorScreen })),
)

function Splash() {
  return (
    <div className="grid h-full place-items-center">
      <Wordmark className="h-8 animate-pulse" />
    </div>
  )
}

export function App() {
  const ready = useLibrary((s) => s.ready)
  const route = useRoute()
  useEffect(() => {
    void initLibrary().then(() => requestPersistence())
  }, [])
  if (!ready) return <Splash />
  return (
    <>
      <Suspense fallback={<Splash />}>
        {route.name === 'library' && <LibraryScreen />}
        {route.name === 'collection' && <CollectionScreen key={route.id} id={route.id} />}
        {route.name === 'editor' && (
          <EditorScreen key={route.batchId} batchId={route.batchId} view={route.view} />
        )}
      </Suspense>
      <ImportStatus />
      <Toaster />
    </>
  )
}
