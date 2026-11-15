import { readFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { buildDng } from './dng.ts'

type Upload = { name: string; mimeType: string; buffer: Buffer }

async function importFiles(page: Page, files: Upload[]) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import photos' }).click()
  await (await chooser).setFiles(files)
  await expect(page).toHaveURL(/#\/c\//)
}

/** Size of the first grid thumbnail and the color at the top and bottom of its middle column. */
function readThumb(page: Page) {
  return page
    .locator('main canvas')
    .first()
    .evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')
      if (!ctx || c.width === 300) return null
      const px = (y: number) => [...ctx.getImageData(c.width >> 1, y, 1, 1).data.slice(0, 3)]
      return {
        width: c.width,
        height: c.height,
        top: px(Math.floor(c.height * 0.15)),
        bottom: px(Math.floor(c.height * 0.85)),
      }
    })
}

const dng = (orientation: number): Upload => ({
  name: 'synthetic.dng',
  mimeType: 'image/x-adobe-dng',
  buffer: buildDng({ orientation }),
})

test.describe('camera RAW', () => {
  test('decodes the sensor data with LibRaw and applies the orientation', async ({ page }) => {
    await page.goto('/')
    // The DNG has no embedded preview, so it can only open through LibRaw.
    await importFiles(page, [dng(6)])
    await expect(page.locator('main canvas')).toHaveCount(1, { timeout: 60_000 })
    await expect(page.getByText('DNG', { exact: true })).toBeVisible()
    await expect.poll(() => readThumb(page), { timeout: 30_000 }).not.toBeNull()
    const thumb = await readThumb(page)
    // A 96x64 sensor rotated 90 degrees: the red left half ends up on top.
    expect(thumb).toMatchObject({ width: 64, height: 96 })
    const [tr = 0, , tb = 0] = thumb?.top ?? []
    const [br = 0, , bb = 0] = thumb?.bottom ?? []
    expect(tr).toBeGreaterThan(tb + 80)
    expect(bb).toBeGreaterThan(br + 80)
    await expect(page.getByText(/couldn.t be imported/)).toHaveCount(0)
  })

  test('falls back to the embedded preview when LibRaw cannot decode', async ({ page }) => {
    const jpeg = readFileSync(new URL('../public/samples/01-blossom-branch.jpg', import.meta.url))
    // Not a format LibRaw knows, but it carries a full JPEG preview.
    const fake = Buffer.concat([Buffer.alloc(64), jpeg, Buffer.alloc(64)])
    await page.goto('/')
    await importFiles(page, [{ name: 'unknown.nef', mimeType: 'image/x-nikon-nef', buffer: fake }])
    await expect(page.locator('main canvas')).toHaveCount(1, { timeout: 60_000 })
    await expect(page.getByText('NEF', { exact: true })).toBeVisible()
    await expect(page.getByText(/couldn.t be imported/)).toHaveCount(0)
  })

  test('skips LibRaw when RAW decoding is set to fast', async ({ page }) => {
    await page.goto('/#/settings')
    await page.getByRole('button', { name: 'Fast (embedded preview)' }).click()
    await expect(page.getByRole('button', { name: 'Fast (embedded preview)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.getByRole('button', { name: 'Back' }).click()
    await importFiles(page, [dng(1)])
    await expect(page.getByText(/couldn.t be imported/)).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(/no embedded preview/)).toBeVisible()
  })
})
