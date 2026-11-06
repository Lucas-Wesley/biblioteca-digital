import { expect, test } from '@playwright/test'
import { remoto } from './ajudantes.js'

test('Ajustes: anota uma sugestão de melhoria, com a tela de onde veio', async ({ page }) => {
  test.skip(remoto, 'grava dados')
  await page.goto('/')
  await page.getByRole('button', { name: 'Buscar livros' }).click()
  await page.getByRole('button', { name: 'Ajustes' }).click()
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible()

  const texto = `Marcar trecho com dois toques ${Date.now()}`
  await page.getByLabel('Sugestão de melhoria').fill(texto)
  await page.getByRole('button', { name: 'Enviar sugestão' }).click()
  const item = page.locator('.sugestao', { hasText: texto })
  await expect(item).toContainText('Nova')

  const sugestao = (await (await page.request.get('/api/sugestoes')).json()).find((s) => s.texto === texto)
  expect(sugestao.tela).toBe('Buscar livros')

  page.once('dialog', (d) => d.accept())
  await item.getByRole('button', { name: 'Apagar sugestão' }).click()
  await expect(item).toHaveCount(0)
})
