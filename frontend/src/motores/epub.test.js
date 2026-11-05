import { beforeEach, describe, expect, it, vi } from 'vitest'
import ePub from 'epubjs'
import { abrirEpub } from './epub.js'

vi.mock('epubjs', () => ({ default: vi.fn() }))

function epubFalso(toc = []) {
  const eventos = {}
  const rendition = {
    on: vi.fn((nome, funcao) => { eventos[nome] = funcao }),
    display: vi.fn(async () => {}),
    next: vi.fn(),
    prev: vi.fn(),
    resize: vi.fn(),
    getContents: vi.fn(() => []),
    themes: { fontSize: vi.fn() },
    hooks: { content: { register: vi.fn() } },
  }
  const instancia = {
    renderTo: vi.fn(() => rendition),
    destroy: vi.fn(),
    loaded: { navigation: Promise.resolve({ toc }) },
    spine: { length: 4, get: vi.fn((href) => ({ 'c1.xhtml': { index: 0 }, 'c2.xhtml': { index: 2 } })[href.split('#')[0]]) },
  }
  ePub.mockReturnValue(instancia)
  return { rendition, instancia, eventos }
}

function opcoes(extra = {}) {
  return {
    livro: { id: 'quincas borba' },
    area: document.createElement('div'),
    preferencias: { tema: 'claro', fonte: 120 },
    aoMudar: vi.fn(),
    aoClicar: vi.fn(),
    aoDeslizar: vi.fn(),
    aoTeclar: vi.fn(),
    ...extra,
  }
}

describe('motor de EPUB', () => {
  beforeEach(() => ePub.mockReset())

  it('abre o arquivo pela API, na posição salva e com a fonte escolhida', async () => {
    const { rendition } = epubFalso()
    await abrirEpub(opcoes({ posicao: 'epubcfi(/6/4)' }))
    expect(ePub).toHaveBeenCalledWith('/api/books/quincas%20borba/file', { openAs: 'epub' })
    expect(rendition.display).toHaveBeenCalledWith('epubcfi(/6/4)')
    expect(rendition.themes.fontSize).toHaveBeenCalledWith('120%')
  })

  it('volta ao início se a posição salva não vale mais', async () => {
    const { rendition } = epubFalso()
    rendition.display.mockRejectedValueOnce(new Error('CFI inválido'))
    await abrirEpub(opcoes({ posicao: 'lixo' }))
    expect(rendition.display).toHaveBeenLastCalledWith()
  })

  it('propaga o erro de um livro que não abre', async () => {
    const { rendition } = epubFalso()
    rendition.display.mockRejectedValue(new Error('arquivo inválido'))
    await expect(abrirEpub(opcoes())).rejects.toThrow('arquivo inválido')
  })

  it('achata o sumário com os níveis', async () => {
    epubFalso([
      { label: ' Parte 1 ', href: 'c1.xhtml', subitems: [{ label: 'Cap 1', href: 'c1.xhtml#a', subitems: [] }] },
      { label: 'Parte 2', href: 'c2.xhtml', subitems: [] },
    ])
    const motor = await abrirEpub(opcoes())
    expect(motor.sumario().map(({ rotulo, destino, nivel }) => [rotulo, destino, nivel])).toEqual([
      ['Parte 1', 'c1.xhtml', 0],
      ['Cap 1', 'c1.xhtml#a', 1],
      ['Parte 2', 'c2.xhtml', 0],
    ])
  })

  it('avisa a posição, o percentual e o capítulo atual', async () => {
    const { eventos } = epubFalso([
      { label: 'Um', href: 'c1.xhtml', subitems: [] },
      { label: 'Dois', href: 'c2.xhtml', subitems: [] },
    ])
    const aoMudar = vi.fn()
    await abrirEpub(opcoes({ aoMudar }))
    eventos.relocated({ start: { cfi: 'epubcfi(/6/6)', index: 2, displayed: { page: 3, total: 5 } } })
    expect(aoMudar).toHaveBeenCalledWith({
      posicao: 'epubcfi(/6/6)',
      percentual: (2 + 2 / 5) / 4,
      capitulo: 'c2.xhtml',
      rotulo: 'Dois',
    })
    eventos.relocated({ atEnd: true, start: { cfi: 'x', index: 3 } })
    expect(aoMudar.mock.lastCall[0].percentual).toBe(1)
  })

  it('ignora clique em link e desliza com o dedo', async () => {
    const { eventos } = epubFalso()
    const aoClicar = vi.fn()
    const aoDeslizar = vi.fn()
    await abrirEpub(opcoes({ aoClicar, aoDeslizar }))
    eventos.click({ target: { closest: () => ({}) }, clientX: 10 })
    expect(aoClicar).not.toHaveBeenCalled()
    eventos.click({ target: { closest: () => null }, clientX: 10 })
    expect(aoClicar).toHaveBeenCalledWith(10)

    eventos.touchstart({ changedTouches: [{ screenX: 200, screenY: 10 }] })
    eventos.touchend({ changedTouches: [{ screenX: 100, screenY: 15 }] })
    expect(aoDeslizar).toHaveBeenCalledWith('proxima')
  })

  it('aplica fonte e tema sem reabrir o livro e libera ao fechar', async () => {
    const { rendition, instancia } = epubFalso()
    const motor = await abrirEpub(opcoes())
    motor.aplicar({ tema: 'escuro', fonte: 150 })
    expect(rendition.themes.fontSize).toHaveBeenLastCalledWith('150%')
    motor.redimensionar()
    expect(rendition.resize).toHaveBeenCalledWith(null, null)
    motor.destruir()
    expect(instancia.destroy).toHaveBeenCalled()
  })
})
