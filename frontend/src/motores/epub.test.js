import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EpubNavigator } from '@readium/navigator'
import { Locator } from '@readium/shared'
import { abrirEpub, ancoraDaSelecao, converterCfi, trechoVisivel } from './epub.js'
import { estaBaixado } from '../offline.js'

vi.mock('@readium/navigator', () => ({ EpubNavigator: vi.fn(), DecorationStyleType: { Highlight: 'highlight' } }))
vi.mock('../offline.js', () => ({ estaBaixado: vi.fn(async () => false) }))

const manifesto = {
  metadata: { title: 'Livro', conformsTo: 'https://readium.org/webpub-manifest/profiles/epub' },
  links: [
    { rel: 'self', href: 'manifest.json', type: 'application/webpub+json' },
    { href: 'positions.json', type: 'application/vnd.readium.position-list+json' },
  ],
  readingOrder: [
    { href: 'OEBPS/c1.xhtml', type: 'application/xhtml+xml' },
    { href: 'OEBPS/c2.xhtml', type: 'application/xhtml+xml' },
  ],
  resources: [],
  toc: [
    { href: 'OEBPS/c1.xhtml', title: ' Um ', children: [{ href: 'OEBPS/c1.xhtml#a', title: 'Um A' }] },
    { href: 'OEBPS/c2.xhtml', title: 'Dois' },
  ],
}
const posicoes = {
  total: 2,
  positions: [
    { href: 'OEBPS/c1.xhtml', type: 'application/xhtml+xml', locations: { position: 1, progression: 0, totalProgression: 0 } },
    { href: 'OEBPS/c2.xhtml', type: 'application/xhtml+xml', locations: { position: 2, progression: 0, totalProgression: 0.5 } },
  ],
}

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const texto = String(url)
    const corpo = texto.endsWith('manifest.json') ? manifesto : texto.endsWith('positions.json') ? posicoes : {}
    return new Response(texto.endsWith('.woff2') ? 'fonte' : JSON.stringify(corpo), { status: 200 })
  }))
  URL.createObjectURL = vi.fn(() => 'blob:fonte')
  URL.revokeObjectURL = vi.fn()
}

function navFalso() {
  const nav = {
    load: vi.fn(async () => {}),
    destroy: vi.fn(),
    goForward: vi.fn((_, cb) => cb(true)),
    goBackward: vi.fn((_, cb) => cb(true)),
    go: vi.fn((_, __, cb) => cb(true)),
    goLink: vi.fn((_, __, cb) => cb(true)),
    submitPreferences: vi.fn(async () => {}),
    applyDecorations: vi.fn(),
    registerDecorationObserver: vi.fn(),
    _cframes: [],
  }
  EpubNavigator.mockImplementation(function construir(area, pub, ouvintes, lista, inicial, config) {
    Object.assign(this, nav)
    nav.ouvintes = ouvintes
    nav.inicial = inicial
    nav.config = config
    nav.lista = lista
  })
  return nav
}

function opcoes(extra = {}) {
  return {
    livro: { id: 'um livro' },
    area: document.createElement('div'),
    preferencias: { tema: 'claro', fonte: 120, familia: 'literata', entrelinhas: 'normal', alinhamento: 'esquerda', margem: 'media' },
    aoMudar: vi.fn(),
    aoClicar: vi.fn(),
    aoTeclar: vi.fn(),
    ...extra,
  }
}

function local(extra = {}) {
  return Locator.deserialize({
    href: 'OEBPS/c2.xhtml',
    type: 'application/xhtml+xml',
    locations: { position: 2, progression: 0.25, totalProgression: 0.625 },
    ...extra,
  })
}

describe('motor de EPUB', () => {
  beforeEach(() => {
    EpubNavigator.mockReset()
    estaBaixado.mockResolvedValue(false)
    stubFetch()
  })

  it('abre a publicação pela API, com posições e preferências', async () => {
    const nav = navFalso()
    await abrirEpub(opcoes())
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/books/um%20livro/publication/manifest.json'))
    expect(nav.lista).toHaveLength(2)
    expect(nav.inicial).toBeUndefined()
    expect(nav.config.preferences).toMatchObject({ fontSize: 1.2, scroll: false, backgroundColor: '#ffffff', lineHeight: 1.6 })
    expect(nav.load).toHaveBeenCalled()
  })

  it('reabre na posição salva e ignora uma posição inválida', async () => {
    let nav = navFalso()
    await abrirEpub(opcoes({ posicao: JSON.stringify(local().serialize()) }))
    expect(nav.inicial.href).toBe('OEBPS/c2.xhtml')

    nav = navFalso()
    await abrirEpub(opcoes({ posicao: 'lixo' }))
    expect(nav.inicial).toBeUndefined()
  })

  it('converte a posição antiga do epub.js para o mesmo capítulo', async () => {
    const leitura = manifesto.readingOrder
    const convertido = converterCfi('epubcfi(/6/4!/4/2/1:0)', 0.75, leitura)
    expect(convertido.href).toBe('OEBPS/c2.xhtml')
    expect(convertido.locations.progression).toBe(0.5)
    expect(converterCfi('epubcfi(/6/40!/4)', 0.1, leitura)).toBeUndefined()
    expect(converterCfi('lixo', 0.1, leitura)).toBeUndefined()

    const nav = navFalso()
    await abrirEpub(opcoes({ posicao: 'epubcfi(/6/2!/4/2)', percentualSalvo: 0.25 }))
    expect(nav.inicial.href).toBe('OEBPS/c1.xhtml')
    expect(nav.inicial.locations.progression).toBe(0.5)
  })

  it('propaga o erro de um livro que não abre', async () => {
    navFalso().load.mockRejectedValue(new Error('arquivo inválido'))
    EpubNavigator.mockImplementation(function construir() {
      this.load = vi.fn(async () => { throw new Error('arquivo inválido') })
    })
    await expect(abrirEpub(opcoes())).rejects.toThrow('arquivo inválido')
  })

  it('achata o sumário com os níveis', async () => {
    navFalso()
    const motor = await abrirEpub(opcoes())
    expect(motor.sumario().map(({ rotulo, destino, nivel }) => [rotulo, destino, nivel])).toEqual([
      ['Um', 'OEBPS/c1.xhtml', 0],
      ['Um A', 'OEBPS/c1.xhtml#a', 1],
      ['Dois', 'OEBPS/c2.xhtml', 0],
    ])
  })

  it('avisa a posição, o percentual e o capítulo, e separa leitura de abertura', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const nav = navFalso()
    const aoMudar = vi.fn()
    await abrirEpub(opcoes({ aoMudar }))

    nav.ouvintes.positionChanged(local())
    expect(aoMudar.mock.lastCall[0]).toMatchObject({ percentual: 0.625, capitulo: 'OEBPS/c2.xhtml', rotulo: 'Dois' })
    expect(JSON.parse(aoMudar.mock.lastCall[0].posicao).href).toBe('OEBPS/c2.xhtml')
    expect(aoMudar.mock.lastCall[1]).toBe(false)

    vi.advanceTimersByTime(1000)
    nav.ouvintes.positionChanged(local())
    expect(aoMudar.mock.lastCall[1]).toBe(true)
    vi.useRealTimers()
  })

  it('não guarda o trecho citado quando a posição passa do limite do servidor', async () => {
    const nav = navFalso()
    const aoMudar = vi.fn()
    await abrirEpub(opcoes({ aoMudar }))
    nav.ouvintes.positionChanged(local({ text: { highlight: 'x'.repeat(5000) } }))
    expect(aoMudar.mock.lastCall[0].posicao.length).toBeLessThan(3500)
  })

  it('converte a posição do toque e não vira a página com texto selecionado', async () => {
    const nav = navFalso()
    const aoClicar = vi.fn()
    await abrirEpub(opcoes({ aoClicar }))
    const densidade = window.devicePixelRatio
    expect(nav.ouvintes.tap({ x: 100 * densidade, y: 5 })).toBe(true)
    expect(aoClicar).toHaveBeenCalledWith(100)

    aoClicar.mockClear()
    const doc = document.implementation.createHTMLDocument()
    doc.getSelection = () => ({ toString: () => 'trecho' })
    nav._cframes.push({ iframe: { contentDocument: doc, getBoundingClientRect: () => ({ left: 0 }) } })
    expect(nav.ouvintes.tap({ x: 100, y: 5 })).toBe(true)
    expect(aoClicar).not.toHaveBeenCalled()
  })

  it('desenha as marcações com a cor certa e ignora âncoras quebradas', async () => {
    const nav = navFalso()
    const motor = await abrirEpub(opcoes())
    motor.marcar([
      { id: 'a', color: 'verde', anchor: JSON.stringify({ href: 'OEBPS/c1.xhtml', type: 'application/xhtml+xml', locations: {}, text: { highlight: 'x' } }) },
      { id: 'b', color: 'azul', anchor: 'quebrada' },
    ])
    const [lista, grupo] = nav.applyDecorations.mock.lastCall
    expect(grupo).toBe('marcacoes')
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ id: 'a', style: { type: 'highlight', tint: '#5fd38d' } })
    expect(lista[0].locator.text.highlight).toBe('x')
  })

  it('o toque na marcação abre a edição e não vira a página logo depois', async () => {
    const nav = navFalso()
    const aoTocarMarcacao = vi.fn()
    const aoClicar = vi.fn()
    await abrirEpub(opcoes({ aoTocarMarcacao, aoClicar }))
    const [grupo, observador] = nav.registerDecorationObserver.mock.calls[0]
    expect(grupo).toBe('marcacoes')
    // Falso: com verdadeiro, o Readium descartaria o toque seguinte, qualquer que fosse.
    expect(observador.onDecorationActivated({ decoration: { id: 'a' } })).toBe(false)
    expect(aoTocarMarcacao).toHaveBeenCalledWith('a')
    expect(nav.ouvintes.tap({ x: 10, y: 5 })).toBe(true)
    expect(aoClicar).not.toHaveBeenCalled()
  })

  it('aplica tema sem navegar e, ao mudar a letra, volta ao trecho da tela', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const nav = navFalso()
    const preferencias = opcoes().preferencias
    const motor = await abrirEpub(opcoes({ preferencias }))
    nav.ouvintes.positionChanged(local())

    await motor.aplicar({ ...preferencias, tema: 'escuro' })
    expect(nav.submitPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundColor: '#131315', textColor: '#d9d9de' }))
    expect(nav.go).not.toHaveBeenCalled()

    const fim = motor.aplicar({ ...preferencias, tema: 'escuro', fonte: 150 })
    await vi.advanceTimersByTimeAsync(200)
    await fim
    expect(nav.submitPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ fontSize: 1.5 }))
    expect(nav.go).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('salta para um percentual pelas posições', async () => {
    const nav = navFalso()
    const motor = await abrirEpub(opcoes())
    await motor.irParaPercentual(0.7)
    expect(nav.go.mock.lastCall[0].href).toBe('OEBPS/c2.xhtml')
    await motor.irParaPercentual(0.2)
    expect(nav.go.mock.lastCall[0].href).toBe('OEBPS/c1.xhtml')
  })

  it('só embute os arquivos do livro quando ele está baixado', async () => {
    estaBaixado.mockResolvedValue(true)
    navFalso()
    await abrirEpub(opcoes())
    expect(estaBaixado).toHaveBeenCalledWith('um livro')
  })

  it('libera o navegador ao fechar', async () => {
    const nav = navFalso()
    const motor = await abrirEpub(opcoes())
    motor.destruir()
    expect(nav.destroy).toHaveBeenCalled()
  })
})

describe('âncora da seleção', () => {
  function documentoCom(html) {
    const doc = document.implementation.createHTMLDocument()
    doc.body.innerHTML = html
    const selecao = { rangeCount: 0, isCollapsed: true, range: null }
    selecao.getRangeAt = () => selecao.range
    doc.getSelection = () => selecao
    return { doc, selecao }
  }

  it('guarda o trecho em volta, que separa frases repetidas', () => {
    const { doc, selecao } = documentoCom('<p>uma frase aqui</p><p>outra frase aqui</p>')
    const no = doc.querySelectorAll('p')[1].firstChild
    const trecho = doc.createRange()
    trecho.setStart(no, 6)
    trecho.setEnd(no, 11)
    Object.assign(selecao, { rangeCount: 1, isCollapsed: false, range: trecho })

    const ancora = ancoraDaSelecao(doc, { href: 'c.xhtml', type: 'application/xhtml+xml' })
    expect(ancora.texto).toBe('frase')
    expect(ancora.locator.href).toBe('c.xhtml')
    expect(ancora.locator.text).toEqual({ highlight: 'frase', before: 'uma frase aquioutra ', after: ' aqui' })
    expect(ancora.progresso).toBeCloseTo(20 / 30)
  })

  it('não há âncora sem seleção ou só com espaços', () => {
    const { doc, selecao } = documentoCom('<p>a   b</p>')
    expect(ancoraDaSelecao(doc, {})).toBeNull()
    const no = doc.querySelector('p').firstChild
    const trecho = doc.createRange()
    trecho.setStart(no, 1)
    trecho.setEnd(no, 4)
    Object.assign(selecao, { rangeCount: 1, isCollapsed: false, range: trecho })
    expect(ancoraDaSelecao(doc, {})).toBeNull()
  })
})

describe('trecho visível', () => {
  it('pega o primeiro texto dentro da página, pulando o que ficou para trás', () => {
    const doc = document.implementation.createHTMLDocument()
    doc.body.innerHTML = '<p>fora</p><p>dentro da página</p>'
    Object.defineProperty(doc, 'defaultView', { value: { innerWidth: 800 } })
    const original = Range.prototype.getBoundingClientRect
    Range.prototype.getBoundingClientRect = function retangulo() {
      const fora = this.startContainer.data === 'fora'
      return { left: fora ? -500 : 10, width: 5 }
    }
    expect(trechoVisivel(doc).highlight).toBe('dentro da página')
    Range.prototype.getBoundingClientRect = original
  })
})
