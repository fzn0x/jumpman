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

test('finds the subject on the device and brightens only it', async ({ page }) => {
  test.slow()
  await page.goto('/')
  await page.getByRole('button', { name: /Spring Pink samples/ }).click()
  await expect(page.locator('main canvas')).toHaveCount(10, { timeout: 60_000 })
  await page.getByRole('button', { name: /^All$/ }).click()
  await page.getByRole('button', { name: /Edit these images/ }).click()
  await expect(page.getByRole('img', { name: /Edited preview/ })).toBeVisible()
  // The fourth sample is a portrait against a pale sky and field.
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next photo' }).click()
  await page
    .getByRole('navigation', { name: 'Editing tools' })
    .getByRole('button', { name: 'Layers' })
    .click()

  // Her face (inside the subject) and the sky above the field (outside it).
  const face = await settled(page, 0.47, 0.32)
  const sky = await sample(page, 0.12, 0.12)

  await page.getByRole('button', { name: 'Add layer' }).click()
  await page.getByRole('menuitem', { name: /Subject adjust/ }).click()
  // Expand the new layer to see where its mask comes from.
  await page.getByRole('button', { name: /^Subject adjust/ }).click()
  await expect(page.locator('[data-kind="subject"][data-mask-source="ready"]')).toBeVisible({
    timeout: 60_000,
  })

  await expect.poll(async () => diff(await sample(page, 0.47, 0.32), face)).toBeGreaterThan(6)
  expect(diff(await settled(page, 0.12, 0.12), sky)).toBeLessThanOrEqual(2)
})

test('finds the sky on the device and darkens only it', async ({ page }) => {
  test.slow()
  await page.goto('/')
  await page.getByRole('button', { name: /Spring Pink samples/ }).click()
  await expect(page.locator('main canvas')).toHaveCount(10, { timeout: 60_000 })
  await page.getByRole('button', { name: /^All$/ }).click()
  await page.getByRole('button', { name: /Edit these images/ }).click()
  await expect(page.getByRole('img', { name: /Edited preview/ })).toBeVisible()
  // The seventh sample is a pier under a clear sky.
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next photo' }).click()
  await page
    .getByRole('navigation', { name: 'Editing tools' })
    .getByRole('button', { name: 'Layers' })
    .click()

  const sky = await settled(page, 0.5, 0.12)
  const pier = await sample(page, 0.5, 0.88)

  await page.getByRole('button', { name: 'Add layer' }).click()
  await page.getByRole('menuitem', { name: /Sky adjust/ }).click()
  await page.getByRole('button', { name: /^Sky adjust/ }).click()
  await expect(page.locator('[data-kind="sky"][data-mask-source="ready"]')).toBeVisible({
    timeout: 60_000,
  })

  await expect.poll(async () => diff(await sample(page, 0.5, 0.12), sky)).toBeGreaterThan(6)
  expect(diff(await settled(page, 0.5, 0.88), pier)).toBeLessThanOrEqual(2)
})
