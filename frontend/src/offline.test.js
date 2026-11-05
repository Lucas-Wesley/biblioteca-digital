import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baixarLivro, estaBaixado, livrosBaixados, removerDownload } from './offline.js'

vi.mock('./dados.js', () => ({
  lerProgresso: vi.fn(async () => ({})),
  lerAnotacoes: vi.fn(async () => []),
}))

function cachesFalsos() {
  const armazenados = new Map()
  const abrir = async (nome) => {
    if (!armazenados.has(nome)) armazenados.set(nome, new Map())
    const mapa = armazenados.get(nome)
    return { put: async (url, resposta) => mapa.set(String(url), resposta) }
  }
  vi.stubGlobal('caches', {
    open: vi.fn(abrir),
    delete: vi.fn(async (nome) => armazenados.delete(nome)),
    keys: vi.fn(async () => [...armazenados.keys()]),
    match: vi.fn(async (url, { cacheName }) => armazenados.get(cacheName)?.get(String(url))),
  })
  return armazenados
}

const manifesto = {
  links: [{ rel: 'self', href: 'manifest.json' }, { href: 'positions.json' }],
  readingOrder: [{ href: 'OEBPS/cap%201.xhtml' }],
  resources: [{ href: 'OEBPS/a.css' }, { href: 'OEBPS/a.css' }],
}

function comServidor(falhaEm) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (falhaEm && String(url).endsWith(falhaEm)) return new Response('', { status: 500 })
    return new Response(String(url).endsWith('manifest.json') ? JSON.stringify(manifesto) : 'x', { status: 200 })
  }))
}

describe('download de livros', () => {
  let armazenados

  beforeEach(() => {
    armazenados = cachesFalsos()
    vi.stubGlobal('navigator', { ...navigator, storage: { persist: vi.fn(async () => true) } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('baixa capa, manifesto, posições e cada arquivo do EPUB, uma vez cada', async () => {
    comServidor()
    const progresso = vi.fn()
    await baixarLivro({ id: 'a', format: 'epub', has_cover: true }, progresso)

    expect(navigator.storage.persist).toHaveBeenCalled()
    const urls = [...armazenados.get('livro-a').keys()]
    expect(urls).toEqual(expect.arrayContaining([
      '/api/books/a/cover',
      '/api/books/a/publication/manifest.json',
      '/api/books/a/publication/positions.json',
      '/api/books/a/publication/OEBPS/cap%201.xhtml',
      '/api/books/a/publication/OEBPS/a.css',
      '/api/books/a/.baixado',
    ]))
    expect(urls).toHaveLength(6)
    expect(progresso).toHaveBeenLastCalledWith(1)
    expect(await estaBaixado('a')).toBe(true)
    expect(await livrosBaixados()).toEqual(new Set(['a']))
  })

  it('o PDF é um arquivo só', async () => {
    comServidor()
    await baixarLivro({ id: 'p', format: 'pdf', has_cover: false })
    expect([...armazenados.get('livro-p').keys()]).toEqual(['/api/books/p/file', '/api/books/p/.baixado'])
  })

  it('um download interrompido não fica pela metade', async () => {
    comServidor('a.css')
    await expect(baixarLivro({ id: 'a', format: 'epub' })).rejects.toThrow()
    expect(armazenados.has('livro-a')).toBe(false)
    expect(await estaBaixado('a')).toBe(false)
  })

  it('só conta como baixado o que terminou, e remover apaga tudo', async () => {
    comServidor()
    await baixarLivro({ id: 'a', format: 'pdf' })
    armazenados.set('livro-pela-metade', new Map([['/x', 'y']]))
    armazenados.set('workbox-precache', new Map())
    expect(await livrosBaixados()).toEqual(new Set(['a']))

    await removerDownload('a')
    expect(await estaBaixado('a')).toBe(false)
  })
})
