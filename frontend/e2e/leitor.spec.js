import { expect, test } from '@playwright/test'

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
