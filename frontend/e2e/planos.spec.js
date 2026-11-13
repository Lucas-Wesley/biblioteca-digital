import { expect, test } from '@playwright/test'
import { remoto } from './ajudantes.js'

// Planos de leitura (R35). Os dois testes gravam planos; no servidor de verdade não rodam.
test.skip(remoto, 'grava dados')

async function abrirPlanos(page) {
  await page.goto('/')
  const menu = page.getByRole('button', { name: 'Abrir menu' })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('button', { name: 'Planos de leitura' }).click()
}

test('livro físico: cronograma por capítulos, marcar como lido e apagar', async ({ page }) => {
  await abrirPlanos(page)
  await page.getByRole('button', { name: 'Novo plano' }).click()
  await page.getByRole('button', { name: 'Físico ou de fora' }).click()
  await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Sussurros na Escuridão')
  await page.getByRole('textbox', { name: 'Autor', exact: true }).fill('H.P. Lovecraft')
  await page.getByLabel('Capítulos no livro').fill('8')
  await page.getByLabel('Começar do capítulo').fill('5')
  await expect(page.getByText('4 dias de leitura')).toBeVisible()

  // Dois por dia: a previsão muda na hora.
  await page.getByLabel('Capítulos por dia').fill('2')
  await expect(page.getByText('2 dias de leitura')).toBeVisible()
  await page.getByLabel('Capítulos por dia').fill('1')
  await page.getByRole('button', { name: 'Criar o cronograma' }).click()

  await expect(page.getByRole('heading', { name: 'Sussurros na Escuridão' })).toBeVisible()
  await expect(page.getByText('0 de 4 capítulos lidos')).toBeVisible()
  const cronograma = page.locator('section', { has: page.getByRole('heading', { name: 'Cronograma' }) })
  await expect(cronograma.getByRole('listitem')).toHaveCount(4)

  await cronograma.getByRole('group', { name: 'Marcar: Capítulo 5' }).getByRole('button', { name: 'Li', exact: true }).click()
  await expect(page.getByText('1 de 4 capítulos lidos')).toBeVisible()

  // A marcação foi para o servidor: continua depois de recarregar.
  await expect.poll(async () => {
    const planos = await (await page.request.get('/api/plans')).json()
    return planos.find((p) => p.title === 'Sussurros na Escuridão')?.goals[0].state
  }).toBe('lida')
  await abrirPlanos(page)
  await expect(page.getByText('1 de 4 capítulos')).toBeVisible()

  await page.getByRole('button', { name: /Sussurros na Escuridão/ }).first().click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Apagar o plano' }).click()
  await expect(page.getByRole('heading', { name: 'Planos de leitura' })).toBeVisible()
  await expect(page.getByText('Sussurros na Escuridão')).toHaveCount(0)
})

test('livro da biblioteca: os capítulos vêm do arquivo', async ({ page }) => {
  // O índice da busca é feito ao iniciar; espera o livro entrar nele.
  await expect.poll(async () => {
    const livros = await (await page.request.get('/api/books')).json()
    const id = livros.find((l) => l.title === 'Quincas Borba')?.id
    return id && (await (await page.request.get(`/api/books/${id}/chapters`)).json()).indexed
  }, { timeout: 30000 }).toBe(true)

  await abrirPlanos(page)
  await page.getByRole('button', { name: 'Novo plano' }).click()
  await page.getByLabel('Livro da biblioteca').selectOption({ label: 'Quincas Borba · Machado de Assis' })
  const capitulos = page.getByLabel('Capítulos no livro')
  await expect(capitulos).not.toHaveValue('')
  const total = Number(await capitulos.inputValue())
  // O EPUB de exemplo (Projeto Gutenberg) tem só 3 entradas no sumário; o app avisa de onde veio.
  expect(total).toBe(3)
  await expect(page.getByText('3 capítulos no sumário do arquivo')).toBeVisible()

  await page.getByRole('button', { name: 'Por páginas' }).click()
  await expect(page.getByLabel('Páginas no livro')).not.toHaveValue('')
  await page.getByRole('button', { name: 'Por capítulos' }).click()
  await page.getByRole('button', { name: 'Criar o cronograma' }).click()

  await expect(page.getByRole('heading', { name: 'Quincas Borba' })).toBeVisible()
  await expect(page.getByText(`0 de ${total} capítulos lidos`)).toBeVisible()
  await expect(page.getByText('No leitor:')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abrir o livro' })).toBeVisible()
})
