import { describe, expect, it } from 'vitest'
import { calcular, duracao, paginas, somarDias } from './estatisticas.js'

const r = (day, minutos, pages = 0, book_id = 'a', device = 'cel', book_pages = 200) => ({
  device, day, book_id, seconds: minutos * 60, pages, book_pages,
})
const livros = [{ id: 'a', title: 'Dom Casmurro', author: 'Machado', percent: 0.5 }]

describe('estatísticas', () => {
  it('soma hoje, a semana e o total, com os aparelhos juntos', () => {
    const d = calcular([
      r('2026-11-06', 20, 10), r('2026-11-06', 10, 5, 'a', 'tablet'),
      r('2026-11-01', 30, 15), r('2026-10-01', 60, 30),
    ], livros, '2026-11-06')
    expect(d.hoje).toEqual({ segundos: 1800, paginas: 15 })
    expect(d.semana).toEqual({ segundos: 3600, paginas: 30 })
    expect(d.total).toEqual({ segundos: 7200, paginas: 60, dias: 3 })
  })

  it('dia com menos de 1 minuto não é dia de leitura', () => {
    const d = calcular([r('2026-11-06', 0.5, 0), r('2026-11-05', 5)], livros, '2026-11-06')
    expect([...d.lidos]).toEqual(['2026-11-05'])
    expect(d.total.dias).toBe(1)
  })

  it('a sequência atual não quebra antes de o dia acabar', () => {
    const dias = ['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-05'].map((dia) => r(dia, 10))
    expect(calcular(dias, livros, '2026-11-06').sequencia).toEqual({ atual: 2, maior: 2 })
    expect(calcular([...dias, r('2026-11-06', 10)], livros, '2026-11-06').sequencia).toEqual({ atual: 3, maior: 3 })
    expect(calcular(dias, livros, '2026-11-07').sequencia.atual).toBe(0)
  })

  it('as médias: nos dias lidos e por dia, desde a primeira leitura até 30 dias', () => {
    const d = calcular([r('2026-11-04', 30, 20), r('2026-11-06', 10, 4)], livros, '2026-11-06')
    expect(d.media.nosDiasLidos).toEqual({ segundos: 1200, paginas: 12 })
    // De 4 a 6 de novembro são 3 dias, um deles sem leitura.
    expect(d.media.porDia).toEqual({ segundos: 800, paginas: 8, dias: 3 })

    const antigo = calcular([r('2026-01-01', 600), r('2026-11-06', 30)], livros, '2026-11-06')
    expect(antigo.media.porDia).toEqual({ segundos: 60, paginas: 0, dias: 30 })
  })

  it('por livro: ritmo e previsão de quanto falta', () => {
    const d = calcular([r('2026-11-05', 30, 20), r('2026-11-06', 30, 20)], livros, '2026-11-06')
    const [livro] = d.livros
    expect(livro).toMatchObject({ titulo: 'Dom Casmurro', segundos: 3600, paginas: 40, ritmo: 40 })
    // Metade de 200 páginas, a 40 por hora: 2h30.
    expect(livro.faltam).toBe(9000)
  })

  it('sem 10 minutos no livro, não há ritmo nem previsão', () => {
    const [livro] = calcular([r('2026-11-06', 5, 3)], livros, '2026-11-06').livros
    expect(livro.ritmo).toBeNull()
    expect(livro.faltam).toBeNull()
  })

  it('mostra tempo e páginas por extenso', () => {
    expect(duracao(20)).toBe('menos de 1 min')
    expect(duracao(45)).toBe('1 min')
    expect(duracao(59 * 60)).toBe('59 min')
    expect(duracao(3600)).toBe('1h')
    expect(duracao(3600 + 5 * 60)).toBe('1h05')
    expect(paginas(1.2)).toBe('1 página')
    expect(paginas(1234)).toBe('1.234 páginas')
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01')
  })
})
