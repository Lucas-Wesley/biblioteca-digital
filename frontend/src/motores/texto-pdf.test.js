import { describe, expect, it } from 'vitest'
import { aprenderLigaduras, caixasDeImagens, corrigirLigaduras, juntarLinhas, lerPosicao, montarTexto } from './texto-pdf.js'

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

  it('põe a imagem depois do parágrafo, sem partir a frase, e ignora ornamentos e imagens sob o texto', () => {
    const blocos = montarTexto([
      { numero: 1, itens: corpo(['O parágrafo começa nesta página', 'e continua na seguinte']) },
      // Ilustração de página inteira, entre as duas metades da frase.
      { numero: 2, itens: [], imagens: [{ x0: 96, y0: 72, x1: 516, y1: 720 }] },
      {
        numero: 3,
        itens: corpo(['até terminar.', 'Outro parágrafo.', 'Mais uma linha dele.'], { recuos: [1] }),
        imagens: [
          { x0: 80, y0: 690, x1: 96, y1: 706 },
          { x0: 80, y0: 600, x1: 520, y1: 720 },
        ],
      },
    ])

    expect(blocos.map((b) => b.tipo)).toEqual(['paragrafo', 'imagem', 'paragrafo'])
    expect(blocos[0].texto).toBe('O parágrafo começa nesta página e continua na seguinte até terminar.')
    expect(blocos[1].imagem).toMatchObject({ pagina: 2, x0: 96, y1: 720, largura: 35 })
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

  it('separa o "Th" do "fi" pelo desenho e aprende pelo livro', () => {
    // Uma linha com pedaços: o \u0000 vem num pedaço próprio, com a fonte da ligadura.
    const pedacos = (y, ...partes) => partes.map(([str, fontName = 'corpo', largura = 40], i) => ({
      str, fontName, width: largura, height: 12, transform: [12, 0, 0, 12, MARGEM + i * 40, y], hasEOL: i === partes.length - 1,
    }))
    const blocos = montarTexto([{
      numero: 1,
      itens: [
        ...pedacos(700, ['O mapa de Thrór e o neto, ']),
        ...pedacos(684, ['\u0000', 'lig', 15], ['orin, que gosta de ']),
        ...pedacos(668, ['\u0000', 'lig', 15], ['ror, e de ']),
        ...pedacos(652, ['\u0000', 'lig', 7.7], ['car em casa.']),
      ],
    }])

    expect(blocos[0].texto).toBe('O mapa de Thrór e o neto, Thorin, que gosta de Thror, e de ficar em casa.')
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

describe('caixasDeImagens', () => {
  const OPS = { save: 1, restore: 2, transform: 3, paintImageXObject: 4, paintFormXObjectBegin: 5, paintFormXObjectEnd: 6 }

  it('acha onde cada imagem é desenhada, seguindo as transformações', () => {
    const caixas = caixasDeImagens({
      fnArray: [1, 3, 4, 2, 5, 1, 3, 4, 2, 6],
      argsArray: [null, [200, 0, 0, 100, 50, 60], ['img1'], null, [[1, 0, 0, 1, 10, 20], null], null, [30, 0, 0, 40, 0, 0], ['img2'], null, null],
    }, OPS)

    expect(caixas).toEqual([
      { x0: 50, y0: 60, x1: 250, y1: 160 },
      { x0: 10, y0: 20, x1: 40, y1: 60 },
    ])
  })
})
