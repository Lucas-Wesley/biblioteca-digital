import { expect, test } from '@playwright/test'
import { botaoDoLivro, isolarDados, remoto } from './ajudantes.js'

// Envia um livro, então fica só no ambiente de teste.
test.skip(remoto, 'grava dados')
test.use({ serviceWorkers: 'block', viewport: { width: 412, height: 800 } })
test.beforeEach(({ page }) => isolarDados(page))

function rolagem(page) {
  return page.locator('.area').evaluate((area) => ({
    esquerda: area.scrollLeft,
    topo: area.scrollTop,
    sobra: area.scrollWidth - area.clientWidth,
  }))
}

test('com zoom, a página do PDF abre centralizada e mantém a posição ao virar', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Enviar arquivo').setInputFiles('e2e/fixtures/pdf-de-teste.pdf')
  await botaoDoLivro(page, 'PDF de Teste').click()
  // O zoom fica guardado no livro: ajusta, fecha e abre de novo.
  await page.getByRole('button', { name: 'Ajustes' }).click()
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Aumentar zoom' }).click()
  await expect(page.locator('output', { hasText: '200%' })).toBeVisible()
  await page.locator('.fundo-painel').click({ position: { x: 10, y: 300 } })
  await page.getByRole('button', { name: 'Voltar' }).click()
  await botaoDoLivro(page, 'PDF de Teste').click()
  await expect(page.locator('.textLayer span').first()).toBeAttached()

  const inicio = await rolagem(page)
  expect(inicio.sobra).toBeGreaterThan(100)
  expect(Math.abs(inicio.esquerda - inicio.sobra / 2)).toBeLessThanOrEqual(2)

  // O leitor ajusta a posição à mão; ela vale também para a próxima página, que abre no topo.
  await page.locator('.area').evaluate((area) => area.scrollTo(area.scrollWidth, 300))
  const ajustada = await rolagem(page)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.leitor')).toHaveAttribute('data-localizacao', '2')
  await expect.poll(async () => (await rolagem(page)).topo).toBe(0)
  expect(Math.abs((await rolagem(page)).esquerda - ajustada.esquerda)).toBeLessThanOrEqual(2)
})

test('o modo texto mostra o texto do PDF corrido e continua na mesma página', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Enviar arquivo').setInputFiles('e2e/fixtures/pdf-de-teste.pdf')
  await botaoDoLivro(page, 'PDF de Teste').click()
  await expect(page.locator('.textLayer span').first()).toBeAttached()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.leitor')).toHaveAttribute('data-localizacao', '2')

  await page.getByRole('button', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Texto', exact: true }).click()
  await expect(page.locator('.texto-pdf')).toContainText('Pagina 2 do PDF de teste')
  await expect(page.locator('.leitor')).toHaveAttribute('data-localizacao', '2')
  // No modo texto, o tamanho da letra substitui o zoom.
  await expect(page.getByRole('button', { name: 'Aumentar fonte' })).toBeVisible()

  await page.getByRole('button', { name: 'Página', exact: true }).click()
  await expect(page.locator('.textLayer span').first()).toBeAttached()
  await expect(page.locator('.leitor')).toHaveAttribute('data-localizacao', '2')
})
