import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarEmbutidor } from './embutir.js'

const BASE = `${location.origin}/api/books/x/publication/OEBPS/c1.xhtml`

function resposta(corpo, tipo) {
  return new Response(corpo, { status: 200, headers: { 'Content-Type': tipo } })
}

describe('embutir', () => {
  let contador

  beforeEach(() => {
    contador = 0
    URL.createObjectURL = vi.fn(() => `blob:${++contador}`)
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('troca CSS, imagem e SVG do capítulo por blobs, sem tocar em link externo', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('.css') ? resposta('p{}', 'text/css') : resposta('x', 'image/png'))))
    const doc = new DOMParser().parseFromString(
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><head><link rel="stylesheet" href="estilo.css"/></head>
       <body><img src="img/a%20b.png"/><img src="https://exemplo.com/fora.png"/><svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="capa.png"/></svg></body></html>`,
      'application/xhtml+xml',
    )
    await criarEmbutidor().embutirDocumento(doc, BASE)

    expect(doc.querySelector('link').getAttribute('href')).toMatch(/^blob:/)
    const [local, externa] = doc.querySelectorAll('img')
    expect(local.getAttribute('src')).toMatch(/^blob:/)
    expect(externa.getAttribute('src')).toBe('https://exemplo.com/fora.png')
    expect(doc.querySelector('image').getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toMatch(/^blob:/)
    expect(fetch).toHaveBeenCalledWith(`${location.origin}/api/books/x/publication/OEBPS/img/a%20b.png`)
  })

  it('segue url() e @import dentro do CSS', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('outro.css') ? resposta('a{}', 'text/css') : resposta('x', 'font/woff2'))))
    const css = await criarEmbutidor().embutirCss(
      `@import "outro.css"; @font-face { src: url('f.woff2') } .a { background: url(data:image/png;base64,AA) } .b { fill: url(#g) }`,
      BASE,
    )
    expect(css).toContain('@import "blob:')
    expect(css).toContain('url("blob:')
    expect(css).toContain('url(#g)')
    // data: tem outra origem e continua como veio
    expect(css).toContain('data:image/png;base64,AA')
  })

  it('reaproveita o blob do mesmo arquivo e libera tudo ao fechar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta('x', 'image/png')))
    const embutidor = criarEmbutidor()
    const [a, b] = await Promise.all([embutidor.paraBlob(`${BASE}.png`), embutidor.paraBlob(`${BASE}.png`)])
    expect(a).toBe(b)
    expect(fetch).toHaveBeenCalledTimes(1)
    await embutidor.liberar()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(a)
  })

  it('um arquivo que falta não derruba o capítulo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const doc = new DOMParser().parseFromString('<html><body><img src="nada.png"></body></html>', 'text/html')
    await criarEmbutidor().embutirDocumento(doc, BASE)
    expect(doc.querySelector('img').getAttribute('src')).toBe('nada.png')
  })

  it('na busca, só transforma documentos e devolve o resto como veio', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).endsWith('.json')) return resposta('{}', 'application/json')
      if (String(url).endsWith('.png')) return resposta('x', 'image/png')
      return resposta('<html xmlns="http://www.w3.org/1999/xhtml"><head/><body><img src="a.png"/></body></html>', 'application/xhtml+xml')
    }))
    const embutidor = criarEmbutidor()
    expect(await (await embutidor.buscar(`${BASE}.json`)).text()).toBe('{}')
    expect(await (await embutidor.buscar(BASE)).text()).toMatch(/src="blob:/)
  })

  it('um XHTML malformado segue para o leitor mostrar o erro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta('<html><p>sem fechar', 'application/xhtml+xml')))
    expect(await (await criarEmbutidor().buscar(BASE)).text()).toBe('<html><p>sem fechar')
  })
})
