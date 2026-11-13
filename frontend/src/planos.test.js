import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sincronizar, tentarRedeDeNovo } from './dados.js'
import {
  capitulosParaPlano, detalheDaMeta, marcarMeta, porDiaParaTerminar, previsao, resumo, rotuloDaMeta, situacao,
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
  })
})
