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
  await page.addInitScript(() => localStorage.setItem('biblioteca-preferencias', JSON.stringify({ zoom: 200 })))
  await page.goto('/')
  await page.getByLabel('Enviar arquivo').setInputFiles('e2e/fixtures/pdf-de-teste.pdf')
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
