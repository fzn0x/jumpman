// @ts-check
import sitemap from '@astrojs/sitemap'
import { defineConfig } from 'astro/config'

// Served from GitHub Pages at https://fzn0x.github.io/jumpman/ (the editor lives at /jumpman/app/).
// Override the base for other hosts, e.g. `SITE_BASE=/ pnpm --filter @jumpman/site build`.
export default defineConfig({
  site: 'https://fzn0x.github.io',
  base: process.env.SITE_BASE ?? '/jumpman/',
  trailingSlash: 'always',
  output: 'static',
  build: {
    format: 'directory',
    // A handful of small pages: inline the CSS so nothing blocks the first paint.
    inlineStylesheets: 'always',
  },
  integrations: [sitemap({ filter: (page) => !/\/404\/?$/.test(page) })],
})
