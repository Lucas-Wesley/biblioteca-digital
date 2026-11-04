import { expect, test } from '@playwright/test'

test('página inicial mostra o Hello World com a API funcionando', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Hello World' })).toBeVisible()
  await expect(page.getByText(/API ok/)).toBeVisible()
})
