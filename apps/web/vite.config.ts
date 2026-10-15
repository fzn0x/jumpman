import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the app from /jumpman/app/; Capacitor and self-hosting use relative paths.
const base = process.env.JUMPMAN_BASE ?? './'

export default defineConfig({
  base,
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
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: null,
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
})
