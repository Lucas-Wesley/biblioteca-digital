import { expect, test } from '@playwright/test'
import { botaoDoLivro, conteudo, posicaoAtual, remoto, selecionarTexto } from './ajudantes.js'

// Grava marcações de verdade, então fica só no ambiente de teste.
test.skip(remoto, 'grava dados')
test.use({ serviceWorkers: 'block' })

const CENTRO = { x: 640, y: 360 }

async function abrirMarcacoes(page) {
  await page.goto('/')
  await page.getByLabel('Enviar arquivo').setInputFiles('e2e/fixtures/marcacoes-de-teste.epub')
  await botaoDoLivro(page, 'Marcações de Teste').click()
  await expect(conteudo(page).locator('h1')).toContainText('Parte')
  await expect(page.locator('.leitor')).toHaveAttribute('data-localizacao', /href/)
}

// Os controles somem ao virar a página; o toque no centro os traz de volta.
async function mostrarControles(page) {
  const sumario = page.getByRole('button', { name: 'Sumário' })
  await page.waitForTimeout(300)
  if (!(await sumario.isVisible())) await page.mouse.click(CENTRO.x, CENTRO.y)
  await expect(sumario).toBeVisible()
}

async function irAoCapitulo(page, nome) {
  await mostrarControles(page)
  await page.getByRole('button', { name: 'Sumário' }).click()
  await page.getByRole('button', { name: 'Capítulos', exact: true }).click()
  await page.getByRole('complementary', { name: 'Sumário' }).getByRole('button', { name: nome }).click()
  await expect(conteudo(page).locator('h1')).toContainText(nome)
  await page.waitForTimeout(500)
}

function destaques(page) {
  return conteudo(page).locator('[id*="decoration"] [data-decoration-id], [data-activable], .r2-highlight-0, [class*="highlight"]')
}

test('marca um trecho, escreve nota, revê a lista, volta ao ponto e apaga', async ({ page }) => {
  await abrirMarcacoes(page)
  await irAoCapitulo(page, 'Parte A')

  await selecionarTexto(page, 'parágrafo número 2')
  const barra = page.getByRole('toolbar', { name: 'Marcar o texto selecionado' })
  await expect(barra).toBeVisible()
  const criou = page.waitForResponse((r) => r.url().includes('/annotations/') && r.request().method() === 'PUT')
  await barra.getByRole('button', { name: 'Marcar com nota' }).click()
  expect((await criou).status()).toBe(204)
  await expect(barra).toBeHidden()

  const edicao = page.getByRole('complementary', { name: 'Editar marcação' })
  await edicao.getByRole('textbox', { name: 'Nota' }).fill('Minha nota')
  await edicao.getByRole('button', { name: 'Mudar para verde' }).click()
  await edicao.getByRole('button', { name: 'Concluir' }).click()
  await expect(edicao).toBeHidden()
  await page.waitForTimeout(400)

  // Depois de recarregar, a marcação continua, agora vinda do servidor
  await page.reload()
  await expect(conteudo(page).locator('h1')).toContainText('Parte')
  await mostrarControles(page)
  await page.getByRole('button', { name: 'Sumário' }).click()
  await page.getByRole('button', { name: 'Marcações' }).click()
  const lista = page.getByRole('complementary', { name: 'Sumário e marcações' })
  await expect(lista.locator('.citacao')).toHaveText('parágrafo número 2')
  await expect(lista).toContainText('Minha nota')
  await expect(lista).toContainText('Parte A')
  await expect(lista.locator('.citacao')).toHaveClass(/traco-verde/)
  await page.mouse.click(1200, 360)

  // Volta ao ponto a partir de outro capítulo
  await irAoCapitulo(page, 'Parte B')
  await mostrarControles(page)
  await page.getByRole('button', { name: 'Sumário' }).click()
  await page.getByRole('button', { name: 'Marcações' }).click()
  await lista.locator('.marcacoes button').click()
  await expect(conteudo(page).locator('h1')).toContainText('Parte A')

  // Toca na marcação para editá-la e apaga
  await page.waitForTimeout(600)
  const caixa = await conteudo(page).locator('body').evaluate((body) => {
    const doc = body.ownerDocument
    const passos = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    while (passos.nextNode()) {
      const i = passos.currentNode.data.indexOf('parágrafo número 2')
      if (i < 0) continue
      const r = doc.createRange()
      r.setStart(passos.currentNode, i)
      r.setEnd(passos.currentNode, i + 5)
      const { left, top, width, height } = r.getBoundingClientRect()
      return { x: left + width / 2, y: top + height / 2 }
    }
    return null
  })
  const quadro = await page.locator('.area iframe:not([style*="visibility: hidden"])').first().boundingBox()
  await page.mouse.click(quadro.x + caixa.x, quadro.y + caixa.y)
  await expect(edicao).toBeVisible()
  const apagou = page.waitForResponse((r) => r.url().includes('/annotations/') && r.request().method() === 'DELETE')
  await edicao.getByRole('button', { name: 'Apagar' }).click()
  expect((await apagou).status()).toBe(204)

  await mostrarControles(page)
  await page.getByRole('button', { name: 'Sumário' }).click()
  await page.getByRole('button', { name: 'Marcações' }).click()
  await expect(lista).toContainText('Selecione um trecho')
})

test('a marcação segue o texto quando a fonte muda', async ({ page }) => {
  await abrirMarcacoes(page)
  await irAoCapitulo(page, 'Parte B')
  await selecionarTexto(page, 'parágrafo número 3')
  await page.getByRole('button', { name: 'Marcar em amarelo' }).click()
  await page.waitForTimeout(500)

  await mostrarControles(page)
  await page.getByRole('button', { name: 'Ajustes' }).click()
  await page.getByRole('button', { name: 'Aumentar fonte' }).click()
  await page.getByRole('button', { name: 'Aumentar fonte' }).click()
  await page.getByRole('button', { name: 'Aumentar fonte' }).click()
  await page.waitForTimeout(1200)

  const marca = await page.evaluate(() => {
    const quadro = document.querySelector('.area iframe:not([style*="visibility: hidden"])')
    const doc = quadro.contentDocument
    const achados = [...doc.querySelectorAll('[data-style], [data-activable], [class*="decoration"], [id*="decoration"]')]
    return { achados: achados.length, highlights: [...(quadro.contentWindow.CSS?.highlights?.keys?.() ?? [])] }
  })
  expect(marca.achados + marca.highlights.length).toBeGreaterThan(0)
  await page.mouse.click(1200, 720)
  await page.screenshot({ path: 'test-results/marcacao-fonte.png' })
  expect(await posicaoAtual(page)).toContain('b.xhtml')
})

test('marca um trecho no PDF, e a marcação sobrevive ao recarregar', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Enviar arquivo').setInputFiles('e2e/fixtures/pdf-de-teste.pdf')
  await botaoDoLivro(page, 'PDF de Teste').click()
  const camada = page.locator('.textLayer')
  await expect(camada.locator('span').first()).toBeAttached()

  await camada.locator('span').first().evaluate((span) => {
    const trecho = document.createRange()
    trecho.selectNodeContents(span)
    document.getSelection().removeAllRanges()
    document.getSelection().addRange(trecho)
  })
  const salvou = page.waitForResponse((r) => r.url().includes('/annotations/') && r.request().method() === 'PUT')
  await page.getByRole('button', { name: 'Marcar em azul' }).click()
  await salvou
  await expect(page.locator('.camada-marcas .marca-azul').first()).toBeAttached()

  await page.reload()
  const marca = page.locator('.camada-marcas .marca-azul').first()
  await expect(marca).toBeAttached()

  // A área da marcação fica sob a camada de texto; o toque precisa chegar a ela mesmo assim.
  const caixa = await marca.boundingBox()
  await page.mouse.click(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2)
  await expect(page.getByRole('complementary', { name: 'Editar marcação' })).toBeVisible()
})

test('a marcação vira um pedido de cartão num baralho do Flashcards', async ({ page }) => {
  // O Flashcards fica fora do teste: o servidor da Biblioteca responderia por ele.
  let pedido = null
  await page.route('**/api/flashcards/decks', (r) => r.fulfill({ json: [{ id: 'b1', nome: 'História' }, { id: 'b2', nome: 'Inglês' }] }))
  await page.route('**/annotations/*/flashcards', async (r) => {
    pedido = r.request().postDataJSON()
    await r.fulfill({ status: 201, json: { flashcards_at: '2026-11-11T03:00:00Z', review: 'https://flashcards.internal/#/geracao/7' } })
  })
  await abrirMarcacoes(page)
  await irAoCapitulo(page, 'Parte A')
  await selecionarTexto(page, 'parágrafo número 3')
  await page.getByRole('toolbar', { name: 'Marcar o texto selecionado' }).getByRole('button', { name: 'Marcar com nota' }).click()

  const edicao = page.getByRole('complementary', { name: 'Editar marcação' })
  await edicao.getByRole('textbox', { name: 'Nota' }).fill('lembrar o número')
  await edicao.getByRole('button', { name: 'Criar cartão' }).click()
  await edicao.getByRole('combobox', { name: 'Baralho' }).selectOption('b2')
  await edicao.getByRole('button', { name: 'Criar', exact: true }).click()
  await expect(edicao.getByRole('link', { name: 'Revisar no Flashcards' })).toHaveAttribute('href', 'https://flashcards.internal/#/geracao/7')
  expect(pedido).toEqual({ deck_id: 'b2' })

  // Na próxima vez, avisa que já virou cartão e lembra o baralho.
  await edicao.getByRole('button', { name: 'Concluir' }).click()
  await expect(edicao).toBeHidden()
  await page.waitForTimeout(600)
  const caixa = await conteudo(page).locator('body').evaluate((body) => {
    const doc = body.ownerDocument
    const passos = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    while (passos.nextNode()) {
      const i = passos.currentNode.data.indexOf('parágrafo número 3')
      if (i < 0) continue
      const r = doc.createRange()
      r.setStart(passos.currentNode, i)
      r.setEnd(passos.currentNode, i + 5)
      const { left, top, width, height } = r.getBoundingClientRect()
      return { x: left + width / 2, y: top + height / 2 }
    }
    return null
  })
  const quadro = await page.locator('.area iframe:not([style*="visibility: hidden"])').first().boundingBox()
  await page.mouse.click(quadro.x + caixa.x, quadro.y + caixa.y)
  await expect(edicao).toBeVisible()
  await edicao.getByRole('button', { name: 'Criar outro cartão' }).click()
  await expect(edicao).toContainText('já virou cartão em')
  await expect(edicao.getByRole('combobox', { name: 'Baralho' })).toHaveValue('b2')
})
