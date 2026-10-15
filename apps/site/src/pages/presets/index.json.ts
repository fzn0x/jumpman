/** The community gallery feed the web app fetches: `presets/index.json`. */
import type { APIRoute } from 'astro'
import { GALLERY_SCHEMA, loadCommunityPresets } from '../../lib/presets'

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ schema: GALLERY_SCHEMA, presets: loadCommunityPresets() }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
