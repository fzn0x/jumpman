/** Site-wide URLs. Every internal link goes through `withBase` so the site works under any base path. */

const rawBase = import.meta.env.BASE_URL
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`

/** Prefixes a path inside this site with the configured base (`/jumpman/` on GitHub Pages). */
export function withBase(path = ''): string {
  return `${base}${path.replace(/^\/+/, '')}`
}

const repo = 'https://github.com/fzn0x/jumpman'

export const links = {
  home: withBase(),
  app: withBase('app/'),
  presets: withBase('presets/'),
  galleryJson: withBase('presets/index.json'),
  features: `${withBase()}#features`,
  install: `${withBase()}#install`,
  repo,
  releases: `${repo}/releases/latest`,
  issues: `${repo}/issues`,
  contributing: `${repo}/blob/main/CONTRIBUTING.md`,
  communityPresets: `${repo}/blob/main/community/README.md`,
  communityFolder: `${repo}/tree/main/community/presets`,
  license: `${repo}/blob/main/LICENSE`,
} as const

export const SITE_NAME = 'Jumpman'
export const TAGLINE = 'Edit multiple photos at once.'
