import { devices, expect, test } from '@playwright/test'
import { botaoDoLivro, conteudo, remoto } from './ajudantes.js'

// Grava uma marcação, então fica só no ambiente de teste. Celular de verdade: toque, sem mouse.
test.skip(remoto, 'grava dados')
const { defaultBrowserType: _, ...pixel } = devices['Pixel 7']
test.use({ ...pixel, serviceWorkers: 'block' })

// O gesto só existe dentro de uma mesma sessão: início e fim precisam passar pela mesma.
const sessoes = new WeakMap()

async function tocar(page, tipo, x, y) {
  if (!sessoes.has(page)) sessoes.set(page, await page.context().newCDPSession(page))
  const cdp = sessoes.get(page)
  await cdp.send('Input.dispatchTouchEvent', { type: tipo, touchPoints: tipo === 'touchEnd' ? [] : [{ x, y }] })
}

async function segurar(page, x, y) {
  await tocar(page, 'touchStart', x, y)
  await page.waitForTimeout(650)
  await tocar(page, 'touchEnd', x, y)
}

function pontoDoTexto(page, procurado) {
  return page.evaluate((texto) => {
    const quadro = document.querySelector('.area iframe:not([style*="visibility: hidden"])')
    const doc = quadro.contentDocument
    const passos = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    while (passos.nextNode()) {
      const i = passos.currentNode.data.indexOf(texto)
      if (i < 0) continue
      const r = doc.createRange()
      r.setStart(passos.currentNode, i)
      r.setEnd(passos.currentNode, i + 2)
      const caixa = r.getBoundingClientRect()
      const fora = quadro.getBoundingClientRect()
      return { x: caixa.left + fora.left + 2, y: caixa.top + fora.top + caixa.height / 2 }
    }
    return null
  }, procurado)
}

// Outros testes deixam este livro em outra posição; o trecho procurado está no começo da Parte A.
async function abrirParteA(page) {
  await botaoDoLivro(page, 'Marcações de Teste').click()
  await expect(conteudo(page).locator('h1')).toContainText('Parte')
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Sumário' }).click()
  await page.getByRole('complementary', { name: 'Sumário' }).getByRole('button', { name: 'Parte A' }).click()
  await expect(conteudo(page).locator('h1')).toContainText('Parte A')
  await page.waitForTimeout(1000)
}

test('segurar o dedo seleciona sem a seleção do sistema, a alça ajusta e a marcação salva', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Enviar arquivo').setInputFiles('e2e/fixtures/marcacoes-de-teste.epub')
  await abrirParteA(page)

  const ponto = await pontoDoTexto(page, 'número 3')
  await segurar(page, ponto.x, ponto.y)

  const barra = page.getByRole('toolbar', { name: 'Marcar o texto selecionado' })
  await expect(barra).toBeVisible()
  // Nada de seleção nativa: é ela que traz o menu do Android e o painel do Google.
  const nativa = await conteudo(page).locator('body').evaluate((b) => b.ownerDocument.getSelection().toString())
  expect(nativa).toBe('')
  expect(await conteudo(page).locator('body').evaluate((b) => getComputedStyle(b).webkitUserSelect)).toBe('none')
  await expect(page.locator('.alca-selecao:not([hidden])')).toHaveCount(2)

  // A barra fica junto do trecho e cabe na tela
  const caixa = await barra.boundingBox()
  expect(caixa.x).toBeGreaterThanOrEqual(0)
  expect(caixa.x + caixa.width).toBeLessThanOrEqual(page.viewportSize().width)
  expect(caixa.y + caixa.height).toBeLessThan(ponto.y)

  // A alça do fim estende até a palavra seguinte
  const fim = await page.locator('.alca-selecao[data-extremo="fim"]').boundingBox()
  const destino = await pontoDoTexto(page, '3: Rubião')
  await tocar(page, 'touchStart', fim.x + 22, fim.y + 10)
  await tocar(page, 'touchMove', destino.x + 40, destino.y + 22)
  await page.waitForTimeout(100)
  await tocar(page, 'touchEnd', destino.x + 40, destino.y + 22)
  await expect(barra).toBeVisible()

  const salvou = page.waitForResponse((r) => r.url().includes('/annotations/') && r.request().method() === 'PUT')
  await barra.getByRole('button', { name: 'Marcar em verde' }).click()
  const corpo = (await salvou).request().postDataJSON()
  expect(corpo.quote).toMatch(/^número/)
  expect(corpo.quote.length).toBeGreaterThan('número'.length)
  await expect(page.locator('.alca-selecao:not([hidden])')).toHaveCount(0)
  await page.waitForTimeout(400)

  // Segurar sobre a marcação seleciona de novo, em vez de abrir a edição ao soltar
  await segurar(page, ponto.x, ponto.y)
  await expect(barra).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.getByRole('complementary', { name: 'Editar marcação' })).toBeHidden()
  await expect(barra).toBeVisible()
})

test('tocar fora desfaz a seleção sem virar a página', async ({ page }) => {
  await page.goto('/')
  await abrirParteA(page)
  const ponto = await pontoDoTexto(page, 'número 4')
  await segurar(page, ponto.x, ponto.y)
  const barra = page.getByRole('toolbar', { name: 'Marcar o texto selecionado' })
  await expect(barra).toBeVisible()
  // O próprio soltar do dedo não pode desfazer
  await page.waitForTimeout(500)
  await expect(barra).toBeVisible()

  const antes = await page.locator('.leitor').getAttribute('data-localizacao')
  const { width, height } = page.viewportSize()
  await page.touchscreen.tap(width - 10, height / 2)
  await expect(barra).toBeHidden()
  await page.waitForTimeout(400)
  expect(await page.locator('.leitor').getAttribute('data-localizacao')).toBe(antes)
})

test('no PDF, segurar o dedo seleciona e marca', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Enviar arquivo').setInputFiles('e2e/fixtures/pdf-de-teste.pdf')
  await botaoDoLivro(page, 'PDF de Teste').click()
  const trecho = page.locator('.textLayer span').first()
  await expect(trecho).toBeAttached()
  await page.waitForTimeout(500)
  const caixa = await trecho.boundingBox()
  await segurar(page, caixa.x + 8, caixa.y + caixa.height / 2)
  const barra = page.getByRole('toolbar', { name: 'Marcar o texto selecionado' })
  await expect(barra).toBeVisible()
  expect(await page.evaluate(() => document.getSelection().toString())).toBe('')
  await barra.getByRole('button', { name: 'Marcar em rosa' }).click()
  await expect(page.locator('.camada-marcas .marca-rosa').first()).toBeAttached()
})
