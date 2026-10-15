import { expect, test } from '@playwright/test'

interface ParityResult {
  name: string
  max: number
  mean: number
}

test('the WebGL2 renderer matches the CPU reference pipeline', async ({ page }) => {
  await page.goto('/e2e/parity.html')
  const results = await page.waitForFunction(
    () => (window as unknown as { parity?: ParityResult[] }).parity,
    null,
    {
      timeout: 30_000,
    },
  )
  const parity = (await results.jsonValue()) as ParityResult[]
  for (const r of parity) {
    // Allow for float precision and 8/16-bit intermediate targets.
    expect.soft(r.mean, `${r.name}: mean difference`).toBeLessThan(1.5)
    expect.soft(r.max, `${r.name}: max difference`).toBeLessThanOrEqual(8)
  }
})
