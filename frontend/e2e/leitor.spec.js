import { expect, test } from '@playwright/test'

// Estes testes também rodam no servidor, e lá o progresso é o da leitura de verdade:
// nenhuma chamada de progresso pode chegar à API. O service worker ficaria fora do interceptador.
test.use({ serviceWorkers: 'block' })

test.beforeEach(async ({ page }) => {
  await page.route('**/api/books/*/progress', (rota) =>
    rota.request().method() === 'GET'
      ? rota.fulfill({ json: { position: '', percent: 0 } })
      : rota.fulfill({ status: 204 }),
  )
})

test('abre o EPUB, mostra o texto e muda de página', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Quincas Borba' }).click()

  const leitor = page.locator('.leitor')
  await expect(leitor).toHaveAttribute('data-localizacao', /epubcfi/)
  const conteudo = page.frameLocator('.area iframe').locator('body')

  // O livro começa pela capa, que é só uma imagem dentro de um SVG
  await expect(conteudo.locator('svg image')).toHaveCount(1)

  const proxima = page.getByRole('button', { name: 'Próxima' })
  const inicio = await leitor.getAttribute('data-localizacao')
  await proxima.click()
  await expect(leitor).not.toHaveAttribute('data-localizacao', inicio)

  await page.getByRole('button', { name: 'Anterior' }).click()
  await expect(leitor).toHaveAttribute('data-localizacao', inicio)

  // Chega ao primeiro capítulo, passando pelas páginas iniciais
  for (let i = 0; i < 40; i++) {
    if (await conteudo.getByText('Rubião fitava a enseada').count()) break
    const antes = await leitor.getAttribute('data-localizacao')
    await proxima.click()
    await expect(leitor).not.toHaveAttribute('data-localizacao', antes)
  }
  await expect(conteudo).toContainText('Rubião fitava a enseada')
})

test('sumário leva ao capítulo e o tema escuro chega ao texto do livro', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Quincas Borba' }).click()
  const leitor = page.locator('.leitor')
  await expect(leitor).toHaveAttribute('data-localizacao', /epubcfi/)
  const inicio = await leitor.getAttribute('data-localizacao')

  await page.getByRole('button', { name: 'Sumário' }).click()
  const itens = page.getByRole('complementary', { name: 'Sumário' }).getByRole('button')
  expect(await itens.count()).toBeGreaterThan(1)
  await itens.last().click()
  await expect(leitor).not.toHaveAttribute('data-localizacao', inicio)

  await page.getByRole('button', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Escuro' }).click()
  await page.getByRole('button', { name: 'Aumentar fonte' }).click()
  const corpo = page.frameLocator('.area iframe').locator('body')
  await expect(corpo).toHaveCSS('color', 'rgb(223, 227, 232)')
  await expect(corpo).toHaveCSS('background-color', 'rgb(20, 23, 27)')
  await expect(page.frameLocator('.area iframe').locator('html')).toHaveCSS('color-scheme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'escuro')

  await page.getByRole('button', { name: 'Claro' }).click()
  await expect(corpo).not.toHaveCSS('color', 'rgb(223, 227, 232)')
  await expect(corpo).not.toHaveCSS('background-color', 'rgb(20, 23, 27)')
})

test('margens mudam a largura da coluna e mantêm o trecho do livro', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Quincas Borba' }).click()
  const leitor = page.locator('.leitor')
  await expect(leitor).toHaveAttribute('data-localizacao', /epubcfi/)
  const proxima = page.getByRole('button', { name: 'Próxima' })
  await proxima.click()
  const area = page.locator('.area')
  const antes = (await area.boundingBox()).width
  await page.getByRole('button', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Grande' }).click()
  await expect.poll(async () => (await area.boundingBox()).width).toBeLessThan(antes)
  // O iframe é largo de propósito (as colunas viram páginas); quem acompanha a área é o contêiner.
  const larguraArea = (await area.boundingBox()).width
  await expect.poll(async () => (await page.locator('.area .epub-container').boundingBox()).width).toBeCloseTo(larguraArea, -1)
})
