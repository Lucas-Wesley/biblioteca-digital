import { expect, test } from '@playwright/test'
import { abrirLivro, irAoTexto, isolarDados, posicaoAtual } from './ajudantes.js'

// Celular deitado (R40): o leitor e as telas principais cabem, e o leitor oferece "Girar a tela".
// Não grava nada (isolarDados), então roda também no servidor.
test.use({ serviceWorkers: 'block', viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true })

test.beforeEach(async ({ page }) => {
  await isolarDados(page)
  // O Chromium de teste não trava a tela: a trava de mentira guarda o que foi pedido.
  await page.addInitScript(() => {
    window.__giro = []
    const proto = globalThis.ScreenOrientation?.prototype
    if (!proto) return
    proto.lock = async function (tipo) {
      window.__giro.push(tipo)
    }
    proto.unlock = function () {
      window.__giro.push('solta')
    }
  })
})

async function semRolagemDeLado(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

test('deitado: o leitor cabe, vira a página e "Girar a tela" trava e solta', async ({ page }) => {
  await abrirLivro(page, 'Quincas Borba')
  await semRolagemDeLado(page)
  for (const nome of ['Voltar', 'Sumário', 'Ajustes', 'Anterior', 'Próxima']) {
    await expect(page.getByRole('button', { name: nome, exact: true })).toBeInViewport()
  }

  await irAoTexto(page)
  const antes = await posicaoAtual(page)
  await page.getByRole('button', { name: 'Próxima' }).click()
  await expect(page.locator('.leitor')).not.toHaveAttribute('data-localizacao', antes)

  await page.getByRole('button', { name: 'Ajustes' }).click()
  const giro = page.getByRole('group', { name: 'Girar a tela' })
  await giro.getByRole('button', { name: 'Deitado' }).scrollIntoViewIfNeeded()
  await expect(giro.getByRole('button', { name: 'Deitado' })).toBeInViewport()
  await giro.getByRole('button', { name: 'Deitado' }).click()
  await expect(giro.getByRole('button', { name: 'Deitado' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.__giro)).toContain('landscape')

  await giro.getByRole('button', { name: 'Em pé' }).click()
  await expect.poll(() => page.evaluate(() => window.__giro.at(-1))).toBe('portrait')
  await giro.getByRole('button', { name: 'Automático' }).click()
  await expect.poll(() => page.evaluate(() => window.__giro.at(-1))).toBe('solta')
})

test('deitado: o início e os planos cabem sem rolar para o lado', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.livros')).toBeVisible()
  await semRolagemDeLado(page)
  const menu = page.getByRole('button', { name: 'Abrir menu' })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: 'Planos de leitura' }).click()
  await expect(page.getByRole('heading', { name: 'Planos de leitura' })).toBeVisible()
  await semRolagemDeLado(page)
})
