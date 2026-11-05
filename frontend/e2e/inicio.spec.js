import { expect, test } from '@playwright/test'

test('início mostra o menu lateral com a API funcionando', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible()
  const menu = page.getByRole('navigation', { name: 'Menu principal' })
  await expect(menu.getByRole('button', { name: 'Início' })).toBeVisible()
  await expect(menu.getByText('Enviar arquivo')).toBeVisible()
  await expect(page.getByText(/versão/)).toBeVisible()
})

test('no celular, o menu lateral abre pelo botão', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/')
  const menu = page.getByRole('navigation', { name: 'Menu principal' })
  await expect(menu).toBeHidden()
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  await expect(menu.getByText('Enviar arquivo')).toBeVisible()
})
