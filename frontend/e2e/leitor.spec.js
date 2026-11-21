import { expect, test } from '@playwright/test'
import { abrirLivro, conteudo, irAoTexto, isolarDados, posicaoAtual, primeiroTextoVisivel, textoEstaNaPagina } from './ajudantes.js'

// Estes testes também rodam no servidor, e lá o progresso é o da leitura de verdade.
test.use({ serviceWorkers: 'block' })
test.beforeEach(({ page }) => isolarDados(page))

test('abre o EPUB pelo Readium, mostra o texto e muda de página', async ({ page }) => {
  const erros = []
  page.on('pageerror', (erro) => erros.push(erro.message))
  await abrirLivro(page, 'Quincas Borba')
  const leitor = page.locator('.leitor')

  const proxima = page.getByRole('button', { name: 'Próxima' })
  const inicio = await posicaoAtual(page)
  await proxima.click()
  await expect(leitor).not.toHaveAttribute('data-localizacao', inicio)

  // Chega ao primeiro capítulo, passando pelas páginas iniciais
  for (let i = 0; i < 60; i++) {
    if (await conteudo(page).getByText('Rubião fitava a enseada').count()) break
    await proxima.click()
    await page.waitForTimeout(150)
  }
  await expect(conteudo(page).locator('body')).toContainText('Rubião fitava a enseada')
  expect(erros).toEqual([])
})

test('sumário leva ao capítulo e cada tema chega ao texto do livro', async ({ page }) => {
  await abrirLivro(page, 'Quincas Borba')
  const leitor = page.locator('.leitor')
  const inicio = await posicaoAtual(page)

  await page.getByRole('button', { name: 'Sumário' }).click()
  const itens = page.getByRole('complementary', { name: 'Sumário' }).locator('li button')
  expect(await itens.count()).toBeGreaterThan(1)
  await itens.last().click()
  await expect(leitor).not.toHaveAttribute('data-localizacao', inicio)

  await page.getByRole('button', { name: 'Ajustes' }).click()
  const corpo = conteudo(page).locator('html')
  await page.getByRole('button', { name: 'Escuro' }).click()
  await expect(corpo).toHaveCSS('background-color', 'rgb(21, 21, 21)')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'escuro')

  await page.getByRole('button', { name: 'Sépia' }).click()
  await expect(corpo).toHaveCSS('background-color', 'rgb(244, 238, 227)')

  await page.getByRole('button', { name: 'Claro' }).click()
  await expect(corpo).toHaveCSS('background-color', 'rgb(251, 250, 248)')
})

test('mudar a fonte mantém o trecho que estava na tela', async ({ page }) => {
  await abrirLivro(page, 'Quincas Borba')
  await irAoTexto(page)
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Próxima' }).click()
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(800)

  const trecho = await primeiroTextoVisivel(page)
  expect(trecho.trim().length).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Ajustes' }).click()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Aumentar fonte' }).click()
  await page.waitForTimeout(1200)

  // O trecho precisa continuar na página visível, mesmo com as colunas redistribuídas.
  await expect.poll(() => textoEstaNaPagina(page, trecho), { timeout: 5000 }).toBe(true)
})

test('tipo de fonte, entrelinhas, margens e alinhamento chegam ao texto', async ({ page }) => {
  await abrirLivro(page, 'Quincas Borba')
  await irAoTexto(page)
  const paragrafo = conteudo(page).locator('p').first()

  await page.getByRole('button', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Literata' }).click()
  await expect.poll(() => paragrafo.evaluate((p) => getComputedStyle(p).fontFamily)).toContain('Literata')
  await expect.poll(() => paragrafo.evaluate((p) => p.ownerDocument.fonts.check("16px 'Literata'"))).toBe(true)

  await page.getByRole('button', { name: 'Sem serifa' }).click()
  await expect.poll(() => paragrafo.evaluate((p) => getComputedStyle(p).fontFamily)).toContain('system-ui')

  const altura = () => paragrafo.evaluate((p) => Number.parseFloat(getComputedStyle(p).lineHeight))
  const antes = await altura()
  await page.getByRole('button', { name: 'Amplo' }).click()
  await expect.poll(altura).toBeGreaterThan(antes)

  await page.getByRole('button', { name: 'Justificado' }).click()
  await expect.poll(() => paragrafo.evaluate((p) => getComputedStyle(p).textAlign)).toBe('justify')

  const largura = () => paragrafo.evaluate((p) => p.getBoundingClientRect().width)
  const coluna = await largura()
  await page.setViewportSize({ width: 390, height: 800 })
  await page.getByRole('button', { name: 'Pequena' }).click()
  await page.waitForTimeout(500)
  const larga = await largura()
  await page.getByRole('button', { name: 'Grande' }).click()
  await expect.poll(largura).toBeLessThan(larga)
  expect(coluna).toBeGreaterThan(0)
})

test('tocar nas laterais vira a página e tocar no centro mostra os controles', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  await abrirLivro(page, 'Quincas Borba')
  const leitor = page.locator('.leitor')
  const voltar = page.getByRole('button', { name: 'Voltar' })
  await expect(voltar).toBeVisible()
  const inicio = await posicaoAtual(page)

  await page.mouse.click(370, 400)
  await expect(leitor).not.toHaveAttribute('data-localizacao', inicio)
  await expect(voltar).toBeHidden()

  await page.mouse.click(195, 400)
  await expect(voltar).toBeVisible()
  await page.mouse.click(195, 400)
  await expect(voltar).toBeHidden()

  await page.mouse.click(20, 400)
  await expect(leitor).toHaveAttribute('data-localizacao', inicio)
})

test('a barra de progresso salta para o ponto escolhido', async ({ page }) => {
  await abrirLivro(page, 'Quincas Borba')
  const barra = page.getByRole('slider', { name: 'Progresso da leitura' })
  await barra.fill('500')
  await expect.poll(async () => JSON.parse(await posicaoAtual(page)).locations.totalProgression).toBeGreaterThan(0.45)
  await expect.poll(async () => JSON.parse(await posicaoAtual(page)).locations.totalProgression).toBeLessThan(0.55)
  await expect(page.locator('.livro-leitor .numero')).toHaveText(/^(4[5-9]|5[0-5])%$/)
})

test('uma posição salva pelo epub.js continua no mesmo capítulo', async ({ page }) => {
  await page.route('**/api/books/*/progress', (rota) =>
    rota.fulfill({ json: { position: 'epubcfi(/6/6!/4/2/1:0)', percent: 0.5, updated_at: '2026-01-01T00:00:00.000Z' } }),
  )
  await abrirLivro(page, 'Quincas Borba')
  const local = JSON.parse(await posicaoAtual(page))
  expect(local.href).toContain('h-1')
  expect(local.locations.progression).toBeGreaterThan(0.3)
})

test('o botão do topo põe o livro em tela cheia e o texto continua no mesmo trecho (R43)', async ({ page }) => {
  // O Chromium de teste não muda o tamanho da página na tela cheia (e não deixa mudar depois); aqui a
  // tela cheia é de mentira e o tamanho muda como no celular, quando as barras do Android somem.
  await page.addInitScript(() => {
    let elemento = null
    const avisar = () => document.dispatchEvent(new Event('fullscreenchange'))
    Object.defineProperty(Document.prototype, 'fullscreenElement', { configurable: true, get: () => elemento })
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => true })
    Element.prototype.requestFullscreen = async function entrar() {
      elemento = this
      avisar()
    }
    Document.prototype.exitFullscreen = async function sair() {
      elemento = null
      avisar()
    }
  })
  await page.setViewportSize({ width: 412, height: 780 })
  await abrirLivro(page, 'Quincas Borba')
  await irAoTexto(page)
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'Próxima' }).click()
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(900)
  const trecho = await primeiroTextoVisivel(page)
  expect(trecho.trim().length).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Tela cheia' }).click()
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true)
  await expect(page.getByRole('button', { name: 'Sair da tela cheia' })).toHaveAttribute('aria-pressed', 'true')
  await page.setViewportSize({ width: 412, height: 915 })
  await expect.poll(() => textoEstaNaPagina(page, trecho), { timeout: 5000 }).toBe(true)
  await page.waitForTimeout(900)
  const naTelaCheia = await primeiroTextoVisivel(page)

  await page.getByRole('button', { name: 'Sair da tela cheia' }).click()
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)
  await page.setViewportSize({ width: 412, height: 780 })
  await expect.poll(() => textoEstaNaPagina(page, naTelaCheia), { timeout: 5000 }).toBe(true)
  await page.getByRole('button', { name: 'Voltar' }).first().click()
  await expect(page.locator('.leitor')).toHaveCount(0)
})

// A tela muda de tamanho ao girar o celular, ao entrar ou sair da tela cheia e ao mudar a janela:
// as páginas se redistribuem, e o começo da página que estava na tela continua na tela (R43).
test('girar o celular e voltar mantém o trecho que estava na tela (R43)', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 860 })
  await abrirLivro(page, 'Quincas Borba')
  await irAoTexto(page, '420')
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Próxima' }).click()
    await page.waitForTimeout(250)
  }
  await page.waitForTimeout(900)
  const emPe = await primeiroTextoVisivel(page)
  expect(emPe.trim().length).toBeGreaterThan(0)

  // Deitado, em passos, como a tela do celular muda ao girar.
  await page.setViewportSize({ width: 700, height: 560 })
  await page.setViewportSize({ width: 860, height: 412 })
  await expect.poll(() => textoEstaNaPagina(page, emPe), { timeout: 5000 }).toBe(true)
  await page.waitForTimeout(900)

  const deitado = await primeiroTextoVisivel(page)
  await page.setViewportSize({ width: 412, height: 860 })
  await expect.poll(() => textoEstaNaPagina(page, deitado), { timeout: 5000 }).toBe(true)
  // A volta ao trecho não é leitura: a posição salva continua a do texto que estava na tela.
  await expect.poll(async () => JSON.parse(await posicaoAtual(page)).locations.totalProgression).toBeGreaterThan(0.35)
})
