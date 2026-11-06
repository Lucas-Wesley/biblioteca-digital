import { expect, test } from '@playwright/test'
import { conteudo, isolarDados } from './ajudantes.js'

// Também roda no servidor: a busca só lê, e isolarDados não deixa o livro aberto mudar o progresso real.
test.use({ serviceWorkers: 'block' })
test.beforeEach(({ page }) => isolarDados(page))

test('busca no texto dos livros e abre o livro no trecho achado', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Buscar nos meus livros' }).click()
  await expect(page.getByRole('heading', { name: 'Buscar nos meus livros' })).toBeVisible()

  // Sem acento e com outra forma da palavra: "humanitas" acha "Humanitas".
  await page.getByRole('searchbox', { name: 'O que buscar nos livros' }).fill('humanitas vencedor batatas')
  await page.getByRole('button', { name: 'Buscar', exact: true }).click()
  const primeiro = page.locator('.resultados button').first()
  await expect(primeiro).toContainText('Quincas Borba')
  await expect(primeiro.locator('mark').first()).toBeVisible()

  await primeiro.click()
  await expect(page.locator('.leitor')).toHaveAttribute('data-localizacao', /href/)
  await expect(conteudo(page).locator('body')).toContainText(/batatas/i)

  // Voltar traz a busca de antes.
  await page.getByRole('button', { name: 'Voltar' }).click()
  await expect(page.locator('.resultados button').first()).toContainText('Quincas Borba')
})
