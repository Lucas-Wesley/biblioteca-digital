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
const ENTRELINHAS = { compacto: 1.4, normal: 1.6, amplo: 1.85 }
const MARGENS = { pequena: 16, media: 28, grande: 56 }
// Fontes sem tabela de caracteres trocam as ligaduras por \u0000 ou por um caractere de uso privado;
// vale a ligadura que formar palavras que o livro usa.
const LIGADURAS = ['fi', 'fl', 'ff', 'ffi', 'ffl', 'ft', 'fr', 'st', 'ct', 'Th', 'Q']
const CANDIDATOS = [...LIGADURAS, ...'abcdefghijklmnopqrstuvwxyz']
const DESCONHECIDO = /[\u0000\ue000-\uf8ff]/u
const USO_PRIVADO = /[\ue000-\uf8ff]/gu
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

// Junta os pedaços do PDF em linhas, na ordem em que aparecem na página.
export function linhasDaPagina(itens, pagina) {
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
    atual.texto += item.str
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
      for (const parte of palavra.toLowerCase().match(/[\p{L}\u0000\ue000-\uf8ff-]+/gu) ?? []) {
        if (DESCONHECIDO.test(parte)) continue
        const limpa = parte.replace(/^-+|-+$/g, '')
        // Sem acento também, para "Th" + "ror" achar "Thrór".
        palavras.add(limpa).add(semAcento(limpa))
      }
    }
  }
  return palavras
}

function conhecida(palavra, vocabulario) {
  return vocabulario.has(semAcento(palavra.toLowerCase()))
}

// Cada caractere de uso privado é sempre a mesma ligadura no livro inteiro: fica a que mais acerta.
export function aprenderLigaduras(linhas, vocabulario) {
  const palavrasPorCaractere = new Map()
  for (const { texto } of linhas) {
    for (const palavra of texto.match(/[\p{L}\ue000-\uf8ff]*[\ue000-\uf8ff][\p{L}\ue000-\uf8ff]*/gu) ?? []) {
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
    for (const candidato of CANDIDATOS) {
      const total = palavras.filter((p) => conhecida(p.replace(USO_PRIVADO, (c) => (c === caractere ? candidato : '')), vocabulario)).length
      if (total > acertos) {
        acertos = total
        melhor = candidato
      }
    }
    mapa.set(caractere, melhor)
  }
  return mapa
}

// O \u0000 junta ligaduras diferentes, então a escolha é palavra a palavra; sem acerto no
// vocabulário, "fl" antes de "u" (flutuar, fluir) e "fi" antes das outras letras.
export function corrigirLigaduras(texto, vocabulario, mapa = new Map()) {
  if (!DESCONHECIDO.test(texto)) return texto
  const traduzido = texto.replace(USO_PRIVADO, (c) => mapa.get(c) ?? '')
  return traduzido.replace(/[\p{L}\u0000]*\u0000[\p{L}\u0000]*/gu, (palavra) => {
    const achada = LIGADURAS.find((lig) => conhecida(palavra.replaceAll('\u0000', lig), vocabulario))
    if (achada) return palavra.replaceAll('\u0000', achada)
    return palavra.replace(/\u0000(?=u)/gu, 'fl').replace(/\u0000(?=\p{Ll})/gu, 'fi').replaceAll('\u0000', '')
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

/**
 * Transforma as páginas do PDF em blocos de texto corrido.
 * paginas: [{ numero, itens }], com os itens de getTextContent().
 * Cada bloco: { tipo: 'paragrafo' | 'titulo' | 'nota', texto, recuo, marcas: [{ pagina, posicao }] },
 * em que cada marca diz onde, no texto do bloco, começa uma página do PDF.
 */
export function montarTexto(paginas) {
  const porPagina = paginas.map(({ numero, itens }) => linhasDaPagina(itens, numero))
  const todas = porPagina.flat()
  if (!todas.length) return []

  const corpo = moda(todas.map((l) => [Math.round(l.altura), l.texto.length])) || 12
  const doCorpo = (l) => Math.abs(l.altura - corpo) <= corpo * 0.15
  const vocabulario = vocabularioDe(todas)
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
  let notasPendentes = []
  let anterior = null

  const fechar = () => {
    if (bloco) blocos.push(bloco)
    bloco = null
    if (notasPendentes.length) blocos.push(...notasPendentes)
    notasPendentes = []
  }

  for (const linhas of porPagina) {
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
      if (descartar.has(linha)) continue
      const texto = corrigirLigaduras(linha.texto, vocabulario, ligaduras)

      if (indice >= inicioNotas) {
        if (!nota || /^[\d*†]/.test(texto)) {
          nota = { tipo: 'nota', texto, recuo: false, marcas: [] }
          notasPendentes.push(nota)
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
  }
  fechar()
  // A junção de linhas hifenizadas não deixa espaço; a marca não pode passar do fim do texto.
  for (const b of blocos) {
    for (const m of b.marcas) m.posicao = Math.min(m.posicao, b.texto.length)
  }
  return blocos
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

function elementoDoBloco(bloco, indice) {
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
  const { tarefa, doc } = await carregarDocumento(livro)
  const sumario = await lerSumario(doc)
  const total = doc.numPages
  const paginas = []
  for (let numero = 1; numero <= total; numero++) {
    const pagina = await doc.getPage(numero)
    paginas.push({ numero, itens: (await pagina.getTextContent()).items })
    pagina.cleanup()
  }
  const blocos = montarTexto(paginas)

  instalarFontes()
  const janela = document.createElement('div')
  janela.className = 'texto-pdf'
  const artigo = document.createElement('article')
  artigo.lang = 'pt-BR'
  if (blocos.length) artigo.append(...blocos.map(elementoDoBloco))
  else artigo.append(Object.assign(document.createElement('p'), { className: 'sem-texto', textContent: 'Este PDF não tem texto para mostrar; use o modo página.' }))
  const fim = document.createElement('span')
  artigo.append(fim)
  janela.append(artigo)
  area.replaceChildren(janela)

  let largura = 1
  let telas = 1
  let tela = 0
  // Tela em que começa cada página do PDF; páginas sem texto (só imagem) não aparecem.
  let inicios = []
  // Página pedida (ao abrir, pelo sumário, ao mudar a fonte): várias páginas curtas podem
  // começar na mesma tela, e a posição deve continuar sendo a que foi pedida.
  let alvo = null
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
  }

  function telaDe(el) {
    const base = artigo.getBoundingClientRect().left
    return Math.max(0, Math.floor((el.getBoundingClientRect().left - base + 1) / largura))
  }

  function medir() {
    telas = telaDe(fim) + 1
    inicios = [...artigo.querySelectorAll('.inicio-pagina')]
      .map((el) => ({ pagina: Number(el.dataset.pagina), tela: telaDe(el) }))
  }

  function paginaAtual() {
    if (alvo && telaDaPosicao(alvo) === tela) return alvo
    let atual = inicios[0] ?? { pagina: 1, tela: 0 }
    for (const inicio of inicios) {
      if (inicio.tela > tela) break
      atual = inicio
    }
    const fimDaPagina = inicios.find((i) => i.tela > atual.tela)?.tela ?? telas
    const fracao = fimDaPagina > atual.tela ? (tela - atual.tela) / (fimDaPagina - atual.tela) : 0
    return { pagina: atual.pagina, fracao }
  }

  function telaDaPosicao({ pagina, fracao }) {
    const inicio = inicios.find((i) => i.pagina >= pagina)
    if (!inicio) return telas - 1
    const fimDaPagina = inicios.find((i) => i.tela > inicio.tela)?.tela ?? telas
    return inicio.tela + Math.round(fracao * (fimDaPagina - inicio.tela))
  }

  function mostrar() {
    janela.scrollLeft = tela * largura
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

  return {
    sumario: () => sumario,
    anterior: () => irParaTela(tela - 1),
    proxima: () => irParaTela(tela + 1),
    irPara: (pagina) => irParaTela(telaDaPosicao({ pagina, fracao: 0 }), true, { pagina, fracao: 0 }),
    irParaPercentual: (percentual) => irParaTela(Math.round(percentual * (telas - 1))),
    irParaAncora(ancora) {
      const pagina = JSON.parse(ancora).pagina
      if (pagina) irParaTela(telaDaPosicao({ pagina, fracao: 0 }), true, { pagina, fracao: 0 })
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
