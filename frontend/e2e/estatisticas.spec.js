import { expect, test } from '@playwright/test'
import { abrirLivro, irAoTexto, isolarDados } from './ajudantes.js'

// Também roda no servidor: isolarDados não deixa a leitura do teste entrar nas estatísticas reais.
test.use({ serviceWorkers: 'block' })
test.beforeEach(({ page }) => isolarDados(page))

test('a leitura conta tempo e páginas, sobe para o servidor e aparece em Estatísticas', async ({ page }) => {
  const enviados = []
  await page.route('**/api/books/*/reading/*', (rota) => {
    enviados.push({ url: rota.request().url(), corpo: rota.request().postDataJSON() })
    return rota.fulfill({ status: 204 })
  })

  await abrirLivro(page, 'Quincas Borba')
  await irAoTexto(page)
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Próxima' }).click()
  await page.waitForTimeout(4000)
  await page.getByRole('button', { name: 'Voltar' }).click()

  await expect.poll(() => enviados.length).toBeGreaterThan(0)
  const { url, corpo } = enviados.at(-1)
  expect(url).toMatch(/\/reading\/\d{4}-\d{2}-\d{2}$/)
  expect(corpo.seconds).toBeGreaterThanOrEqual(6)
  expect(corpo.pages).toBeGreaterThan(0)
  expect(corpo.book_pages).toBeGreaterThan(100)

  await page.getByRole('button', { name: 'Estatísticas' }).click()
  await expect(page.getByRole('heading', { name: 'Estatísticas' })).toBeVisible()
  const hoje = page.locator('.numero').filter({ hasText: 'Hoje' })
  await expect(hoje).toContainText('menos de 1 min')
  await expect(hoje).toContainText(/\d+ páginas?/)
  await expect(page.getByRole('button', { name: /: menos de 1 min · \d+ páginas?$/ }).first()).toBeVisible()
})
