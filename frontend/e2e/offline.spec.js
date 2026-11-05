import { expect, test } from '@playwright/test'
import { botaoDoLivro, conteudo, irAoTexto, remoto } from './ajudantes.js'

// Baixar não muda nada no servidor, então este também roda lá: só o navegador do teste guarda o livro.
async function esperarServiceWorker(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
    }
  })
}

async function baixar(page, titulo) {
  await page.getByRole('button', { name: `Baixar: ${titulo}` }).click()
  await expect(page.getByRole('button', { name: `Remover download: ${titulo}` })).toBeVisible({ timeout: 30000 })
}

test('baixa um EPUB e lê sem conexão, com estilos, capa e fonte', async ({ page, context }) => {
  const falhas = []
  page.on('requestfailed', (pedido) => {
    if (/publication\/|woff2/.test(pedido.url())) falhas.push(pedido.url())
  })
  await page.goto('/')
  await esperarServiceWorker(page)
  await baixar(page, 'Quincas Borba')

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Sem conexão com a sua rede').first()).toBeVisible({ timeout: 15000 })
  await expect(botaoDoLivro(page, 'Quincas Borba')).toBeVisible()

  await botaoDoLivro(page, 'Quincas Borba').click()
  const leitor = page.locator('.leitor')
  await expect(leitor).toHaveAttribute('data-localizacao', /href/, { timeout: 20000 })

  // Os estilos do livro só chegam ao quadro se vieram embutidos
  const estilosDoLivro = conteudo(page).locator('link[rel="stylesheet"][href^="blob:"]')
  await expect.poll(() => estilosDoLivro.count()).toBeGreaterThan(1)
  expect(await estilosDoLivro.first().evaluate((link) => link.sheet !== null)).toBe(true)
  expect(falhas).toEqual([])

  // No servidor para aqui: o livro abre onde a leitura de verdade parou, e mudar de página a alteraria.
  if (remoto) return

  // A capa é o primeiro quadro e só aparece se a imagem veio embutida
  const capa = conteudo(page).locator('svg image')
  await expect(capa).toHaveCount(1)
  expect(await capa.evaluate((img) => img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? img.getAttribute('href'))).toMatch(/^blob:/)

  // Vai até um capítulo com texto, e a fonte do leitor também precisa vir do cache
  await irAoTexto(page)
  await expect.poll(() => conteudo(page).locator('p').first().evaluate((p) => p.ownerDocument.fonts.check("16px 'Literata'"))).toBe(true)
  expect(falhas).toEqual([])

  await context.setOffline(false)
})

test('um livro não baixado não aparece sem conexão, e remover tira o livro do aparelho', async ({ page, context }) => {
  await page.goto('/')
  await esperarServiceWorker(page)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Nenhum livro baixado')).toBeVisible({ timeout: 15000 })
  await context.setOffline(false)

  await page.reload()
  await esperarServiceWorker(page)
  await baixar(page, 'Quincas Borba')
  await page.getByRole('button', { name: 'Remover download: Quincas Borba' }).click()
  await expect(page.getByRole('button', { name: 'Baixar: Quincas Borba' })).toBeVisible()
  const restou = await page.evaluate(() => caches.keys())
  expect(restou.filter((nome) => nome.startsWith('livro-'))).toEqual([])
})

test('baixa um PDF e lê sem conexão', async ({ page, context }) => {
  test.skip(remoto, 'grava dados')
  await page.goto('/')
  await esperarServiceWorker(page)
  await page.getByLabel('Enviar arquivo').setInputFiles('e2e/fixtures/pdf-de-teste.pdf')
  await baixar(page, 'PDF de Teste')

  await context.setOffline(true)
  await page.reload()
  await botaoDoLivro(page, 'PDF de Teste').click({ timeout: 15000 })
  await expect(page.locator('.area canvas')).toBeVisible({ timeout: 15000 })
  await expect(page.locator('.textLayer span').first()).toBeAttached()
  await context.setOffline(false)
})

test('o progresso e as marcações feitos offline sobem ao voltar a rede', async ({ page, context }) => {
  test.skip(remoto, 'grava dados')
  await page.goto('/')
  await esperarServiceWorker(page)
  await page.getByLabel('Enviar arquivo').setInputFiles('e2e/fixtures/livro-offline.epub')
  await expect(page.getByText('1 livro adicionado')).toBeVisible()
  await baixar(page, 'Livro Offline')

  await context.setOffline(true)
  await page.reload()
  await expect(botaoDoLivro(page, 'Livro Offline')).toBeVisible({ timeout: 15000 })
  await botaoDoLivro(page, 'Livro Offline').click()
  await expect(conteudo(page).locator('body')).toContainText('Capítulo offline um')

  await page.getByRole('button', { name: 'Próxima' }).click()
  await expect(conteudo(page).locator('body')).toContainText('Capítulo offline dois')
  await page.waitForTimeout(1300)
  await page.locator('.area iframe:not([style*="visibility: hidden"])').first().contentFrame().locator('body').evaluate((body) => {
    const doc = body.ownerDocument
    const passos = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    while (passos.nextNode()) {
      const i = passos.currentNode.data.indexOf('offline dois')
      if (i < 0) continue
      const r = doc.createRange()
      r.setStart(passos.currentNode, i)
      r.setEnd(passos.currentNode, i + 12)
      doc.getSelection().addRange(r)
      return
    }
  })
  await page.getByRole('button', { name: 'Marcar em rosa' }).click()

  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('biblioteca-livros')).find((l) => l.title === 'Livro Offline').id)
  const fila = () => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('biblioteca-fila') ?? '{}')).length)
  await expect.poll(fila).toBeGreaterThanOrEqual(2)

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(fila, { timeout: 15000 }).toBe(0)

  const progresso = await page.request.get(`/api/books/${id}/progress`).then((r) => r.json())
  expect(progresso.position).toContain('href')
  const marcas = await page.request.get(`/api/books/${id}/annotations`).then((r) => r.json())
  expect(marcas).toHaveLength(1)
  expect(marcas[0].quote).toBe('offline dois')
  expect(marcas[0].color).toBe('rosa')
})
