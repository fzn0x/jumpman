import {
  ArrowLeft,
  ExternalLink,
  FileUp,
  HardDrive,
  Images,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { TopBar, Wordmark } from '../components/Chrome.tsx'
import { requestPersistence, storageEstimate } from '../lib/db.ts'
import { bytes } from '../lib/format.ts'
import { pickFiles } from '../lib/hooks.ts'
import { openReviewFile } from '../lib/reviewImport.ts'
import { loadSamples } from '../lib/samples.ts'
import type { RawDecoder } from '../lib/types.ts'
import { toast } from '../state/editor.ts'
import { resetEverything, updateSettings, useLibrary } from '../state/library.ts'
import { navigate } from '../state/router.ts'
import { Button, Chip, IconButton, SectionTitle } from '../ui/primitives.tsx'

const RAW_DECODERS: { value: RawDecoder; label: string; description: string }[] = [
  {
    value: 'libraw',
    label: 'Full quality (LibRaw)',
    description:
      'Decodes the sensor data with LibRaw for full resolution and color. Takes a few seconds per photo and more memory.',
  },
  {
    value: 'preview',
    label: 'Fast (embedded preview)',
    description:
      'Opens the JPEG preview the camera stored in the file. Quick, but its size and quality depend on the camera.',
  },
]

export function SettingsScreen() {
  const settings = useLibrary((s) => s.settings)
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => {
    void storageEstimate().then(setUsage)
    void navigator.storage?.persisted?.().then(setPersisted)
  }, [])
  return (
    <div className="min-h-full pb-16">
      <TopBar
        left={
          <>
            <IconButton
              icon={ArrowLeft}
              label="Back"
              onClick={() => navigate({ name: 'library' })}
            />
            <h1 className="pl-1 font-display text-lg font-bold">Settings</h1>
          </>
        }
      />
      <main className="mx-auto max-w-xl px-4 pt-2 sm:px-5">
        <SectionTitle>You</SectionTitle>
        <label className="block text-sm">
          <span className="text-mute">Name on comments, presets and remixes</span>
          <input
            defaultValue={settings.author}
            onBlur={(e) => updateSettings({ author: e.target.value.trim() })}
            placeholder="Your name or handle"
            className="mt-1 h-11 w-full rounded-2xl bg-ink-2 px-4 outline-none focus:ring-2 focus:ring-salmon"
          />
        </label>

        <SectionTitle>RAW decoding</SectionTitle>
        <fieldset>
          <legend className="sr-only">RAW decoding</legend>
          <div className="flex flex-wrap gap-2">
            {RAW_DECODERS.map((d) => (
              <Chip
                key={d.value}
                active={settings.rawDecoder === d.value}
                onClick={() => updateSettings({ rawDecoder: d.value })}
              >
                {d.label}
              </Chip>
            ))}
          </div>
        </fieldset>
        <p className="mt-2 text-xs leading-relaxed text-mute">
          {RAW_DECODERS.find((d) => d.value === settings.rawDecoder)?.description} Applies to RAW
          files you import from now on. If a file cannot be decoded, Jumpman uses its preview.
        </p>

        <SectionTitle>Storage</SectionTitle>
        <div className="space-y-3 rounded-3xl bg-ink-2 p-4 text-sm">
          <p className="flex items-center gap-3">
            <HardDrive className="size-5 text-mute" />
            {usage
              ? `${bytes(usage.usage)} used of ${bytes(usage.quota)} available`
              : 'Storage size unavailable'}
          </p>
          <p className="flex items-center gap-3">
            <ShieldCheck className="size-5 text-mute" />
            {persisted
              ? 'Protected from automatic cleanup'
              : 'The browser may clear data when space runs low'}
          </p>
          {!persisted && (
            <Button size="sm" onClick={() => void requestPersistence().then(setPersisted)}>
              Keep my photos safe
            </Button>
          )}
          <p className="text-xs leading-relaxed text-mute">
            Everything stays on this device: photos, edits and presets. Nothing is uploaded. Cloud
            sync is on the roadmap.
          </p>
        </div>

        <SectionTitle>Get started</SectionTitle>
        <div className="grid gap-2">
          <Button
            icon={Images}
            onClick={async () => {
              const id = await loadSamples()
              navigate({ name: 'collection', id })
            }}
          >
            Load the Spring Pink samples
          </Button>
          <Button
            icon={FileUp}
            onClick={async () => {
              const [f] = await pickFiles('.json,application/json', false)
              if (!f) return
              try {
                const id = await openReviewFile(f)
                navigate({ name: 'collection', id })
              } catch (e) {
                toast((e as Error).message)
              }
            }}
          >
            Open a review file
          </Button>
        </div>

        <SectionTitle>About</SectionTitle>
        <div className="rounded-3xl bg-ink-2 p-4 text-sm">
          <Wordmark className="h-7" />
          <p className="mt-3 leading-relaxed text-white/80">
            Edit multiple photos at once. Free and open source under the MIT license.
          </p>
          <p className="mt-1 text-xs text-mute">Version {__APP_VERSION__}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-xs font-semibold hover:bg-white/15"
              href="https://github.com/fzn0x/jumpman"
              target="_blank"
              rel="noreferrer"
            >
              GitHub <ExternalLink className="size-3" />
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-xs font-semibold hover:bg-white/15"
              href="https://github.com/fzn0x/jumpman/releases"
              target="_blank"
              rel="noreferrer"
            >
              Releases <ExternalLink className="size-3" />
            </a>
            <a
              className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1.5 text-xs font-semibold hover:bg-white/15"
              href="https://github.com/fzn0x/jumpman/issues/new/choose"
              target="_blank"
              rel="noreferrer"
            >
              Report an issue <ExternalLink className="size-3" />
            </a>
          </div>
        </div>

        <SectionTitle>Danger zone</SectionTitle>
        <Button
          variant="danger"
          icon={Trash2}
          onClick={() => {
            if (
              confirm(
                'Delete all photos, edits and presets from this device? This cannot be undone.',
              )
            )
              void resetEverything()
          }}
        >
          Delete all data on this device
        </Button>
      </main>
    </div>
  )
}
