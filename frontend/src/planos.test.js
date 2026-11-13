import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sincronizar, tentarRedeDeNovo } from './dados.js'
import {
  capitulosParaPlano, detalheDaMeta, estadoDoPlano, fimDaMeta, itemNaMeta, marcarDoLeitor, marcarMeta, metaDoLivro, metaParaLer,
  porDiaParaTerminar, previsao, resumo, rotuloDaMeta, situacao,
} from './planos.js'

const config = { total: 8, first: 5, per_day: 1, weekdays: '0123456', start_day: '2026-11-13' }

describe('planos de leitura', () => {
  it('a previsão é a mesma conta do servidor', () => {
    expect(previsao(config)).toEqual({ dias: 4, fim: '2026-11-16' })
    // Só nos dias úteis: sexta (13), segunda, terça, quarta.
    expect(previsao({ ...config, weekdays: '12345' })).toEqual({ dias: 4, fim: '2026-11-18' })
    expect(previsao({ ...config, total: 300, first: 1, per_day: 20 })).toEqual({ dias: 15, fim: '2026-11-27' })
    expect(previsao({ ...config, per_day: 0 })).toBeNull()
  })

  it('o ritmo para terminar até uma data', () => {
    expect(porDiaParaTerminar({ ...config, total: 300, first: 1 }, '2026-11-27')).toBe(20)
    expect(porDiaParaTerminar(config, '2026-11-30')).toBe(1)
    expect(porDiaParaTerminar(config, '2026-11-01')).toBeNull()
  })

  it('o rótulo usa os nomes do sumário quando há', () => {
    const fisico = { unit: 'capitulos', chapters: [] }
    expect(rotuloDaMeta(fisico, { from: 5, to: 5 })).toBe('Capítulo 5')
    expect(rotuloDaMeta(fisico, { from: 5, to: 6 })).toBe('Capítulos 5 a 6')
    expect(rotuloDaMeta({ unit: 'paginas' }, { from: 40, to: 49 })).toBe('Páginas 40 a 49')
    expect(detalheDaMeta({ unit: 'paginas' }, { from: 40, to: 49 })).toBe('10 páginas')

    const digital = { unit: 'capitulos', chapters: [{ title: 'Prefácio' }, { title: 'I. A chegada' }, { title: 'II. A casa' }] }
    expect(rotuloDaMeta(digital, { from: 2, to: 2 })).toBe('I. A chegada')
    expect(rotuloDaMeta(digital, { from: 2, to: 3 })).toBe('I. A chegada → II. A casa')
    expect(detalheDaMeta(digital, { from: 2, to: 3 })).toBe('Capítulos 2 a 3')
  })

  it('o resumo conta o lido, as atrasadas e o fim', () => {
    const plano = {
      ...config, unit: 'capitulos',
      goals: [
        { id: 1, day: '2026-11-13', from: 5, to: 5, state: 'lida' },
        { id: 2, day: '2026-11-14', from: 6, to: 6, state: '' },
        { id: 3, day: '2026-11-15', from: 7, to: 7, state: '' },
        { id: 4, day: '2026-11-16', from: 8, to: 8, state: '' },
      ],
    }
    const r = resumo(plano, '2026-11-15')
    expect(r).toMatchObject({ lidas: 1, noPlano: 4, fracao: 0.25, atrasadas: 1, fim: '2026-11-16', concluido: false })
    expect(r.proxima.id).toBe(3)
    expect(r.hoje.map((m) => m.id)).toEqual([3])
    expect(situacao(plano.goals[1], '2026-11-15')).toBe('atrasada')
    expect(situacao(plano.goals[2], '2026-11-15')).toBe('hoje')
    expect(situacao(plano.goals[0], '2026-11-15')).toBe('lida')
  })

  it('pega o primeiro nível do sumário, ou o segundo se o livro é dividido em partes', () => {
    const c = (title, level) => ({ title, level, first_page: 1, last_page: 2 })
    expect(capitulosParaPlano([c('A', 1), c('a1', 2), c('B', 1), c('C', 1)]).map((x) => x.title)).toEqual(['A', 'B', 'C'])
    expect(capitulosParaPlano([c('Parte 1', 1), c('Cap 1', 2), c('Cap 2', 2)]).map((x) => x.title)).toEqual(['Parte 1', 'Cap 1', 'Cap 2'])
  })

  const sumario = [
    { title: 'Prefácio', first_page: 7, last_page: 10 },
    { title: 'I. A chegada', first_page: 11, last_page: 28 },
    { title: 'II. A casa', first_page: 29, last_page: 46 },
    { title: 'III. O fim', first_page: 47, last_page: 60 },
  ]
  const meta = (id, day, from, to, state = '') => ({ id, day, from, to, state })

  it('nas metas por página, mostra os capítulos que caem nelas', () => {
    const plano = { unit: 'paginas', total: 60, chapters: sumario }
    expect(detalheDaMeta(plano, { from: 20, to: 35 })).toBe('16 páginas · I. A chegada, II. A casa')
    expect(detalheDaMeta(plano, { from: 1, to: 60 })).toBe('60 páginas · Prefácio … III. O fim')
  })

  it('até onde vai a meta no livro, pelas páginas do sumário', () => {
    expect(fimDaMeta({ unit: 'paginas', total: 200 }, { to: 50 })).toBe(0.25)
    expect(fimDaMeta({ unit: 'capitulos', chapters: sumario }, { to: 2 })).toBeCloseTo(28 / 60)
    expect(fimDaMeta({ unit: 'capitulos', chapters: [{ title: 'Um' }] }, { to: 1 })).toBeNull()
  })

  it('a situação do plano na listagem', () => {
    const base = { unit: 'capitulos', total: 4, first: 1, chapters: sumario, book_id: 'b', percent: 0 }
    const hoje = '2026-11-15'
    const emDia = { ...base, goals: [meta(1, '2026-11-14', 1, 1, 'lida'), meta(2, hoje, 2, 2), meta(3, '2026-11-16', 3, 4)] }
    expect(estadoDoPlano(emDia, hoje).tipo).toBe('hoje')
    emDia.goals[1].state = 'lida'
    expect(estadoDoPlano(emDia, hoje)).toEqual({ tipo: 'feito', texto: 'Meta de hoje feita' })

    const atrasado = { ...base, goals: [meta(1, '2026-11-13', 1, 1, 'nao-lida'), meta(2, '2026-11-14', 2, 2), meta(3, hoje, 3, 4)] }
    expect(estadoDoPlano(atrasado, hoje)).toEqual({ tipo: 'atrasado', texto: 'Atrasado: 1 meta sem marcar e 1 não lida' })
    // O leitor já passou do capítulo 2 (página 46 de 60): leu e esqueceu de marcar.
    expect(estadoDoPlano({ ...atrasado, percent: 0.8 }, hoje).tipo).toBe('falta-marcar')
    // Livro físico não tem leitor: só o atraso.
    expect(estadoDoPlano({ ...atrasado, book_id: '', percent: 0.8 }, hoje).tipo).toBe('atrasado')
    expect(metaParaLer(atrasado).id).toBe(1)
  })

  it('o sumário do leitor destaca os capítulos da meta', () => {
    const plano = { unit: 'capitulos', chapters: sumario }
    expect(itemNaMeta(plano, { from: 2, to: 3 }, { rotulo: 'II.  A casa', destino: 'x.xhtml' }, false)).toBe(true)
    expect(itemNaMeta(plano, { from: 2, to: 3 }, { rotulo: 'III. O fim', destino: 'y.xhtml' }, false)).toBe(false)
    // No PDF vale também a página: um subitem dentro do capítulo da meta.
    expect(itemNaMeta(plano, { from: 2, to: 2 }, { rotulo: 'Subitem', destino: 15 }, true)).toBe(true)
    expect(itemNaMeta({ unit: 'paginas' }, { from: 10, to: 20 }, { rotulo: 'x', destino: 12 }, true)).toBe(true)
  })

  describe('marcar', () => {
    beforeEach(() => localStorage.clear())
    afterEach(() => vi.unstubAllGlobals())

    it('marca no aparelho e manda pela fila, mesmo sem rede', async () => {
      tentarRedeDeNovo()
      vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
      const meta = { id: 7, day: '2026-11-13', from: 5, to: 5, state: '' }
      const planos = [{ id: 'p1', goals: [meta] }]
      marcarMeta(planos, planos[0], meta, 'lida')
      await sincronizar()
      expect(JSON.parse(localStorage.getItem('biblioteca-planos'))[0].goals[0].state).toBe('lida')
      expect(Object.keys(JSON.parse(localStorage.getItem('biblioteca-fila')))).toEqual(['meta-p1-7'])

      tentarRedeDeNovo()
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 204 })))
      await sincronizar()
      expect(fetch).toHaveBeenCalledWith('/api/plans/p1/goals/7', expect.objectContaining({ method: 'PUT', body: '{"state":"lida"}' }))
      expect(JSON.parse(localStorage.getItem('biblioteca-fila'))).toEqual({})
    })

    it('o leitor acha a meta do livro e marca pela cópia do aparelho', async () => {
      tentarRedeDeNovo()
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 204 })))
      const planos = [{ id: 'p1', book_id: 'livro', goals: [meta(1, '2026-11-13', 1, 1, 'lida'), meta(2, '2026-11-14', 2, 2)] }]
      localStorage.setItem('biblioteca-planos', JSON.stringify(planos))
      expect(metaDoLivro('livro').meta.id).toBe(2)
      expect(metaDoLivro('outro')).toBeNull()
      localStorage.setItem('biblioteca-planos', JSON.stringify([...planos, { id: 'p2', book_id: 'livro', goals: [meta(9, '2026-11-14', 1, 9)] }]))
      expect(metaDoLivro('livro', 'p2').meta.id).toBe(9)
      localStorage.setItem('biblioteca-planos', JSON.stringify(planos))
      marcarDoLeitor('p1', 2, 'lida')
      await sincronizar()
      expect(metaDoLivro('livro')).toBeNull()
      expect(fetch).toHaveBeenCalledWith('/api/plans/p1/goals/2', expect.objectContaining({ body: '{"state":"lida"}' }))
    })
  })
})
