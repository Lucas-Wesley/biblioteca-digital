import { expect, test } from '@playwright/test'
import { botaoDoLivro, conteudo, remoto } from './ajudantes.js'

async function capaCarregou(botao) {
  await expect(botao.locator('img')).toHaveJSProperty('complete', true)
  expect(await botao.locator('img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0)
}

test('catálogo mostra título, autor e capa vindos do EPUB', async ({ page }) => {
  await page.goto('/')
  const livro = botaoDoLivro(page, 'Quincas Borba')
  await expect(livro).toContainText('Machado de Assis')
  await capaCarregou(livro)
})

test('recusa um arquivo que não é EPUB', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Enviar arquivo').setInputFiles({
    name: 'nao-e-livro.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from('isto não é um EPUB'),
  })
  await expect(page.getByText('nao-e-livro.epub: o arquivo não é um EPUB ou PDF válido')).toBeVisible()
})

test('envia um EPUB, abre o livro e recusa a cópia repetida', async ({ page }) => {
  // No servidor o teste não pode gravar: ainda não há como apagar um livro pelo app.
  test.skip(remoto, 'grava dados')
  const arquivo = 'e2e/fixtures/livro-de-teste.epub'

  await page.goto('/')
  await page.getByLabel('Enviar arquivo').setInputFiles(arquivo)
  await expect(page.getByText('1 livro adicionado')).toBeVisible()

  // Continua no catálogo depois de recarregar
  await page.reload()
  const livro = botaoDoLivro(page, 'Livro de Teste')
  await expect(livro).toContainText('Pessoa de Teste')
  await capaCarregou(livro)

  await page.getByLabel('Enviar arquivo').setInputFiles(arquivo)
  await expect(page.getByText('livro-de-teste.epub: este livro já está na biblioteca')).toBeVisible()

  await livro.click()
  await expect(conteudo(page).locator('body')).toContainText('Texto do capítulo de teste')
})

test('envia um PDF com metadados e capa, abre e navega', async ({ page }) => {
  test.skip(remoto, 'grava dados')
  await page.goto('/')
  await page.getByLabel('Enviar arquivo').setInputFiles('e2e/fixtures/pdf-de-teste.pdf')
  await expect(page.getByText('1 livro adicionado')).toBeVisible()

  const livro = botaoDoLivro(page, 'PDF de Teste')
  await expect(livro).toContainText('Pessoa do PDF')
  await capaCarregou(livro)
  await livro.click()

  await expect(page.getByText('Página 1 de 3')).toBeAttached()
  await expect(page.locator('.area canvas')).toBeVisible()
  await expect(page.locator('.area .textLayer span').first()).toBeAttached()
  await page.getByRole('button', { name: 'Próxima' }).click()
  await expect(page.getByText('Página 2 de 3')).toBeAttached()

  await page.getByRole('button', { name: 'Sumário' }).click()
  await page.getByRole('button', { name: 'Parte final' }).click()
  await expect(page.getByText('Página 3 de 3')).toBeAttached()

  // A posição é salva e volta ao recarregar
  await page.getByRole('button', { name: 'Anterior' }).click()
  await expect(page.getByText('Página 2 de 3')).toBeAttached()
  const salvou = page.waitForResponse((r) => r.url().endsWith('/progress') && r.request().method() === 'PUT')
  await salvou
  await page.reload()
  await expect(page.getByText('Página 2 de 3')).toBeAttached()
})

test('continua o EPUB de onde parou depois de recarregar', async ({ page }) => {
  test.skip(remoto, 'grava dados')
  await page.goto('/')
  await page.getByLabel('Enviar arquivo').setInputFiles('e2e/fixtures/capitulos-de-teste.epub')
  await botaoDoLivro(page, 'Capítulos de Teste').click()
  const leitor = page.locator('.leitor')
  await expect(conteudo(page).locator('body')).toContainText('Primeiro capítulo')

  const salvou = page.waitForResponse((r) => r.url().endsWith('/progress') && r.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Próxima' }).click()
  await expect(conteudo(page).locator('body')).toContainText('Segundo capítulo')
  await salvou
  const posicao = await leitor.getAttribute('data-localizacao')

  await page.reload()
  await expect(conteudo(page).locator('body')).toContainText('Segundo capítulo')
  await expect(leitor).toHaveAttribute('data-localizacao', posicao)
})
