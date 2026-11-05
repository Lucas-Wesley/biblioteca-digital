import { expect, test } from '@playwright/test'

const remoto = Boolean(process.env.E2E_BASE_URL)

async function capaCarregou(botao) {
  await expect(botao.locator('img')).toHaveJSProperty('complete', true)
  expect(await botao.locator('img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
}

test('catálogo mostra título, autor e capa vindos do EPUB', async ({ page }) => {
  await page.goto('/')
  const livro = page.getByRole('button', { name: 'Quincas Borba' })
  await expect(livro).toContainText('Machado de Assis')
  await capaCarregou(livro)
})

test('recusa um arquivo que não é EPUB', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Enviar EPUB').setInputFiles({
    name: 'nao-e-livro.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from('isto não é um EPUB'),
  })
  await expect(page.getByText('nao-e-livro.epub: o arquivo não é um EPUB válido')).toBeVisible()
})

test('envia um EPUB, abre o livro e recusa a cópia repetida', async ({ page }) => {
  // No servidor o teste não pode gravar: ainda não há como apagar um livro pelo app.
  test.skip(remoto, 'grava dados')
  const arquivo = 'e2e/fixtures/livro-de-teste.epub'

  await page.goto('/')
  await page.getByLabel('Enviar EPUB').setInputFiles(arquivo)
  await expect(page.getByText('1 livro adicionado')).toBeVisible()

  // Continua no catálogo depois de recarregar
  await page.reload()
  const livro = page.getByRole('button', { name: 'Livro de Teste' })
  await expect(livro).toContainText('Pessoa de Teste')
  await capaCarregou(livro)

  await page.getByLabel('Enviar EPUB').setInputFiles(arquivo)
  await expect(page.getByText('livro-de-teste.epub: este livro já está na biblioteca')).toBeVisible()

  await livro.click()
  await expect(page.frameLocator('.area iframe').locator('body')).toContainText('Texto do capítulo de teste')
})
