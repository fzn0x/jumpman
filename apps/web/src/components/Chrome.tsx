import { AlertTriangle, Loader2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import wordmark from '../assets/wordmark.svg'
import { useEditor } from '../state/editor.ts'
import { dismissImportErrors, useLibrary } from '../state/library.ts'
import { Button, cx, ProgressBar } from '../ui/primitives.tsx'

export function Wordmark({ className }: { className?: string }) {
  return (
    <img
      src={wordmark}
      alt="Jumpman"
      className={cx('h-6 w-auto select-none', className)}
      draggable={false}
    />
  )
}

export function TopBar({
  left,
  center,
  right,
  className,
}: {
  left?: ReactNode
  center?: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cx(
        'safe-top sticky top-0 z-30 border-b border-white/5 bg-ink/85 backdrop-blur-xl backdrop-saturate-150',
        className,
      )}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-1">{left}</div>
        {center && <div className="flex shrink-0 items-center">{center}</div>}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1">{right}</div>
      </div>
    </header>
  )
}

export function Toaster() {
  const t = useEditor((s) => s.toast)
  if (!t) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-[60] flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm font-medium text-ink shadow-2xl shadow-black/40"
      >
        <span>{t.text}</span>
        {t.action && (
          <button
            type="button"
            className="shrink-0 font-bold text-brand"
            onClick={() => {
              t.action?.run()
              useEditor.setState({ toast: null })
            }}
          >
            {t.action.label}
          </button>
        )}
      </div>
    </div>
  )
}

export function ImportStatus() {
  const p = useLibrary((s) => s.importing)
  if (!p) return null
  const finished = p.done >= p.total
  return (
    <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 flex justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-ink-2/95 p-4 shadow-2xl backdrop-blur">
        {!finished ? (
          <>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Loader2 className="size-4 animate-spin text-salmon" />
              Importing {p.done} of {p.total}
            </div>
            <ProgressBar value={p.done / Math.max(1, p.total)} label="Import progress" />
          </>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-salmon" />
                {p.errors.length} {p.errors.length === 1 ? 'file' : 'files'} couldn’t be imported
              </span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={dismissImportErrors}
                className="text-mute hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
            <ul className="max-h-28 overflow-y-auto text-xs text-mute">
              {p.errors.map((e) => (
                <li key={e} className="truncate">
                  {e}
                </li>
              ))}
            </ul>
            <Button size="sm" className="mt-3" onClick={dismissImportErrors}>
              OK
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
