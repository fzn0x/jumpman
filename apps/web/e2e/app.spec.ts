import { expect, test } from '@playwright/test'

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

  test('offers the community presets offline', async ({ page }) => {
    await page.goto('/#/presets')
    await expect(page.getByRole('heading', { name: 'Kyoto Blossom' })).toBeVisible()
  })
})
