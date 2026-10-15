import { createGlobalEdit, type Layer } from '@jumpman/core'
import { useEffect, useRef, useState } from 'react'
import { type FrameSpec, frameOf } from '../lib/geometry.ts'
import { useInView } from '../lib/hooks.ts'
import { renderEdited } from '../lib/thumbs.ts'
import type { Photo } from '../lib/types.ts'
import { activeBranch, useLibrary } from '../state/library.ts'
import { layersFor } from '../state/selectors.ts'
import { cx } from '../ui/primitives.tsx'

const FULL = createGlobalEdit()

/** The current edit of a photo (from its batch), as stored. */
export function useEditedSpec(
  photo: Photo | undefined,
): { layers: Layer[]; frame: FrameSpec } | null {
  const photos = useLibrary((s) => s.photos)
  const batch = useLibrary((s) => (photo?.batchId ? s.batches[photo.batchId] : undefined))
  if (!photo) return null
  if (!batch) return { layers: [], frame: frameOf(photo, FULL, undefined) }
  const branch = activeBranch(batch)
  return {
    layers: layersFor(batch, photos, photo.id),
    frame: frameOf(photo, branch.global, branch.photos[photo.id]),
  }
}

/** Draws an off-screen GPU render of a photo into a canvas. */
export function RenderCanvas({
  photo,
  layers,
  frame,
  maxEdge = 480,
  original,
  className,
  fit = 'cover',
  alt,
}: {
  photo: Photo
  layers: Layer[]
  frame: FrameSpec
  maxEdge?: number
  original?: boolean
  className?: string
  fit?: 'cover' | 'contain'
  alt?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const visible = useInView(ref)
  const [loaded, setLoaded] = useState(false)
  const lutVersion = useLibrary((s) => s.lutVersion)
  const key = `${lutVersion}|${original ? 'o' : JSON.stringify(layers)}|${JSON.stringify(frame)}|${maxEdge}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` captures the render inputs
  useEffect(() => {
    if (!visible) return
    let alive = true
    void renderEdited(photo, layers, frame, maxEdge, { original: !!original }).then((bmp) => {
      const c = ref.current
      if (!alive || !bmp || !c) return
      c.width = bmp.width
      c.height = bmp.height
      c.getContext('2d')?.drawImage(bmp, 0, 0)
      setLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [visible, key, photo.id])
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={alt ?? photo.name}
      className={cx(
        'block bg-ink-2 transition-opacity duration-300',
        fit === 'cover' ? 'object-cover' : 'object-contain',
        loaded ? 'opacity-100' : 'opacity-0',
        className,
      )}
    />
  )
}

/** A photo thumbnail showing its current edit. */
export function EditedThumb({
  photo,
  original,
  maxEdge,
  className,
  fit,
}: {
  photo: Photo
  original?: boolean
  maxEdge?: number
  className?: string
  fit?: 'cover' | 'contain'
}) {
  const spec = useEditedSpec(photo)
  if (!spec) return null
  return (
    <RenderCanvas
      photo={photo}
      layers={spec.layers}
      frame={spec.frame}
      {...(original ? { original } : {})}
      {...(maxEdge ? { maxEdge } : {})}
      {...(className ? { className } : {})}
      {...(fit ? { fit } : {})}
    />
  )
}
