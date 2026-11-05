import { expect } from '@playwright/test'

export const remoto = Boolean(process.env.E2E_BASE_URL)

export function botaoDoLivro(page, titulo) {
  return page.locator('.livros .abrir').filter({ hasText: titulo })
}

// O Quincas Borba abre com capa e folha de rosto, e o sumário dele é curto: salta pela barra.
export async function irAoTexto(page, onde = '300') {
  await page.getByRole('slider', { name: 'Progresso da leitura' }).fill(onde)
  await expect(conteudo(page).locator('p').first()).toBeAttached()
  await page.waitForTimeout(800)
}

// O Readium deixa os capítulos vizinhos carregados em quadros escondidos.
export function conteudo(page) {
  return page.locator('.area iframe:not([style*="visibility: hidden"])').first().contentFrame()
}

export async function abrirLivro(page, titulo) {
  await page.goto('/')
  await botaoDoLivro(page, titulo).click()
  await expect(page.locator('.leitor')).toHaveAttribute('data-localizacao', /href/)
}

// Testes que também rodam no servidor não podem tocar nos dados da leitura de verdade.
// O service worker ficaria fora do interceptador, então fica bloqueado nesses arquivos.
export async function isolarDados(page) {
  await page.route('**/api/books/*/progress', (rota) =>
    rota.request().method() === 'GET'
      ? rota.fulfill({ json: { position: '', percent: 0 } })
      : rota.fulfill({ status: 204 }),
  )
  await page.route('**/api/books/*/annotations', (rota) => rota.fulfill({ json: [] }))
  await page.route('**/api/books/*/annotations/*', (rota) => rota.fulfill({ status: 204 }))
}

export function posicaoAtual(page) {
  return page.locator('.leitor').getAttribute('data-localizacao')
}

// Seleciona a primeira ocorrência do texto no capítulo, como o dedo faria.
export async function selecionarTexto(page, texto) {
  await conteudo(page).locator('body').evaluate((body, procurado) => {
    const doc = body.ownerDocument
    const passos = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    while (passos.nextNode()) {
      const inicio = passos.currentNode.data.indexOf(procurado)
      if (inicio < 0) continue
      const trecho = doc.createRange()
      trecho.setStart(passos.currentNode, inicio)
      trecho.setEnd(passos.currentNode, inicio + procurado.length)
      doc.getSelection().removeAllRanges()
      doc.getSelection().addRange(trecho)
      return
    }
    throw new Error(`texto não encontrado: ${procurado}`)
  }, texto)
}

// O primeiro texto que aparece na página visível do livro.
export function primeiroTextoVisivel(page) {
  return conteudo(page).locator('body').evaluate((body) => {
    const doc = body.ownerDocument
    const passos = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    const r = doc.createRange()
    while (passos.nextNode()) {
      const no = passos.currentNode
      if (!no.data.trim()) continue
      for (let i = 0; i < no.data.length; i += 10) {
        r.setStart(no, i)
        r.setEnd(no, i + 1)
        const { left, width } = r.getBoundingClientRect()
        if (width > 0 && left >= 0 && left < doc.defaultView.innerWidth) return no.data.slice(i, i + 30)
      }
    }
    return ''
  })
}

export function textoEstaNaPagina(page, procurado) {
  return conteudo(page).locator('body').evaluate((body, texto) => {
    const doc = body.ownerDocument
    const passos = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    while (passos.nextNode()) {
      const i = passos.currentNode.data.indexOf(texto)
      if (i < 0) continue
      const r = doc.createRange()
      r.setStart(passos.currentNode, i)
      r.setEnd(passos.currentNode, i + 1)
      const x = r.getBoundingClientRect().left
      return x >= 0 && x < doc.defaultView.innerWidth
    }
    return false
  }, procurado)
}
