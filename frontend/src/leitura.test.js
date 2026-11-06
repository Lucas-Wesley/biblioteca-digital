import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sincronizar, tentarRedeDeNovo } from './dados.js'
import { PAUSA, TEMPO_NA_PAGINA, aparelho, criarContador, diaDe, juntarRegistros, lerRegistros } from './leitura.js'

// Um relógio de mentira: cada passo avança o tempo e dá os tiques de 1 segundo do leitor.
function relogio(inicio) {
  let agora = new Date(inicio).getTime()
  return {
    agora: () => agora,
    passar(contador, ms) {
      for (let i = 0; i < ms; i += 1000) {
        agora += 1000
        contador.tique()
      }
    },
  }
}

const guardado = () => JSON.parse(localStorage.getItem('biblioteca-leitura'))
const pagina = (unidade, porUnidade = 1) => ({ unidade, porUnidade, totalDePaginas: 300 })

function semRede() {
  tentarRedeDeNovo()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
}

describe('contador de leitura', () => {
  beforeEach(() => {
    localStorage.clear()
    semRede()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('o dia é o de Brasília, não o do relógio UTC', () => {
    expect(diaDe(new Date('2026-11-07T02:30:00Z'))).toBe('2026-11-06')
    expect(diaDe(new Date('2026-11-07T03:00:00Z'))).toBe('2026-11-07')
  })

  it('conta o tempo e as páginas que ficaram na tela', () => {
    const r = relogio('2026-11-06T13:00:00Z')
    const c = criarContador('livro', { agora: r.agora })
    c.mudou(pagina(10))
    r.passar(c, 60000)
    c.mudou(pagina(11), true)
    r.passar(c, 2000) // folheou: 2 segundos não fazem a página contar
    c.mudou(pagina(12), true)
    r.passar(c, 30000)
    c.encerrar()
    const dia = guardado()['2026-11-06'].livro
    // O primeiro tique só começa a medir: 59 + 2 + 30 segundos.
    expect(Math.round(dia.segundos)).toBe(91)
    expect(dia.unidades.sort()).toEqual([10, 12])
    expect(dia.paginas).toBe(2)
    expect(dia.totalDePaginas).toBe(300)
  })

  it('para de contar depois de 5 minutos parado e volta no próximo toque', () => {
    const r = relogio('2026-11-06T13:00:00Z')
    const c = criarContador('livro', { agora: r.agora })
    c.mudou(pagina(1))
    r.passar(c, PAUSA + 60 * 60 * 1000) // dormiu com o livro aberto por uma hora
    c.atividade()
    r.passar(c, 10000)
    c.encerrar()
    // Os 5 minutos até a pausa contam; a hora parada, não; os segundos depois do toque, sim.
    expect(Math.round(guardado()['2026-11-06'].livro.segundos)).toBe(PAUSA / 1000 - 1 + 9)
  })

  it('com o app escondido, não conta', () => {
    const r = relogio('2026-11-06T13:00:00Z')
    const c = criarContador('livro', { agora: r.agora })
    c.mudou(pagina(1))
    r.passar(c, 10000)
    c.visivel(false)
    r.passar(c, 60000)
    c.visivel(true)
    r.passar(c, 10000)
    c.encerrar()
    expect(Math.round(guardado()['2026-11-06'].livro.segundos)).toBe(18)
  })

  it('a leitura que passa da meia-noite se divide entre os dois dias', () => {
    const r = relogio('2026-11-07T02:58:00Z') // 23h58 em Brasília
    const c = criarContador('livro', { agora: r.agora })
    c.mudou(pagina(1))
    r.passar(c, 4 * 60 * 1000)
    c.encerrar()
    expect(Math.round(guardado()['2026-11-06'].livro.segundos)).toBe(118)
    expect(Math.round(guardado()['2026-11-07'].livro.segundos)).toBe(121)
  })

  it('no EPUB, as posições de uma tela lida contam juntas, mas um salto não', () => {
    const r = relogio('2026-11-06T13:00:00Z')
    const c = criarContador('livro', { agora: r.agora })
    c.mudou(pagina(5, 0.5))
    r.passar(c, TEMPO_NA_PAGINA + 1000)
    c.mudou(pagina(8, 0.5), true) // a tela tinha as posições 5, 6 e 7
    r.passar(c, TEMPO_NA_PAGINA + 1000)
    c.mudou(pagina(200, 0.5), true) // pulou pela barra: o meio não foi lido
    r.passar(c, TEMPO_NA_PAGINA + 1000)
    c.encerrar()
    const dia = guardado()['2026-11-06'].livro
    expect(dia.unidades.sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 200])
    expect(dia.paginas).toBe(2.5)
  })

  it('reler a mesma página no mesmo dia não conta duas vezes, nem com dois leitores abertos', () => {
    const r = relogio('2026-11-06T13:00:00Z')
    for (let i = 0; i < 2; i++) {
      const c = criarContador('livro', { agora: r.agora })
      c.mudou(pagina(1))
      r.passar(c, 10000)
      c.encerrar()
    }
    const dia = guardado()['2026-11-06'].livro
    expect(dia.paginas).toBe(1)
    expect(Math.round(dia.segundos)).toBe(18)
  })

  it('o total do dia vai para a fila com o aparelho, para subir quando houver rede', async () => {
    const r = relogio('2026-11-06T13:00:00Z')
    const c = criarContador('livro', { agora: r.agora })
    c.mudou(pagina(1))
    r.passar(c, 10000)
    c.encerrar()
    await sincronizar()
    const fila = JSON.parse(localStorage.getItem('biblioteca-fila'))
    const pedido = fila['leitura:2026-11-06:livro']
    expect(pedido.url).toBe('/api/books/livro/reading/2026-11-06')
    expect(JSON.parse(pedido.corpo)).toEqual({ device: aparelho(), seconds: 9, pages: 1, book_pages: 300 })
  })
})

describe('registros para as estatísticas', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('do mesmo aparelho vale o maior total; aparelhos diferentes somam à parte', () => {
    const servidor = [
      { device: 'a', day: '2026-11-06', book_id: 'x', seconds: 600, pages: 10, book_pages: 300 },
      { device: 'b', day: '2026-11-06', book_id: 'x', seconds: 60, pages: 1, book_pages: 300 },
    ]
    const locais = [{ device: 'a', day: '2026-11-06', book_id: 'x', seconds: 900, pages: 12, book_pages: 300 }]
    const juntos = juntarRegistros(servidor, locais)
    expect(juntos).toHaveLength(2)
    expect(juntos.find((r) => r.device === 'a')).toMatchObject({ seconds: 900, pages: 12 })
  })

  it('sem rede, mostra a última cópia do servidor mais o que este aparelho contou', async () => {
    localStorage.setItem('biblioteca-leitura-servidor', JSON.stringify([
      { device: 'outro', day: '2026-11-05', book_id: 'x', seconds: 300, pages: 5, book_pages: 100 },
    ]))
    const r = relogio('2026-11-06T13:00:00Z')
    const c = criarContador('x', { agora: r.agora })
    c.mudou(pagina(1))
    r.passar(c, 10000)
    c.encerrar()
    semRede()
    const { registros, semConexao } = await lerRegistros()
    expect(semConexao).toBe(true)
    expect(registros.map((x) => x.day).sort()).toEqual(['2026-11-05', '2026-11-06'])
  })
})
