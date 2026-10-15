import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'library' }
  | { name: 'collection'; id: string }
  | { name: 'editor'; batchId: string; view: 'single' | 'grid' | 'social' }
  | { name: 'presets' }
  | { name: 'settings' }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0] ?? ''
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'c' && parts[1]) return { name: 'collection', id: parts[1] }
  if (parts[0] === 'e' && parts[1]) {
    const view = parts[2] === 'grid' ? 'grid' : parts[2] === 'social' ? 'social' : 'single'
    return { name: 'editor', batchId: parts[1], view }
  }
  if (parts[0] === 'presets') return { name: 'presets' }
  if (parts[0] === 'settings') return { name: 'settings' }
  return { name: 'library' }
}

export function hrefOf(route: Route): string {
  switch (route.name) {
    case 'library':
      return '#/'
    case 'collection':
      return `#/c/${route.id}`
    case 'editor':
      return `#/e/${route.batchId}${route.view === 'single' ? '' : `/${route.view}`}`
    case 'presets':
      return '#/presets'
    case 'settings':
      return '#/settings'
  }
}

export function navigate(route: Route, replace = false): void {
  const href = hrefOf(route)
  if (replace) history.replaceState(null, '', href)
  else history.pushState(null, '', href)
  dispatchEvent(new HashChangeEvent('hashchange'))
}

const subscribe = (cb: () => void) => {
  addEventListener('hashchange', cb)
  return () => removeEventListener('hashchange', cb)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash)
  return parseHash(hash)
}

/** A one-off deep link fragment like `#preset=...` (consumed by the app). */
export function takeDeepLink(): { preset?: string } {
  const m = location.hash.match(/^#preset=([\w-]+)/)
  if (!m) return {}
  history.replaceState(null, '', '#/presets')
  return { preset: m[1] as string }
}
