import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// GitHub Pages serves the app from /jumpman/app/; Capacitor and self-hosting use relative paths.
const base = process.env.JUMPMAN_BASE ?? './'

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Jumpman — batch photo editor',
        short_name: 'Jumpman',
        description: 'Edit multiple photos at once. Offline-first, open source.',
        theme_color: '#1C1C1E',
        background_color: '#1C1C1E',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        categories: ['photo', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        file_handlers: [
          {
            action: '.',
            accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.heic', '.dng'] },
          },
        ],
      },
      workbox: {
        // wasm: the LibRaw decoder (about 1.4 MB), so RAW files open offline.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: null,
        // On-device segmentation (runtimes and models, about 45 MB) is too large to precache
        // for every visitor. Each part is cached the first time a mask needs it, then works offline.
        globIgnores: ['**/vision_wasm_*', '**/ort-wasm-*'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(magic_touch|sky_b1|vision_wasm_|ort-wasm-)[^/]*$/,
            handler: 'CacheFirst',
            options: { cacheName: 'jumpman-segmentation', expiration: { maxEntries: 8 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2023',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  // Pre-bundle lazily imported deps so the dev server never reloads mid-import.
  // libraw-wasm is plain ESM that loads its worker and wasm from next to itself; serve it as is.
  optimizeDeps: {
    include: ['exifr', 'fflate', 'idb-keyval', 'zustand', 'workbox-window', '@capacitor/core'],
    exclude: ['libraw-wasm'],
  },
})
