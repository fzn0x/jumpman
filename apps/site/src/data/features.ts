/** Everything Jumpman does (and will do), rendered into the landing page's feature sections. */

export type FeatureStatus = 'available' | 'roadmap'

export interface Feature {
  title: string
  description: string
  status: FeatureStatus
  /** Optional inline illustration rendered under the description. */
  demo?: 'luts'
}

export interface FeatureGroup {
  id: string
  title: string
  intro: string
  features: Feature[]
}

const available = (title: string, description: string): Feature => ({
  title,
  description,
  status: 'available',
})

const roadmap = (title: string, description: string): Feature => ({
  title,
  description,
  status: 'roadmap',
})

export const featureGroups: FeatureGroup[] = [
  {
    id: 'batch-editing',
    title: 'Batch editing',
    intro:
      'The core of Jumpman: a batch that behaves like a single photo, until you want it not to.',
    features: [
      available(
        'Collections',
        'Photos live in collections like “Spring Pink”. Multi-select the shots you want, tap “Edit these images”, and they open as one batch.',
      ),
      available(
        'Global edit with a summary bar',
        'Set brightness, exposure, highlights, shadows and saturation once for the whole batch. A summary bar keeps every change in view.',
      ),
      available(
        'Global or Individual',
        'One toggle switches between editing the batch and fine-tuning a single photo. A dot indicator flips you through the set, photo by photo.',
      ),
      available(
        'Layers',
        'Stack Adjust, LUT, Curves, HSL and Split toning layers. Add, edit, delete and reorder them, and give each its own opacity.',
      ),
      available(
        'A panel made for precision',
        'A dial-style slider for fine moves, a live histogram, and a before/after compare that is always one tap away.',
      ),
    ],
  },
  {
    id: 'pro-workflow',
    title: 'Pro workflow',
    intro:
      'The tools a working photographer reaches for, rebuilt for sets of photos instead of single frames.',
    features: [
      available(
        'Presets and recipes',
        'Save any edit as a preset, then share it as a link or a file.',
      ),
      available(
        'Copy and paste edits',
        'Copy an edit from one photo and paste it onto any selection.',
      ),
      available(
        'Auto-match exposure and white balance',
        'Even out a set shot under mixed lighting, so the window-lit and lamp-lit frames finally agree.',
      ),
      available(
        'Smart selection',
        'Select by similarity, by time range or moment, by scene type, or by color palette.',
      ),
      available(
        'Per-photo override indicator',
        'See at a glance which photos differ from the batch, and reset any of them with one tap.',
      ),
      available('Batch before/after grid', 'Review the whole set before and after, side by side.'),
      available(
        'Masking and local adjustments',
        'Linear, radial, luminance and color-range masks, plus heuristic sky and subject masks that adapt to each photo in the batch.',
      ),
      available(
        'Bulk crop and aspect ratios',
        'Crop everything to 1:1, 4:5, 3:4, 9:16 and more, then reposition the framing image by image.',
      ),
      available(
        'Batch export',
        'Resize and export to JPEG, PNG, WebP or AVIF with quality control, watermarks and filename patterns, as a ZIP or straight to the share sheet.',
      ),
      available(
        'Non-destructive history',
        'Per-batch undo and redo, and a one-step revert of the whole collection to the originals.',
      ),
      {
        ...available(
          'Advanced color',
          'Curves, 8-band HSL, split toning and 15 built-in LUTs with live previews. Import and export .cube files.',
        ),
        demo: 'luts',
      },
      available(
        'RAW files and Lightroom XMP',
        'Opens RAW files through their embedded full-size previews (DNG, CR2/CR3, NEF, ARW, RAF, ORF, RW2 and more). Imports and exports XMP compatible with Lightroom, and imports Capture One styles.',
      ),
    ],
  },
  {
    id: 'only-in-jumpman',
    title: 'Only in Jumpman',
    intro:
      'Ideas you won’t find in other editors, built for the moment you have forty photos and one evening.',
    features: [
      available(
        'Reference-match',
        'Pick a hero photo and the rest of the batch matches its tone and color.',
      ),
      available(
        'Edit from a sample image',
        'Drop in any photo you love and get a LUT that approximates its look.',
      ),
      available(
        'Consistency score',
        'See how cohesive the set really is, then press Harmonize to pull the outliers into line.',
      ),
      available(
        'Adaptive global edits',
        'Exposure +0.6 means “bring everything to this brightness”, not “add 0.6 to everything”, so dark and bright shots land in the same place.',
      ),
      available(
        'Edit by description',
        'Type “warmer, softer highlights, slightly faded” and get real slider moves. It runs fully offline.',
      ),
      available(
        'Scene-aware auto edit',
        'An auto edit that knows what it’s looking at: sky, skin, foliage and architecture each get the right treatment.',
      ),
      available(
        'Series mode',
        'Deflicker a time-lapse, or shift color gradually from the first photo to the last.',
      ),
      available(
        'Community preset gallery',
        'Preview community presets on your own batch before you save one, then fork and remix it.',
      ),
      available(
        'Version branches',
        'Keep a “warm” and a “moody” take of the same batch and compare them side by side.',
      ),
      available(
        'Edit replay',
        'Record a session as steps and replay it on a new batch, like a macro.',
      ),
      available(
        'Collaborative review',
        'Send a client a small review file. They comment, approve and suggest edits that show up as proposed layers. No server needed.',
      ),
      available(
        'Platform-aware export',
        'Preview your Instagram grid and carousels, auto-crop to fit, and drag photos into order.',
      ),
      available(
        'Offline-first PWA',
        'Install it once and edit on a plane. Everything is stored locally on your device.',
      ),
    ],
  },
  {
    id: 'roadmap',
    title: 'On the roadmap',
    intro: 'Where Jumpman is headed next. Want one of these sooner? Help build it on GitHub.',
    features: [
      roadmap(
        'End-to-end encrypted sync',
        'Keep collections in sync across your devices, encrypted before they leave each one.',
      ),
      roadmap('Real-time collaboration', 'Edit the same batch together, live.'),
      roadmap(
        'AI segmentation masks',
        'Sharper subject and object masks from models that run on your device.',
      ),
      roadmap('Brush masks', 'Paint an adjustment exactly where you want it.'),
      roadmap(
        'Full RAW decoding',
        'Decode sensor data directly with LibRaw compiled to WebAssembly.',
      ),
      roadmap(
        'Publish presets from the app',
        'Upload a preset to the community gallery without leaving Jumpman.',
      ),
    ],
  },
]

export function featureGroup(id: string): FeatureGroup {
  const group = featureGroups.find((g) => g.id === id)
  if (!group) throw new Error(`Unknown feature group: ${id}`)
  return group
}

export const builtWith = [
  'TypeScript 7',
  'React 19',
  'Vite 8',
  'WebGL2',
  'Tailwind CSS 4',
  'Astro 7',
  'Capacitor 8 (Android)',
  'PWA + IndexedDB',
]
