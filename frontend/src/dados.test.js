import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apagarAnotacao, carregarLivros, haPendencias, lerAnotacoes, lerProgresso,
  salvarAnotacao, salvarProgresso, sincronizar, tentarRedeDeNovo,
} from './dados.js'

function comRede(rotas = {}) {
  tentarRedeDeNovo()
  vi.stubGlobal('fetch', vi.fn(async (url, opcoes) => {
    const resposta = rotas[`${opcoes?.method ?? 'GET'} ${url}`]
    return resposta ?? { ok: true, status: 204, json: async () => ({}) }
  }))
}

function semRede() {
  tentarRedeDeNovo()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
}

function pedidos(metodo) {
  return fetch.mock.calls.filter(([, opcoes]) => (opcoes?.method ?? 'GET') === metodo)
}

const json = (corpo) => ({ ok: true, status: 200, json: async () => corpo })

describe('dados no aparelho', () => {
  beforeEach(() => localStorage.clear())
  afterEach(async () => {
    comRede()
    await sincronizar()
    vi.unstubAllGlobals()
  })

  it('sem rede, o progresso fica na fila e sobe quando a rede volta', async () => {
    semRede()
    salvarProgresso('a', 'pos', 0.5)
    await sincronizar()
    expect(haPendencias()).toBe(true)

    comRede()
    await sincronizar()
    expect(haPendencias()).toBe(false)
    const [url, opcoes] = pedidos('PUT')[0]
    expect(url).toBe('/api/books/a/progress')
    expect(opcoes.keepalive).toBe(true)
    expect(JSON.parse(opcoes.body)).toMatchObject({ position: 'pos', percent: 0.5, updated_at: expect.any(String) })
  })

  it('só o progresso mais novo de cada livro entra na fila', async () => {
    semRede()
    salvarProgresso('a', 'velho', 0.1)
    salvarProgresso('a', 'novo', 0.2)
    await sincronizar()
    comRede()
    await sincronizar()
    expect(pedidos('PUT')).toHaveLength(1)
    expect(JSON.parse(pedidos('PUT')[0][1].body).position).toBe('novo')
  })

  it('o servidor fora do ar mantém a fila, e uma recusa definitiva tira o item dela', async () => {
    comRede({ 'PUT /api/books/a/progress': { ok: false, status: 500 } })
    salvarProgresso('a', 'pos', 0.5)
    await sincronizar()
    expect(haPendencias()).toBe(true)

    comRede({ 'PUT /api/books/a/progress': { ok: false, status: 404 } })
    await sincronizar()
    expect(haPendencias()).toBe(false)
  })

  it('lê o progresso mais recente entre o aparelho e o servidor', async () => {
    semRede()
    salvarProgresso('a', 'do-aparelho', 0.5)
    expect((await lerProgresso('a')).position).toBe('do-aparelho')

    // Outro aparelho leu depois
    comRede({ 'GET /api/books/a/progress': json({ position: 'do-mac', percent: 0.9, updated_at: '2099-01-01T00:00:00.000Z' }) })
    expect((await lerProgresso('a')).position).toBe('do-mac')

    // E, sem rede de novo, o último visto continua valendo
    semRede()
    expect((await lerProgresso('a')).position).toBe('do-mac')
  })

  it('depois de uma falha de rede, não espera a rede de novo até o aparelho avisar', async () => {
    semRede()
    await lerProgresso('a')
    const tentativas = fetch.mock.calls.length
    expect(tentativas).toBe(1)
    await lerProgresso('a')
    await lerAnotacoes('a')
    expect(fetch.mock.calls.length).toBe(tentativas)

    tentarRedeDeNovo()
    await lerProgresso('a')
    expect(fetch.mock.calls.length).toBe(tentativas + 1)
  })

  it('sem rede e sem nada guardado, abre do início', async () => {
    semRede()
    expect(await lerProgresso('z')).toEqual({})
  })

  it('a marcação feita sem rede aparece na hora e sobe depois', async () => {
    semRede()
    const nova = salvarAnotacao('a', { id: 'm1', color: 'verde', note: '', quote: 'q', anchor: '{}', label: '', percent: 0.5 })
    expect(nova.created_at).toBeTruthy()
    expect(nova.updated_at).toBeTruthy()
    expect(await lerAnotacoes('a')).toEqual([nova])

    comRede({ 'GET /api/books/a/annotations': json([]) })
    await sincronizar()
    expect(pedidos('PUT')[0][0]).toBe('/api/books/a/annotations/m1')
    expect(haPendencias()).toBe(false)
  })

  it('o que ainda não subiu vale sobre a lista do servidor', async () => {
    const velha = { id: 'm1', color: 'verde', note: 'do servidor', percent: 0.5, created_at: '2026-01-01' }
    comRede({ 'GET /api/books/a/annotations': json([velha]) })
    expect(await lerAnotacoes('a')).toEqual([velha])

    // Enquanto a fila não consegue subir, a edição local continua aparecendo
    comRede({
      'GET /api/books/a/annotations': json([velha]),
      'PUT /api/books/a/annotations/m1': { ok: false, status: 500 },
      'DELETE /api/books/a/annotations/m2': { ok: false, status: 500 },
    })
    salvarAnotacao('a', { ...velha, note: 'editada' })
    const lista = await lerAnotacoes('a')
    expect(lista).toHaveLength(1)
    expect(lista[0].note).toBe('editada')

    comRede({
      'GET /api/books/a/annotations': json([velha]),
      'DELETE /api/books/a/annotations/m1': { ok: false, status: 500 },
    })
    apagarAnotacao('a', 'm1')
    expect(await lerAnotacoes('a')).toEqual([])
  })

  it('o Início guarda a lista e abre com ela sem rede, com o progresso local', async () => {
    const livro = { id: 'a', title: 'A', percent: 0.1, read_at: '2026-01-01T00:00:00.000Z' }
    comRede({ 'GET /api/books': json([livro]) })
    expect(await carregarLivros()).toEqual({ livros: [livro], semConexao: false })

    semRede()
    salvarProgresso('a', 'pos', 0.7)
    const { livros, semConexao } = await carregarLivros()
    expect(semConexao).toBe(true)
    expect(livros[0].percent).toBe(0.7)
  })
})
