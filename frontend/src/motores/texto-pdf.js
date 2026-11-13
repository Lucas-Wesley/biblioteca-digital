import literataItalico from '@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url'
import literata from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url'
import { carregarDocumento, lerSumario } from './pdf.js'
import { criarSelecaoPorToque, selecaoPorToqueDisponivel } from './selecao-toque.js'

// O modo texto tira o texto do PDF e o redistribui na largura da tela, como o modo de leitura do
// Chrome. O PDF só guarda pedaços de texto com posição; parágrafos, títulos e notas são deduzidos
// aqui, pela geometria das linhas.

const ESPERA_SELECAO = 250
const LINHA_EM_EM = 34
const FONTE_BASE = 17
const FAMILIAS = {
  literata: "'Literata', Georgia, serif",
  'sem-serifa': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
}
const ENTRELINHAS = { compacto: 1.4, normal: 1.6, confortavel: 1.72, amplo: 1.85 }
const MARGENS = { pequena: 16, media: 28, grande: 56 }
// Fontes sem tabela de caracteres trocam as ligaduras por \u0000 ou por um caractere de uso privado;
// vale a ligadura que formar palavras que o livro usa.
const LIGADURAS = ['fi', 'fl', 'ff', 'ffi', 'ffl', 'ft', 'fr', 'st', 'ct', 'Th', 'Q']
const CANDIDATOS = [...LIGADURAS, ...'abcdefghijklmnopqrstuvwxyz']
// \u{f0000} em diante: os \u0000 do PDF separados pelo desenho (fonte e largura), um código para cada.
const PRIVADOS = '\\ue000-\\uf8ff\\u{f0000}-\\u{ffffd}'
const PRIMEIRO_SEPARADO = 0xf0000
const DESCONHECIDO = new RegExp(`[\\u0000${PRIVADOS}]`, 'u')
const USO_PRIVADO = new RegExp(`[${PRIVADOS}]`, 'gu')
const PALAVRA_COM_PRIVADO = new RegExp(`[\\p{L}${PRIVADOS}]*[${PRIVADOS}][\\p{L}${PRIVADOS}]*`, 'gu')
const CONFUNDIVEIS = new Set(['fi', 'fl'])
const SEM_TRADUCAO = new RegExp(`[\\u0000${PRIVADOS}]`, 'gu')
const PALAVRA_SEM_TRADUCAO = new RegExp(`[\\p{L}\\u0000${PRIVADOS}]*[\\u0000${PRIVADOS}][\\p{L}\\u0000${PRIVADOS}]*`, 'gu')
const PARTE_DE_PALAVRA = new RegExp(`[\\p{L}\\u0000${PRIVADOS}-]+`, 'gu')
const FIM_DE_FRASE = /[.!?:…"”»]$/
const PRONOMES = new Set(['o', 'a', 'os', 'as', 'lo', 'la', 'los', 'las', 'no', 'na', 'nos', 'nas', 'me', 'te', 'se', 'lhe', 'lhes', 'vos'])
const NUMERO_DE_PAGINA = /^(\d+|[ivxlcdm]+|[IVXLCDM]+)$/

function moda(valores) {
  const contagem = new Map()
  let melhor
  let maximo = 0
  for (const [valor, peso = 1] of valores) {
    const total = (contagem.get(valor) ?? 0) + peso
    contagem.set(valor, total)
    if (total > maximo) {
      maximo = total
      melhor = valor
    }
  }
  return melhor
}

function percentil(valores, fracao) {
  if (!valores.length) return undefined
  const ordenados = [...valores].sort((a, b) => a - b)
  return ordenados[Math.min(ordenados.length - 1, Math.floor(ordenados.length * fracao))]
}

// O \u0000 vale para qualquer ligadura sem tradução; a fonte e a largura do desenho separam o
// "Th" do "fi". Cada desenho ganha um código, e o livro ensina qual ligadura ele costuma ser.
function separarGlifo(item, glifos) {
  if (!item.str.includes('\u0000')) return item.str
  const sozinho = item.str === '\u0000' && item.height
  const chave = `${item.fontName}:${sozinho ? Math.round((item.width / item.height) * 20) : '?'}`
  if (!glifos.has(chave)) glifos.set(chave, String.fromCodePoint(PRIMEIRO_SEPARADO + glifos.size))
  return item.str.replaceAll('\u0000', glifos.get(chave))
}

// Junta os pedaços do PDF em linhas, na ordem em que aparecem na página.
export function linhasDaPagina(itens, pagina, glifos = new Map()) {
  const linhas = []
  let atual = null
  const fechar = () => {
    if (atual) {
      atual.texto = atual.texto.replace(/[\s ]+/g, ' ').trim()
      if (atual.texto) linhas.push(atual)
    }
    atual = null
  }
  for (const item of itens) {
    const [a, b, , , x, y] = item.transform
    // Texto na vertical (lombada, carimbo de margem) não é parte do corpo.
    if (Math.abs(b) > Math.abs(a)) continue
    const visivel = item.str.trim() !== ''
    if (atual && visivel && atual.altura && Math.abs(y - atual.y) > atual.altura * 0.5) fechar()
    if (!atual) atual = { texto: '', x: null, xFim: null, y, altura: 0, pagina }
    atual.texto += separarGlifo(item, glifos)
    if (visivel) {
      if (atual.x === null) {
        atual.x = x
        atual.y = y
      }
      atual.xFim = Math.max(atual.xFim ?? x, x + item.width)
      atual.altura = Math.max(atual.altura, item.height)
    }
    if (item.hasEOL) fechar()
  }
  fechar()
  return linhas
}

function semAcento(texto) {
  return texto.normalize('NFD').replace(/\p{M}/gu, '')
}

function vocabularioDe(linhas) {
  const palavras = new Set()
  for (const { texto } of linhas) {
    const lista = texto.split(' ')
    // A primeira e a última palavra da linha podem ser pedaços de uma palavra hifenizada.
    for (const palavra of lista.slice(1, -1)) {
      for (const parte of palavra.toLowerCase().match(PARTE_DE_PALAVRA) ?? []) {
        if (DESCONHECIDO.test(parte)) continue
        const limpa = parte.replace(/^-+|-+$/g, '')
        // Sem acento também, para "Th" + "ror" achar "Thrór".
        palavras.add(limpa).add(semAcento(limpa))
      }
    }
  }
  return palavras
}

function separado(caractere) {
  return caractere.codePointAt(0) >= PRIMEIRO_SEPARADO
}

function conhecida(palavra, vocabulario) {
  return vocabulario.has(semAcento(palavra.toLowerCase()))
}

const prefixosPorVocabulario = new WeakMap()

// Mesmo radical de uma palavra do livro: "florestas" quando o livro só tem "floresta" por extenso.
function parecida(palavra, vocabulario) {
  const radical = semAcento(palavra.toLowerCase()).slice(0, -2)
  if (radical.length < 4) return false
  let guardado = prefixosPorVocabulario.get(vocabulario)
  if (guardado?.tamanho !== vocabulario.size) {
    const prefixos = new Set()
    for (const p of vocabulario) for (let fim = 4; fim <= p.length; fim++) prefixos.add(p.slice(0, fim))
    guardado = { tamanho: vocabulario.size, prefixos }
    prefixosPorVocabulario.set(vocabulario, guardado)
  }
  return guardado.prefixos.has(radical)
}

// Cada caractere de uso privado é sempre a mesma ligadura no livro inteiro: fica a que mais acerta.
export function aprenderLigaduras(linhas, vocabulario) {
  const palavrasPorCaractere = new Map()
  for (const { texto } of linhas) {
    for (const palavra of texto.match(PALAVRA_COM_PRIVADO) ?? []) {
      for (const caractere of new Set(palavra.match(USO_PRIVADO))) {
        if (!palavrasPorCaractere.has(caractere)) palavrasPorCaractere.set(caractere, [])
        palavrasPorCaractere.get(caractere).push(palavra)
      }
    }
  }
  const mapa = new Map()
  for (const [caractere, palavras] of palavrasPorCaractere) {
    let melhor = ''
    let acertos = 0
      // O \u0000 é sempre ligadura; letra solta acertaria por acaso ("filhos" sem o "fi" vira "olhos").
    for (const candidato of separado(caractere) ? LIGADURAS : CANDIDATOS) {
      const total = new Set(palavras.filter((p) => conhecida(p.replace(USO_PRIVADO, (c) => (c === caractere ? candidato : '')), vocabulario))).size
      if (total > acertos) {
        acertos = total
        melhor = candidato
      }
    }
    // Para o \u0000 separado é só a preferência: a palavra ainda pode pedir outra ("flores").
    mapa.set(caractere, melhor || (separado(caractere) ? '\u0000' : ''))
  }
  return mapa
}

// Palavras recuperadas numa rodada ("Thorin") viram pista para os outros desenhos da mesma ligadura.
// Só as que tiveram pista: um palpite às cegas ("fiorin") empataria com a palavra certa.
function ampliarVocabulario(linhas, vocabulario, mapa) {
  vocabularioDe(linhas.map(({ texto }) => ({ texto: corrigirLigaduras(texto, vocabulario, mapa, false) })))
    .forEach((palavra) => vocabulario.add(palavra))
}

// Os caracteres de uso privado do PDF têm tradução fixa. O \u0000 é decidido palavra a palavra,
// da pista mais forte para a mais fraca: palavra que o livro usa; mesmo radical de palavra do
// livro ("florestas" por "floresta"); "fl" antes de "u" (flutuar, fluir); a ligadura que o desenho
// costuma ser; e por fim "fi". Sem adivinhar, para ampliar o vocabulário, radical e "fi" não valem.
export function corrigirLigaduras(texto, vocabulario, mapa = new Map(), adivinhar = true) {
  if (!DESCONHECIDO.test(texto)) return texto
  const preferida = (c) => {
    const valor = mapa.get(c)
    return valor && valor !== '\u0000' ? valor : null
  }
  // Letra solta (um "v" desenhado) tem tradução fixa; ligadura ainda depende da palavra.
  const fixo = texto.replace(USO_PRIVADO, (c) => (separado(c) || LIGADURAS.includes(mapa.get(c)) ? c : mapa.get(c) ?? ''))
  return fixo.replace(PALAVRA_SEM_TRADUCAO, (palavra) => {
    const preferidas = palavra.match(SEM_TRADUCAO).map(preferida).filter(Boolean)
    const ordem = [...new Set([...preferidas, ...LIGADURAS])]
    const exata = ordem.find((lig) => conhecida(palavra.replace(SEM_TRADUCAO, lig), vocabulario))
    if (exata) return palavra.replace(SEM_TRADUCAO, exata)
    const radical = adivinhar && ordem.find((lig) => parecida(palavra.replace(SEM_TRADUCAO, lig), vocabulario))
    if (radical) return palavra.replace(SEM_TRADUCAO, radical)

    let semPista = false
    let confundivel = false
    const aprendida = palavra.replace(SEM_TRADUCAO, (c, posicao) => {
      const padrao = preferida(c)
      const seguinte = palavra[posicao + c.length] ?? ''
      if (seguinte === 'u' && (!padrao || padrao === 'fi')) return 'fl'
      // Depois de "fl" só vem vogal: "flm" e "flcando" são "fim" e "ficando".
      if (padrao === 'fl' && seguinte && !/[aeiouáéíóúâêôãõ]/i.test(seguinte)) return 'fi'
      if (padrao) {
        confundivel ||= CONFUNDIVEIS.has(padrao)
        return padrao
      }
      semPista = true
      return c
    })
    // "fi" e "fl" têm a mesma largura: a preferência entre eles não basta para ensinar o vocabulário.
    if (!adivinhar && (semPista || confundivel)) return palavra
    if (!semPista) return aprendida
    return aprendida.replace(SEM_TRADUCAO, (c, posicao) => (/\p{Ll}/u.test(aprendida[posicao + c.length] ?? '') ? 'fi' : ''))
  })
}

function quebraComHifen(antes, depois) {
  const hifen = antes.match(/(\p{L}+)-$/u)
  if (!hifen || !/^\p{Ll}/u.test(depois)) return null
  return { esquerda: hifen[1].toLowerCase(), direita: depois.match(/^\p{L}+/u)[0].toLowerCase() }
}

// "signi-" + "fica" vira "significa"; "bem-" + "humorados" e "dando-" + "lhe" ficam com hífen.
// Sem pista no vocabulário, vale o costume do livro: há livros que não partem sílabas no fim da linha.
export function juntarLinhas(antes, depois, vocabulario, hifenizado = true) {
  const quebra = quebraComHifen(antes, depois)
  if (!quebra) return `${antes} ${depois}`
  const { esquerda, direita } = quebra
  let juntar = hifenizado
  if (vocabulario.has(esquerda + direita)) juntar = true
  else if (vocabulario.has(`${esquerda}-${direita}`) || PRONOMES.has(direita)) juntar = false
  return juntar ? antes.slice(0, -1) + depois : antes + depois
}

// O livro parte sílabas se as quebras com hífen formam, juntas, palavras que ele usa inteiras.
function partePalavras(linhas, vocabulario) {
  let juntas = 0
  let compostas = 0
  for (let i = 1; i < linhas.length; i++) {
    const quebra = quebraComHifen(linhas[i - 1].texto, linhas[i].texto)
    if (!quebra) continue
    if (vocabulario.has(quebra.esquerda + quebra.direita)) juntas++
    else if (vocabulario.has(`${quebra.esquerda}-${quebra.direita}`)) compostas++
  }
  return juntas >= compostas
}

function semNumeros(texto) {
  return texto.replace(/\d+/g, '').trim().toLowerCase()
}

// Cabeçalhos e rodapés repetidos e números de página ficam na primeira ou na última linha.
function bordasRepetidas(paginas, corpo) {
  const contagem = new Map()
  // Numa página de uma ou duas linhas, a primeira e a última são o próprio texto.
  const comCorpo = paginas.filter((linhas) => linhas.length >= 3)
  for (const linhas of comCorpo) {
    for (const linha of new Set([linhas[0], linhas.at(-1)])) {
      const chave = semNumeros(linha.texto)
      if (chave) contagem.set(chave, (contagem.get(chave) ?? 0) + 1)
    }
  }
  const minimo = Math.max(3, paginas.length * 0.1)
  const descartar = new Set()
  for (const linhas of comCorpo) {
    for (const linha of new Set([linhas[0], linhas.at(-1)])) {
      if (linha.altura > corpo * 1.1) continue
      const numero = NUMERO_DE_PAGINA.test(linha.texto.replace(/[\s.\-–—]/g, ''))
      if (numero || (contagem.get(semNumeros(linha.texto)) ?? 0) >= minimo) descartar.add(linha)
    }
  }
  return descartar
}

function compor(ctm, m) {
  return [
    m[0] * ctm[0] + m[1] * ctm[2], m[0] * ctm[1] + m[1] * ctm[3],
    m[2] * ctm[0] + m[3] * ctm[2], m[2] * ctm[1] + m[3] * ctm[3],
    m[4] * ctm[0] + m[5] * ctm[2] + ctm[4], m[4] * ctm[1] + m[5] * ctm[3] + ctm[5],
  ]
}

// Onde cada imagem é desenhada na página, em unidades do PDF. A imagem ocupa o quadrado de lado 1
// transformado pela matriz em vigor, que muda com transform, save/restore e os formulários.
export function caixasDeImagens({ fnArray, argsArray }, OPS) {
  const pintam = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintJpegXObject].filter(Boolean))
  const caixas = []
  const pilha = []
  let ctm = [1, 0, 0, 1, 0, 0]
  fnArray.forEach((fn, i) => {
    const args = argsArray[i]
    if (fn === OPS.save) pilha.push(ctm)
    else if (fn === OPS.restore) ctm = pilha.pop() ?? ctm
    else if (fn === OPS.transform) ctm = compor(ctm, args)
    else if (fn === OPS.paintFormXObjectBegin) {
      pilha.push(ctm)
      if (args?.[0]) ctm = compor(ctm, args[0])
    } else if (fn === OPS.paintFormXObjectEnd) ctm = pilha.pop() ?? ctm
    else if (pintam.has(fn)) {
      const xs = [0, ctm[0], ctm[2], ctm[0] + ctm[2]].map((v) => v + ctm[4])
      const ys = [0, ctm[1], ctm[3], ctm[1] + ctm[3]].map((v) => v + ctm[5])
      caixas.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) })
    }
  })
  return caixas
}

/**
 * Transforma as páginas do PDF em blocos de texto corrido.
 * paginas: [{ numero, itens, imagens? }], com os itens de getTextContent() e as caixas das imagens.
 * Cada bloco: { tipo: 'paragrafo' | 'titulo' | 'nota' | 'imagem', texto, recuo, marcas, imagem? },
 * em que cada marca ({ pagina, posicao }) diz onde, no texto do bloco, começa uma página do PDF.
 */
export function montarTexto(paginas) {
  const glifos = new Map()
  const porPagina = paginas.map(({ numero, itens }) => linhasDaPagina(itens, numero, glifos))
  const todas = porPagina.flat()
  if (!todas.length) return []

  const corpo = moda(todas.map((l) => [Math.round(l.altura), l.texto.length])) || 12
  const doCorpo = (l) => Math.abs(l.altura - corpo) <= corpo * 0.15
  const vocabulario = vocabularioDe(todas)
  ampliarVocabulario(todas, vocabulario, aprenderLigaduras(todas, vocabulario))
  const ligaduras = aprenderLigaduras(todas, vocabulario)
  const hifenizado = partePalavras(todas, vocabulario)
  const juntar = (antes, depois) => juntarLinhas(antes, depois, vocabulario, hifenizado)
  const descartar = bordasRepetidas(porPagina, corpo)

  const entrelinhas = []
  for (const linhas of porPagina) {
    for (let i = 1; i < linhas.length; i++) {
      const salto = linhas[i - 1].y - linhas[i].y
      if (doCorpo(linhas[i]) && salto > corpo * 0.8 && salto < corpo * 3) entrelinhas.push([Math.round(salto), 1])
    }
  }
  const entrelinha = moda(entrelinhas) ?? corpo * 1.3
  const linhasDoCorpo = todas.filter(doCorpo)
  const margemGeral = moda(linhasDoCorpo.map((l) => [Math.round(l.x), 1])) ?? 0
  const direitaGeral = percentil(linhasDoCorpo.map((l) => l.xFim), 0.9) ?? 0

  const blocos = []
  let bloco = null
  // Notas e imagens esperam o parágrafo terminar: uma ilustração no meio da página não parte a frase.
  let pendentes = []
  let anterior = null

  const fechar = () => {
    if (bloco) blocos.push(bloco)
    bloco = null
    if (pendentes.length) blocos.push(...pendentes)
    pendentes = []
  }

  for (const [indicePagina, linhas] of porPagina.entries()) {
    const imagens = imagensDaPagina(paginas[indicePagina], linhas, corpo)
    const corpoDaPagina = linhas.filter((l) => doCorpo(l) && !descartar.has(l))
    const margem = corpoDaPagina.length >= 5
      ? moda(corpoDaPagina.map((l) => [Math.round(l.x), 1]))
      : margemGeral
    const direita = corpoDaPagina.length >= 5 ? percentil(corpoDaPagina.map((l) => l.xFim), 0.9) : direitaGeral
    // As notas são as últimas linhas da página, em letra menor que a do corpo.
    let inicioNotas = linhas.length
    while (inicioNotas > 0 && linhas[inicioNotas - 1].altura < corpo * 0.85) inicioNotas--
    if (inicioNotas === 0) inicioNotas = linhas.length

    let primeiraDaPagina = true
    let anteriorNaPagina = null
    let nota = null
    for (const [indice, linha] of linhas.entries()) {
      // A imagem entra antes da primeira linha que está abaixo dela.
      while (imagens.length && imagens[0].imagem.y0 >= linha.y) pendentes.push(imagens.shift())
      if (descartar.has(linha)) continue
      const texto = corrigirLigaduras(linha.texto, vocabulario, ligaduras)

      if (indice >= inicioNotas) {
        if (!nota || /^[\d*†]/.test(texto)) {
          nota = { tipo: 'nota', texto, recuo: false, marcas: [] }
          pendentes.push(nota)
        } else {
          nota.texto = juntar(nota.texto, texto)
        }
        continue
      }

      const marca = primeiraDaPagina ? linha.pagina : null
      primeiraDaPagina = false
      const salto = anteriorNaPagina ? anteriorNaPagina.y - linha.y : 0
      anteriorNaPagina = linha

      if (linha.altura >= corpo * 1.25) {
        if (bloco?.tipo !== 'titulo' || salto > linha.altura * 2.5) {
          fechar()
          bloco = { tipo: 'titulo', texto: '', recuo: false, marcas: [] }
        }
        if (marca) bloco.marcas.push({ pagina: marca, posicao: bloco.texto.length })
        bloco.texto = bloco.texto ? `${bloco.texto}\n${texto}` : texto
        anterior = linha
        continue
      }

      const recuo = linha.x - margem
      const anteriorCurta = anterior && anterior.xFim < direita - corpo * 2 && FIM_DE_FRASE.test(anterior.texto)
      const novo = !bloco || bloco.tipo !== 'paragrafo'
        || recuo > corpo * 0.6
        || (bloco.recuo && recuo < corpo * 2)
        || salto > entrelinha * 1.4
        || anteriorCurta
      if (novo) {
        fechar()
        bloco = { tipo: 'paragrafo', texto: '', recuo: recuo > corpo * 2, marcas: [] }
      }
      if (marca) bloco.marcas.push({ pagina: marca, posicao: bloco.texto.length ? bloco.texto.length + 1 : 0 })
      bloco.texto = bloco.texto ? juntar(bloco.texto, texto) : texto
      anterior = linha
    }
    pendentes.push(...imagens)
  }
  fechar()
  // A junção de linhas hifenizadas não deixa espaço; a marca não pode passar do fim do texto.
  for (const b of blocos) {
    for (const m of b.marcas) m.posicao = Math.min(m.posicao, b.texto.length)
  }
  return blocos
}

// Ornamentos e letras desenhadas são pequenos demais; imagem com texto por cima é fundo de página
// ou PDF escaneado, e o texto dela já está no bloco.
function imagensDaPagina({ numero, imagens = [] }, linhas, corpo) {
  return imagens
    .filter(({ x0, y0, x1, y1 }) => {
      if (x1 - x0 < corpo * 3 || y1 - y0 < corpo * 3) return false
      const cobertas = linhas.filter((l) => l.x >= x0 && l.xFim <= x1 && l.y >= y0 && l.y <= y1)
      return cobertas.length < 3
    })
    .sort((a, b) => b.y1 - a.y1)
    .map((caixa) => ({
      tipo: 'imagem',
      texto: '',
      recuo: false,
      marcas: [],
      imagem: { pagina: numero, ...caixa, largura: (caixa.x1 - caixa.x0) / corpo },
    }))
}

let fontesInstaladas = false

// Os mesmos arquivos do leitor de EPUB, já guardados pelo service worker para abrir sem rede.
function instalarFontes() {
  if (fontesInstaladas) return
  fontesInstaladas = true
  const estilo = document.createElement('style')
  estilo.textContent = [[literata, 'normal'], [literataItalico, 'italic']].map(([arquivo, estilo]) => `
    @font-face {
      font-family: 'Literata'; font-style: ${estilo}; font-weight: 200 900; font-display: swap;
      src: url("${arquivo}") format('woff2');
    }`).join('\n')
  document.head.append(estilo)
}

// O espaço da imagem já fica reservado na proporção certa; o desenho chega quando ela está perto.
function figuraDaImagem({ imagem }) {
  const figura = document.createElement('figure')
  figura.className = 'imagem-pdf'
  const canvas = document.createElement('canvas')
  canvas.dataset.caixa = JSON.stringify(imagem)
  canvas.style.width = `${imagem.largura}em`
  canvas.style.aspectRatio = `${imagem.x1 - imagem.x0} / ${imagem.y1 - imagem.y0}`
  figura.append(canvas)
  return figura
}

function elementoDoBloco(bloco, indice) {
  if (bloco.tipo === 'imagem') return figuraDaImagem(bloco)
  const el = document.createElement(bloco.tipo === 'titulo' ? 'h2' : 'p')
  el.dataset.bloco = String(indice)
  if (bloco.tipo === 'nota') el.className = 'nota-pdf'
  if (bloco.recuo) el.className = 'recuo'
  let inicio = 0
  for (const marca of bloco.marcas) {
    el.append(bloco.texto.slice(inicio, marca.posicao))
    const ancora = document.createElement('span')
    ancora.className = 'inicio-pagina'
    ancora.dataset.pagina = String(marca.pagina)
    el.append(ancora)
    inicio = marca.posicao
  }
  el.append(bloco.texto.slice(inicio))
  return el
}

// Lê a posição salva: "12" (página 12, como no modo página) ou "12.40" (40% da página 12).
export function lerPosicao(posicao, total) {
  const numero = Number.parseFloat(posicao)
  if (!Number.isFinite(numero)) return { pagina: 1, fracao: 0 }
  const pagina = Math.min(Math.max(Math.floor(numero), 1), total)
  return { pagina, fracao: Math.min(Math.max(numero - Math.floor(numero), 0), 0.99) }
}

export async function abrirTextoPdf({
  livro, area, posicao, preferencias,
  aoMudar, aoClicar, aoDeslizar, aoSelecionar = () => {},
}) {
  const { pdfjs, tarefa, doc } = await carregarDocumento(livro)
  const sumario = await lerSumario(doc)
  const total = doc.numPages
  const paginas = []
  for (let numero = 1; numero <= total; numero++) {
    const pagina = await doc.getPage(numero)
    paginas.push({ numero, itens: (await pagina.getTextContent()).items })
    pagina.cleanup()
  }

  instalarFontes()
  const janela = document.createElement('div')
  janela.className = 'texto-pdf'
  const artigo = document.createElement('article')
  artigo.lang = 'pt-BR'
  const fim = document.createElement('span')
  janela.append(artigo)
  area.replaceChildren(janela)

  function preencher(blocos) {
    if (blocos.length) artigo.replaceChildren(...blocos.map(elementoDoBloco), fim)
    else artigo.replaceChildren(Object.assign(document.createElement('p'), { className: 'sem-texto', textContent: 'Este PDF não tem texto para mostrar; use o modo página.' }), fim)
  }
  preencher(montarTexto(paginas))

  let largura = 1
  let telas = 1
  let tela = 0
  // Tela em que começa cada página do PDF; páginas sem texto (só imagem) não aparecem.
  let inicios = []
  // Página pedida (ao abrir, pelo sumário, ao mudar a fonte): várias páginas curtas podem
  // começar na mesma tela, e a posição deve continuar sendo a que foi pedida.
  let alvo = null
  let figuras = []
  let filaDeDesenho = Promise.resolve()
  let ativo = true
  let inicioToque = null
  let temporizadorSelecao
  const toque = selecaoPorToqueDisponivel()
    ? criarSelecaoPorToque({
      camada: area.parentElement,
      aoComecar: () => aoSelecionar(null),
      aoTerminar: avisarSelecao,
    })
    : null

  function estilizar(p) {
    const margem = MARGENS[p.margem] ?? MARGENS.media
    const fonte = (FONTE_BASE * p.fonte) / 100
    largura = Math.max(1, Math.floor(Math.min(area.clientWidth, fonte * LINHA_EM_EM + 2 * margem)))
    janela.style.width = `${largura}px`
    janela.style.fontSize = `${fonte}px`
    janela.style.fontFamily = FAMILIAS[p.familia] ?? FAMILIAS.literata
    janela.style.lineHeight = String(ENTRELINHAS[p.entrelinhas] ?? ENTRELINHAS.normal)
    janela.dataset.alinhamento = p.alinhamento
    artigo.style.padding = `0 ${margem}px`
    artigo.style.columnWidth = `${largura - 2 * margem}px`
    artigo.style.columnGap = `${2 * margem}px`
    // A imagem precisa caber numa coluna inteira, senão seria cortada.
    janela.style.setProperty('--altura', `${area.clientHeight}px`)
  }

  function telaDe(el) {
    const base = artigo.getBoundingClientRect().left
    return Math.max(0, Math.floor((el.getBoundingClientRect().left - base + 1) / largura))
  }

  function medir() {
    telas = telaDe(fim) + 1
    inicios = [...artigo.querySelectorAll('.inicio-pagina')]
      .map((el) => ({ pagina: Number(el.dataset.pagina), tela: telaDe(el) }))
    figuras = [...artigo.querySelectorAll('.imagem-pdf canvas')].map((el) => ({ el, tela: telaDe(el) }))
  }

  // Desenha só o recorte da página onde está a imagem, na resolução da tela.
  async function desenharImagem(canvas, pixels) {
    const { pagina: numero, x0, y0, x1, y1 } = JSON.parse(canvas.dataset.caixa)
    const pagina = await doc.getPage(numero)
    if (!ativo) return
    const escala = pixels / (x1 - x0)
    const inteira = pagina.getViewport({ scale: escala })
    const cantos = [[x0, y0], [x1, y1], [x0, y1], [x1, y0]].map(([x, y]) => inteira.convertToViewportPoint(x, y))
    const xs = cantos.map(([x]) => x)
    const ys = cantos.map(([, y]) => y)
    const recorte = pagina.getViewport({ scale: escala, offsetX: -Math.min(...xs), offsetY: -Math.min(...ys) })
    canvas.width = Math.max(1, Math.round(Math.max(...xs) - Math.min(...xs)))
    canvas.height = Math.max(1, Math.round(Math.max(...ys) - Math.min(...ys)))
    await pagina.render({ canvas, viewport: recorte }).promise
  }

  // A tela atual e as vizinhas, para a imagem já estar pronta ao virar a página.
  function desenharVisiveis() {
    const densidade = Math.min(window.devicePixelRatio || 1, 2)
    for (const { el, tela: daImagem } of figuras) {
      if (Math.abs(daImagem - tela) > 1) continue
      const pixels = Math.round(el.clientWidth * densidade)
      if (!pixels || Number(el.dataset.desenhada) >= pixels) continue
      el.dataset.desenhada = String(pixels)
      filaDeDesenho = filaDeDesenho
        .then(() => (ativo ? desenharImagem(el, pixels) : undefined))
        .catch((falha) => console.warn('Não foi possível desenhar a imagem do PDF', falha))
    }
  }

  // Achar as imagens exige ler cada página inteira; o texto aparece antes, e elas entram depois
  // sem tirar a leitura do lugar.
  async function procurarImagens() {
    for (const dados of paginas) {
      if (!ativo) return
      const pagina = await doc.getPage(dados.numero)
      dados.imagens = caixasDeImagens(await pagina.getOperatorList(), pdfjs.OPS)
      pagina.cleanup()
    }
    if (!ativo) return
    const blocos = montarTexto(paginas)
    if (!blocos.some((bloco) => bloco.tipo === 'imagem')) return
    const lugar = paginaAtual()
    if (toque?.faixa()) {
      toque.limpar()
      aoSelecionar(null)
    }
    preencher(blocos)
    medir()
    alvo = lugar
    tela = Math.min(telaDaPosicao(lugar), telas - 1)
    mostrar()
    avisar(false)
  }

  function paginaAtual() {
    if (alvo && telaDaPosicao(alvo) === tela) return alvo
    // Antes do primeiro texto só há capa e imagens: conta como o começo do livro.
    if (!inicios.length || tela < inicios[0].tela) return { pagina: 1, fracao: 0 }
    let atual = inicios[0]
    for (const inicio of inicios) {
      if (inicio.tela > tela) break
      atual = inicio
    }
    const fimDaPagina = inicios.find((i) => i.tela > atual.tela)?.tela ?? telas
    const fracao = fimDaPagina > atual.tela ? (tela - atual.tela) / (fimDaPagina - atual.tela) : 0
    return { pagina: atual.pagina, fracao }
  }

  function telaDaPosicao({ pagina, fracao }) {
    if (inicios.length && pagina < inicios[0].pagina) return 0
    const inicio = inicios.find((i) => i.pagina >= pagina)
    if (!inicio) return telas - 1
    const fimDaPagina = inicios.find((i) => i.tela > inicio.tela)?.tela ?? telas
    return inicio.tela + Math.round(fracao * (fimDaPagina - inicio.tela))
  }

  function mostrar() {
    janela.scrollLeft = tela * largura
    desenharVisiveis()
  }

  function avisar(porLeitura) {
    const { pagina, fracao } = paginaAtual()
    const capitulo = sumario.filter((item) => item.destino <= pagina).at(-1)
    aoMudar({
      posicao: fracao > 0 ? (pagina + fracao).toFixed(2) : String(pagina),
      // Pela página do PDF, como no modo página: o percentual não muda ao trocar de modo.
      percentual: total > 1 ? Math.min((pagina - 1 + fracao) / (total - 1), 1) : 1,
      capitulo: capitulo?.destino ?? '',
      rotulo: `Página ${pagina} de ${total}`,
      contagem: { unidade: pagina, porUnidade: 1, totalDePaginas: total },
    }, porLeitura)
  }

  function irParaTela(nova, porLeitura = true, pedida = null) {
    const limitada = Math.min(Math.max(nova, 0), telas - 1)
    // Na primeira ou na última tela, virar não muda nada; ir a outra página da mesma tela, sim.
    if (limitada === tela && !pedida) return
    alvo = pedida
    if (limitada === tela) {
      avisar(porLeitura)
      return
    }
    tela = limitada
    if (toque?.faixa()) {
      toque.limpar()
      aoSelecionar(null)
    }
    mostrar()
    avisar(porLeitura)
  }

  // Mudar a fonte ou a largura redistribui o texto; a leitura continua no mesmo ponto.
  function refazer(p) {
    const lugar = paginaAtual()
    estilizar(p)
    medir()
    alvo = lugar
    tela = Math.min(telaDaPosicao(lugar), telas - 1)
    mostrar()
    avisar(false)
  }

  function selecaoNoTexto() {
    if (toque?.faixa()) return toque.faixa()
    const selecao = document.getSelection()
    if (!selecao || selecao.isCollapsed || !selecao.rangeCount) return null
    const trecho = selecao.getRangeAt(0)
    if (!artigo.contains(trecho.commonAncestorContainer)) return null
    return trecho.toString().trim() ? trecho : null
  }

  // Marcar no modo texto ainda não existe: a seleção serve para copiar e pesquisar.
  function avisarSelecao() {
    const trecho = selecaoNoTexto()
    if (!trecho) {
      aoSelecionar(null)
      return
    }
    const caixa = trecho.getBoundingClientRect()
    aoSelecionar({
      texto: trecho.toString().trim(),
      ancora: null,
      caixa: { topo: caixa.top, base: caixa.bottom },
    })
  }

  function aoMudarSelecao() {
    clearTimeout(temporizadorSelecao)
    temporizadorSelecao = setTimeout(avisarSelecao, ESPERA_SELECAO)
  }

  const aoRedimensionar = () => refazer(preferencias)
  const aoClicarArea = (evento) => {
    if (toque?.faixa()) {
      if (!toque.recemSolta()) {
        toque.limpar()
        aoSelecionar(null)
      }
      return
    }
    if (selecaoNoTexto()) return
    aoClicar(evento.clientX)
  }
  const aoTocar = (evento) => {
    inicioToque = evento.changedTouches[0]
  }
  const aoSoltar = (evento) => {
    const final = evento.changedTouches[0]
    if (!inicioToque || !final || selecaoNoTexto()) return
    const dx = final.screenX - inicioToque.screenX
    const dy = final.screenY - inicioToque.screenY
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) aoDeslizar(dx < 0 ? 'proxima' : 'anterior')
  }

  window.addEventListener('resize', aoRedimensionar)
  document.addEventListener('selectionchange', aoMudarSelecao)
  area.addEventListener('click', aoClicarArea)
  toque?.ouvir(area, document, {
    seletor: '.texto-pdf, .texto-pdf *',
    aceita: (no) => artigo.contains(no),
  })
  area.addEventListener('touchstart', aoTocar, { passive: true })
  area.addEventListener('touchend', aoSoltar, { passive: true })

  estilizar(preferencias)
  await document.fonts?.load(`${FONTE_BASE}px Literata`).catch(() => {})
  medir()
  alvo = lerPosicao(posicao, total)
  tela = Math.min(telaDaPosicao(alvo), telas - 1)
  mostrar()
  avisar(false)
  procurarImagens().catch((falha) => console.warn('Não foi possível achar as imagens do PDF', falha))

  return {
    sumario: () => sumario,
    anterior: () => irParaTela(tela - 1),
    proxima: () => irParaTela(tela + 1),
    irPara: (pagina) => irParaTela(telaDaPosicao({ pagina, fracao: 0 }), true, { pagina, fracao: 0 }),
    // O percentual é pela página do PDF, como o que aparece na barra.
    irParaPercentual(percentual) {
      const valor = percentual * (total - 1) + 1
      const pedida = { pagina: Math.floor(valor), fracao: valor - Math.floor(valor) }
      irParaTela(telaDaPosicao(pedida), true, pedida)
    },
    irParaAncora(ancora) {
      const pagina = JSON.parse(ancora).pagina
      if (pagina) irParaTela(telaDaPosicao({ pagina, fracao: 0 }), true, { pagina, fracao: 0 })
    },
    percentualDe(ancora) {
      const pagina = JSON.parse(ancora).pagina
      return pagina ? (total > 1 ? (pagina - 1) / (total - 1) : 1) : null
    },
    // As marcações do PDF ficam presas à página desenhada; no modo texto ainda não aparecem.
    marcar() {},
    limparSelecao() {
      toque?.limpar()
      document.getSelection()?.removeAllRanges()
    },
    aplicar: (novas) => refazer(novas),
    redimensionar: () => refazer(preferencias),
    destruir() {
      ativo = false
      clearTimeout(temporizadorSelecao)
      toque?.destruir()
      window.removeEventListener('resize', aoRedimensionar)
      document.removeEventListener('selectionchange', aoMudarSelecao)
      area.removeEventListener('click', aoClicarArea)
      area.removeEventListener('touchstart', aoTocar)
      area.removeEventListener('touchend', aoSoltar)
      tarefa.destroy()
    },
  }
}
