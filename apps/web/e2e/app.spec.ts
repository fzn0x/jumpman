import { expect, type Page, test } from '@playwright/test'

/** Mean RGB of a 5 x 5 patch of the edited preview at a relative position. */
function sample(page: Page, fx: number, fy: number): Promise<number[]> {
  return page.evaluate(
    ([fx, fy]) => {
      const c = document.querySelector('canvas[aria-label^="Edited preview"]') as HTMLCanvasElement
      const t = document.createElement('canvas')
      t.width = c.width
      t.height = c.height
      const g = t.getContext('2d') as CanvasRenderingContext2D
      g.drawImage(c, 0, 0)
      const x = Math.floor((fx as number) * c.width) - 2
      const y = Math.floor((fy as number) * c.height) - 2
      const d = g.getImageData(x, y, 5, 5).data
      const sum = [0, 0, 0]
      for (let i = 0; i < d.length; i += 4)
        for (let k = 0; k < 3; k++) sum[k] = (sum[k] as number) + (d[i + k] as number)
      return sum.map((v) => v / 25)
    },
    [fx, fy],
  )
}

const diff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? 0))))

/** Waits until the preview stops changing (the full preview replaces the thumbnail). */
async function settled(page: Page, fx: number, fy: number): Promise<number[]> {
  let last = await sample(page, fx, fy)
  for (let stable = 0; stable < 3; ) {
    await page.waitForTimeout(250)
    const next = await sample(page, fx, fy)
    stable = diff(next, last) < 0.5 ? stable + 1 : 0
    last = next
  }
  return last
}

test.describe('batch editing', () => {
  test('imports samples, edits them together and exports a zip', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Spring Pink samples/ }).click()
    await expect(page).toHaveURL(/#\/c\//)
    await expect(page.locator('main canvas')).toHaveCount(10, { timeout: 60_000 })

    await page.getByRole('button', { name: /^All$/ }).click()
    await page.getByRole('button', { name: /Edit these images/ }).click()
    await expect(page.getByRole('img', { name: /Edited preview/ })).toBeVisible()

    // Global edit through the dial.
    await page
      .getByRole('button', { name: /^Exposure/ })
      .last()
      .click()
    await page.getByRole('slider', { name: 'Exposure' }).focus()
    await page.keyboard.press('Shift+ArrowRight')
    await expect(page.getByRole('button', { name: /^Exposure \+0\.50/ }).last()).toBeVisible()

    // Individual override shows the reset indicator.
    await page.getByRole('button', { name: 'Individual' }).click()
    await page.getByRole('button', { name: 'Next photo' }).click()
    await page.getByRole('slider', { name: 'Exposure' }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('button', { name: /Reset photo/ })).toBeVisible()

    // Undo removes it again.
    await page.getByRole('button', { name: 'Undo' }).first().click()
    await expect(page.getByRole('button', { name: /Reset photo/ })).toHaveCount(0)

    // Export.
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: /Export…/ }).click()
    await page.getByRole('button', { name: /^1080$/ }).click()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: /Download ZIP/ }).click()
    expect((await download).suggestedFilename()).toBe('spring-pink.zip')
  })

  test('returns to the collection when leaving the editor', async ({ page }) => {
    const errors: Error[] = []
    page.on('pageerror', (e) => errors.push(e))
    await page.goto('/')
    await page.getByRole('button', { name: /Spring Pink samples/ }).click()
    await expect(page.locator('main canvas')).toHaveCount(10, { timeout: 60_000 })
    const edit = page.getByRole('button', { name: /Edit these images/ })

    await page.getByRole('button', { name: /^All$/ }).click()
    await edit.click()
    await expect(page.getByRole('img', { name: /Edited preview/ })).toBeVisible()
    await page.getByRole('button', { name: 'Back to collection' }).click()
    await expect(edit).toBeVisible()

    await page.getByRole('button', { name: /^All$/ }).click()
    await edit.click()
    await expect(page.getByRole('img', { name: /Edited preview/ })).toBeVisible()
    await page.goBack()
    await expect(edit).toBeVisible()
    expect(errors).toEqual([])
  })

  test('paints a brush mask stroke and undoes it', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Spring Pink samples/ }).click()
    await expect(page.locator('main canvas')).toHaveCount(10, { timeout: 60_000 })
    await page.getByRole('button', { name: /^All$/ }).click()
    await page.getByRole('button', { name: /Edit these images/ }).click()
    await expect(page.getByRole('img', { name: /Edited preview/ })).toBeVisible()
    await page
      .getByRole('navigation', { name: 'Editing tools' })
      .getByRole('button', { name: 'Layers' })
      .click()

    const under = await settled(page, 0.5, 0.5)
    const away = await sample(page, 0.5, 0.06)

    await page.getByRole('button', { name: 'Add layer' }).click()
    await page.getByRole('menuitem', { name: /Brush adjust/ }).click()
    await expect(page.getByRole('region', { name: 'Brush' })).toBeVisible()
    const surface = page.getByRole('application', { name: /Paint the mask/ })
    const box = await surface.boundingBox()
    if (!box) throw new Error('no paint surface')
    // An empty brush mask leaves the photo untouched.
    expect(diff(await settled(page, 0.5, 0.5), under)).toBeLessThanOrEqual(2)

    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 12 })
    await page.mouse.up()

    await expect.poll(async () => diff(await sample(page, 0.5, 0.5), under)).toBeGreaterThan(6)
    expect(diff(await sample(page, 0.5, 0.06), away)).toBeLessThanOrEqual(2)

    await page.getByRole('button', { name: 'Undo' }).first().click()
    await expect.poll(async () => diff(await sample(page, 0.5, 0.5), under)).toBeLessThanOrEqual(2)
  })

  test('offers the community presets offline', async ({ page }) => {
    await page.goto('/#/presets')
    await expect(page.getByRole('heading', { name: 'Kyoto Blossom' })).toBeVisible()
  })
})
