import { describe, expect, it } from 'vitest'
import { aprenderLigaduras, corrigirLigaduras, juntarLinhas, lerPosicao, montarTexto } from './texto-pdf.js'

const MARGEM = 80
const DIREITA = 520

// Uma linha do PDF como o getTextContent() entrega: posição, altura e fim de linha.
function linha(texto, y, { x = MARGEM, altura = 12, largura = DIREITA - x } = {}) {
  return { str: texto, transform: [altura, 0, 0, altura, x, y], width: largura, height: altura, hasEOL: true }
}

// Linhas do corpo, de cima para baixo, com a entrelinha comum.
function corpo(textos, { topo = 700, recuos = [] } = {}) {
  return textos.map((texto, i) => linha(texto, topo - i * 16, recuos.includes(i) ? { x: MARGEM + 18 } : {}))
}

describe('montarTexto', () => {
  it('junta o parágrafo que passa de uma página para outra e marca onde a página começa', () => {
    const blocos = montarTexto([
      { numero: 1, itens: corpo(['Era uma vez um leitor que', 'lia no celular e queria']) },
      { numero: 2, itens: corpo(['ler sem zoom.', 'Outro parágrafo começa aqui.'], { recuos: [1] }) },
    ])

    expect(blocos.map((b) => b.texto)).toEqual([
      'Era uma vez um leitor que lia no celular e queria ler sem zoom.',
      'Outro parágrafo começa aqui.',
    ])
    expect(blocos[0].marcas).toEqual([{ pagina: 1, posicao: 0 }, { pagina: 2, posicao: 50 }])
    expect(blocos[0].texto.slice(50)).toBe('ler sem zoom.')
  })

  it('separa título, versos recuados e notas de rodapé, que vão para depois do parágrafo', () => {
    const blocos = montarTexto([{
      numero: 1,
      itens: [
        linha('CAPÍTULO UM', 740, { altura: 20 }),
        ...corpo(['Disse ele:1', 'Primeiro verso,', 'segundo verso.', 'E seguiu a conversa'], { topo: 700 })
          .map((item, i) => (i === 1 || i === 2 ? { ...item, transform: [12, 0, 0, 12, MARGEM + 40, item.transform[5]] } : item)),
        linha('1 Uma nota de rodapé.', 100, { altura: 9 }),
      ],
    }, {
      numero: 2,
      itens: corpo(['até o fim.']),
    }])

    expect(blocos.map((b) => [b.tipo, b.texto, b.recuo])).toEqual([
      ['titulo', 'CAPÍTULO UM', false],
      ['paragrafo', 'Disse ele:1', false],
      ['paragrafo', 'Primeiro verso,', true],
      ['paragrafo', 'segundo verso.', true],
      ['paragrafo', 'E seguiu a conversa até o fim.', false],
      ['nota', '1 Uma nota de rodapé.', false],
    ])
  })

  it('tira números de página e cabeçalhos repetidos', () => {
    const paginas = [1, 2, 3, 4].map((numero) => ({
      numero,
      itens: [
        linha('MEMÓRIAS PÓSTUMAS', 760, { largura: 120 }),
        linha(`Texto da página ${numero} que continua`, 700),
        linha('na linha seguinte.', 684, { largura: 150 }),
        linha(String(numero), 60, { largura: 10 }),
      ],
    }))

    const textos = montarTexto(paginas).map((b) => b.texto)

    expect(textos.join(' ')).not.toMatch(/MEMÓRIAS|^\d$/)
    expect(textos[0]).toBe('Texto da página 1 que continua na linha seguinte.')
  })

  it('não mostra nada para um PDF sem texto', () => {
    expect(montarTexto([{ numero: 1, itens: [] }])).toEqual([])
  })
})

describe('juntarLinhas', () => {
  const vocabulario = new Set(['significa', 'bem-vindo'])

  it('desfaz a hifenização de sílabas', () => {
    expect(juntarLinhas('isso signi-', 'fica conforto', vocabulario)).toBe('isso significa conforto')
  })

  it('mantém o hífen de palavras compostas e de pronomes', () => {
    expect(juntarLinhas('seja bem-', 'vindo', vocabulario)).toBe('seja bem-vindo')
    expect(juntarLinhas('quis concluí-', 'la logo', vocabulario)).toBe('quis concluí-la logo')
  })

  it('sem pista no vocabulário, segue o costume do livro', () => {
    expect(juntarLinhas('rostos bem-', 'humorados', vocabulario, true)).toBe('rostos bemhumorados')
    expect(juntarLinhas('rostos bem-', 'humorados', vocabulario, false)).toBe('rostos bem-humorados')
  })

  it('junta linhas comuns com espaço', () => {
    expect(juntarLinhas('fim de', 'linha', vocabulario)).toBe('fim de linha')
  })
})

describe('corrigirLigaduras', () => {
  it('recupera as ligaduras que o PDF perdeu', () => {
    const vocabulario = new Set(['flores', 'quando', 'thror'])
    expect(corrigirLigaduras('\u0000ores e \u0000car', vocabulario)).toBe('flores e ficar')
    expect(corrigirLigaduras('\u0000uando \u0000ror', vocabulario)).toBe('Quando Thror')
    expect(corrigirLigaduras('\u0000utuando', vocabulario)).toBe('flutuando')
  })

  it('aprende qual ligadura cada caractere de uso privado representa', () => {
    const linhas = [{ texto: 'antes de after e swift, o vento soft' }, { texto: 'veio a\ue208er o swi\ue208 e so\ue208' }]
    const vocabulario = new Set(['after', 'swift', 'soft'])
    const mapa = aprenderLigaduras(linhas, vocabulario)

    expect(mapa.get('\ue208')).toBe('ft')
    expect(corrigirLigaduras('swi\ue208 a\ue208er', vocabulario, mapa)).toBe('swift after')
  })
})

describe('lerPosicao', () => {
  it('aceita a página do modo página e a fração do modo texto', () => {
    expect(lerPosicao('12', 100)).toEqual({ pagina: 12, fracao: 0 })
    expect(lerPosicao('12.40', 100)).toEqual({ pagina: 12, fracao: expect.closeTo(0.4) })
    expect(lerPosicao('', 100)).toEqual({ pagina: 1, fracao: 0 })
    expect(lerPosicao('500', 100)).toEqual({ pagina: 100, fracao: 0 })
  })
})
