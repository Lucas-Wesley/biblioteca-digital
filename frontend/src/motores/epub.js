import { DecorationStyleType, EpubNavigator } from '@readium/navigator'
import { HttpFetcher, Link, Locator, Manifest, Publication } from '@readium/shared'
import literataItalico from '@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url'
import literataExtraItalico from '@fontsource-variable/literata/files/literata-latin-ext-wght-italic.woff2?url'
import literataExtra from '@fontsource-variable/literata/files/literata-latin-ext-wght-normal.woff2?url'
import literata from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url'
import { estaBaixado } from '../offline.js'
import { TEMAS } from '../preferencias.js'
import { criarEmbutidor } from './embutir.js'
import { criarSelecaoPorToque, selecaoPorToqueDisponivel } from './selecao-toque.js'

const GRUPO_MARCACOES = 'marcacoes'
const ESPERA_SELECAO = 250
// Abrir o livro ou mudar a fonte reposiciona o texto aos poucos; isso não é leitura.
const ESPERA_ASSENTAR = 600
const INTERVALO_LAYOUT = 50
const MAXIMO_LEITURAS_LAYOUT = 30
const LIMITE_POSICAO = 3500
const CONTEXTO_MARCACAO = 40
const TAMANHO_TRECHO = 60
const PASSO_TRECHO = 10
// O toque que ativa uma marcação também chega como toque comum, e não pode virar a página.
const ESPERA_TOQUE_NA_MARCACAO = 200

export const CORES_MARCACAO = {
  amarelo: '#ffd60a',
  verde: '#5fd38d',
  azul: '#64c8ff',
  rosa: '#ff8fb8',
}

const FAMILIAS = {
  original: null,
  literata: "'Literata', Georgia, serif",
  'sem-serifa': "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
}
const ENTRELINHAS = { compacto: 1.4, normal: 1.6, amplo: 1.85 }
const MARGENS = { pequena: 16, media: 28, grande: 56 }
const PREFERENCIAS_DE_LAYOUT = ['fonte', 'familia', 'entrelinhas', 'alinhamento', 'margem']

function urlAbsoluta(url) {
  return new URL(url, location.href).href
}

// Do bundle e do cache do app, para ser igual em qualquer aparelho e funcionar sem rede.
async function cssDasFontes(embutidor) {
  const latin = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
  const extra = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'
  const faces = await Promise.all([
    [literata, 'normal', latin],
    [literataExtra, 'normal', extra],
    [literataItalico, 'italic', latin],
    [literataExtraItalico, 'italic', extra],
  ].map(async ([arquivo, estilo, faixa]) => {
    const blob = await embutidor.paraBlob(urlAbsoluta(arquivo))
    return blob ? `@font-face {
      font-family: 'Literata'; font-style: ${estilo}; font-weight: 200 900; font-display: swap;
      src: url("${blob}") format('woff2'); unicode-range: ${faixa};
    }` : ''
  }))
  return faces.join('\n')
}

function preferenciasDoReadium(p) {
  const tema = TEMAS[p.tema]
  const justificado = p.alinhamento === 'justificado'
  return {
    scroll: false,
    columnCount: 1,
    fontSize: p.fonte / 100,
    fontFamily: FAMILIAS[p.familia] ?? null,
    lineHeight: ENTRELINHAS[p.entrelinhas] ?? ENTRELINHAS.normal,
    pageGutter: MARGENS[p.margem] ?? MARGENS.media,
    textAlign: justificado ? 'justify' : 'start',
    hyphens: justificado,
    backgroundColor: tema.fundo,
    textColor: tema.texto,
    linkColor: tema.link,
    visitedColor: tema.link,
  }
}

function achatarSumario(itens, nivel = 0) {
  return (itens ?? []).flatMap((item) => [
    { rotulo: item.title?.trim() ?? '', destino: item.href, nivel },
    ...achatarSumario(item.children?.items ?? item.children, nivel + 1),
  ])
}

export function semTrecho(href) {
  return href.split('#')[0]
}

// A posição salva pelo epub.js dizia o arquivo do livro (/6/N) e, no percentual, quanto dele
// já tinha sido lido: dá para voltar ao mesmo ponto sem interpretar o CFI inteiro.
export function converterCfi(cfi, percentual, leitura) {
  const achado = cfi.match(/^epubcfi\(\/6\/(\d+)/)
  const indice = achado ? Number(achado[1]) / 2 - 1 : -1
  const item = leitura[indice]
  if (!item) return undefined
  const dentro = Math.min(Math.max((percentual ?? 0) * leitura.length - indice, 0), 0.999)
  return Locator.deserialize({ href: item.href, type: item.type, locations: { progression: dentro } })
}

function posicaoInicial(posicao, percentual, leitura) {
  if (!posicao) return undefined
  if (posicao.startsWith('epubcfi(')) return converterCfi(posicao, percentual, leitura)
  try {
    return Locator.deserialize(JSON.parse(posicao))
  } catch {
    // Uma posição salva pode não valer mais; o livro ainda deve abrir.
    return undefined
  }
}

function serializarPosicao(local) {
  const dados = local.serialize()
  // O campo do servidor tem limite, e a posição funciona sem o trecho citado.
  if (JSON.stringify(dados).length > LIMITE_POSICAO) delete dados.text
  return JSON.stringify(dados)
}

// O Readium só entrega o texto selecionado. O trecho em volta é o que mantém a marcação no
// lugar quando a fonte muda, ou quando a mesma frase aparece duas vezes no capítulo.
export function ancoraDaSelecao(doc, local, faixa = null) {
  const selecao = faixa ? null : doc.getSelection()
  if (!faixa && (!selecao || selecao.isCollapsed || !selecao.rangeCount)) return null
  const trecho = faixa ?? selecao.getRangeAt(0)
  const texto = trecho.toString()
  if (!texto.trim()) return null

  const antes = doc.createRange()
  antes.selectNodeContents(doc.body)
  antes.setEnd(trecho.startContainer, trecho.startOffset)
  const depois = doc.createRange()
  depois.selectNodeContents(doc.body)
  depois.setStart(trecho.endContainer, trecho.endOffset)
  const textoAntes = antes.toString()
  const textoDepois = depois.toString()
  const total = textoAntes.length + texto.length + textoDepois.length

  return {
    texto: texto.trim(),
    progresso: total ? textoAntes.length / total : 0,
    locator: {
      href: local.href,
      type: local.type,
      locations: { progression: total ? textoAntes.length / total : 0 },
      text: {
        highlight: texto,
        before: textoAntes.slice(-CONTEXTO_MARCACAO),
        after: textoDepois.slice(0, CONTEXTO_MARCACAO),
      },
    },
  }
}

// A posição do Readium guarda só o percentual do capítulo, que muda de sentido quando as páginas
// se redistribuem. O começo do texto visível é o que permite voltar exatamente ao mesmo trecho.
export function trechoVisivel(doc) {
  const largura = doc.defaultView.innerWidth
  const passos = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const trecho = doc.createRange()
  while (passos.nextNode()) {
    const no = passos.currentNode
    if (!no.data.trim()) continue
    for (let i = 0; i < no.data.length; i += PASSO_TRECHO) {
      trecho.setStart(no, i)
      trecho.setEnd(no, Math.min(i + 1, no.data.length))
      const { left, width } = trecho.getBoundingClientRect()
      if (width > 0 && left >= 0 && left < largura) {
        return {
          highlight: no.data.slice(i, i + TAMANHO_TRECHO),
          before: no.data.slice(Math.max(i - CONTEXTO_MARCACAO, 0), i),
          after: no.data.slice(i + TAMANHO_TRECHO, i + TAMANHO_TRECHO + CONTEXTO_MARCACAO),
        }
      }
    }
  }
  return null
}

export async function abrirEpub({
  livro, area, posicao, percentualSalvo, preferencias,
  aoMudar, aoClicar, aoTeclar, aoSelecionar = () => {}, aoTocarMarcacao = () => {},
}) {
  const urlManifesto = urlAbsoluta(`/api/books/${encodeURIComponent(livro.id)}/publication/manifest.json`)
  const embutidor = criarEmbutidor()
  const baixado = await estaBaixado(livro.id)
  const buscador = new HttpFetcher(baixado ? embutidor.buscar : undefined, urlManifesto)
  const json = await buscador.get(new Link({ href: 'manifest.json' })).readAsJSON()
  const manifesto = Manifest.deserialize(json)
  manifesto.setSelfLink(urlManifesto)
  const publicacao = new Publication({ manifest: manifesto, fetcher: buscador })
  const posicoes = await publicacao.positionsFromManifest()
  const leitura = publicacao.readingOrder.items

  const ordem = leitura.map((item) => semTrecho(item.href))
  const sumario = achatarSumario(publicacao.toc?.items).map((item) => ({
    ...item,
    secao: ordem.indexOf(semTrecho(item.destino)),
    ancora: item.destino.split('#')[1] ?? '',
  }))

  let nav
  let local = null
  let assentando = true
  let temporizadorAssentar
  let temporizadorSelecao
  let aplicadas = { ...preferencias }
  let fila = Promise.resolve()
  let marcacoes = []
  let alvoDoAjuste = null
  let ajustesPendentes = 0
  let ativouMarcacaoEm = 0
  const documentosOuvidos = new WeakSet()
  const toque = selecaoPorToqueDisponivel()
    ? criarSelecaoPorToque({
      camada: area.parentElement,
      aoComecar: () => aoSelecionar(null),
      aoTerminar: (faixa, doc) => avisarSelecao(doc, faixa),
    })
    : null

  function assentar() {
    assentando = true
    clearTimeout(temporizadorAssentar)
    temporizadorAssentar = setTimeout(() => {
      assentando = false
    }, ESPERA_ASSENTAR)
  }

  // O Readium mantém os capítulos vizinhos carregados em quadros escondidos.
  function quadroAtual() {
    return nav?._cframes?.find(Boolean)?.iframe
  }

  function capituloDe(atual) {
    const indice = ordem.indexOf(semTrecho(atual.href))
    const anteriores = sumario.filter((item) => item.secao >= 0 && item.secao <= indice)
    const doc = quadroAtual()?.contentDocument
    for (const item of [...anteriores].reverse()) {
      if (item.secao < indice || !item.ancora) return item
      // Vários capítulos podem estar no mesmo arquivo: vale o último que já começou.
      const alvo = doc?.getElementById(item.ancora)
      if (!alvo || alvo.getBoundingClientRect().left < doc.defaultView.innerWidth) return item
    }
    return null
  }

  function progressoTotal(href, dentro) {
    const doCapitulo = posicoes.filter((p) => semTrecho(p.href) === semTrecho(href))
    if (!doCapitulo.length) return 0
    const inicio = doCapitulo[0].locations.totalProgression ?? 0
    const proximo = posicoes[posicoes.indexOf(doCapitulo.at(-1)) + 1]?.locations.totalProgression ?? 1
    return Math.min(inicio + (proximo - inicio) * dentro, 1)
  }

  function caixaDaFaixa(faixa) {
    const caixa = faixa.getBoundingClientRect()
    const topo = quadroAtual()?.getBoundingClientRect().top ?? 0
    return { topo: caixa.top + topo, base: caixa.bottom + topo }
  }

  function avisarSelecao(doc, faixa = null) {
    const ancora = doc && local ? ancoraDaSelecao(doc, local, faixa) : null
    if (!ancora) {
      aoSelecionar(null)
      return
    }
    const trecho = faixa ?? doc.getSelection().getRangeAt(0)
    aoSelecionar({
      texto: ancora.texto,
      ancora: JSON.stringify(ancora.locator),
      percentual: progressoTotal(local.href, ancora.progresso),
      rotulo: capituloDe(local)?.rotulo ?? '',
      caixa: caixaDaFaixa(trecho),
    })
  }

  function aoMudarSelecao() {
    clearTimeout(temporizadorSelecao)
    temporizadorSelecao = setTimeout(() => avisarSelecao(quadroAtual()?.contentDocument), ESPERA_SELECAO)
  }

  function ouvirDocumento() {
    const doc = quadroAtual()?.contentDocument
    if (!doc || documentosOuvidos.has(doc)) return
    documentosOuvidos.add(doc)
    doc.addEventListener('selectionchange', aoMudarSelecao)
    doc.addEventListener('keydown', aoTeclar)
    toque?.ouvir(doc, doc, { quadroAtual })
  }

  function haSelecao() {
    const doc = quadroAtual()?.contentDocument
    return Boolean(doc?.getSelection()?.toString())
  }

  function aoToque(evento) {
    if (toque?.faixa()) {
      if (!toque.recemSolta()) {
        toque.limpar()
        aoSelecionar(null)
      }
      return true
    }
    if (haSelecao() || Date.now() - ativouMarcacaoEm < ESPERA_TOQUE_NA_MARCACAO) return true
    // O Readium manda a posição multiplicada pela densidade da tela e relativa ao quadro.
    const quadro = quadroAtual()?.getBoundingClientRect()
    const x = evento.x / (window.devicePixelRatio || 1) + (quadro?.left ?? 0)
    aoClicar(x)
    return true
  }

  const ouvintes = {
    frameLoaded: ouvirDocumento,
    positionChanged(novo) {
      // A seleção por toque só vale para a página em que foi feita.
      if (toque?.faixa() && novo.locations?.position !== local?.locations?.position) {
        toque.limpar()
        aoSelecionar(null)
      }
      local = novo
      ouvirDocumento()
      const capitulo = capituloDe(novo)
      aoMudar({
        posicao: serializarPosicao(novo),
        percentual: novo.locations?.totalProgression ?? 0,
        capitulo: capitulo?.destino ?? '',
        rotulo: capitulo?.rotulo ?? '',
      }, !assentando)
    },
    tap: aoToque,
    click: aoToque,
    handleLocator(destino) {
      // Link para fora do livro: abre à parte, sem tirar o leitor da página.
      if (/^(https?|mailto|tel):/.test(destino.href)) window.open(destino.href, '_blank', 'noopener')
      return true
    },
    viewportChanged() {},
    timelineItemChanged() {},
    zoom() {},
    miscPointer() {},
    scroll() {},
    customEvent() {},
    textSelected() {},
    contentProtection() {},
    contextMenu() {},
    peripheral() {},
  }

  const inicial = posicaoInicial(posicao, percentualSalvo, leitura)
  nav = new EpubNavigator(area, publicacao, ouvintes, posicoes, inicial, {
    preferences: preferenciasDoReadium(preferencias),
    defaults: {},
    injectables: {
      rules: [{
        resources: [/.*/],
        append: [{ as: 'link', rel: 'stylesheet', blob: new Blob([await cssDasFontes(embutidor)], { type: 'text/css' }) }],
      }],
    },
  })
  await nav.load()
  assentar()
  ouvirDocumento()

  nav.registerDecorationObserver(GRUPO_MARCACOES, {
    onDecorationActivated({ decoration }) {
      ativouMarcacaoEm = Date.now()
      // Soltar o dedo depois de selecionar, ou tocar para desfazer a seleção, não é editar a marcação.
      if (!toque?.faixa()) aoTocarMarcacao(decoration.id)
      // Falso de propósito: com verdadeiro, o Readium descarta o próximo toque, mesmo que seja outro.
      return false
    },
  })

  // O quadro redistribui o texto depois de receber o CSS, e buscar o trecho antes disso erra a página.
  async function layoutAssentado() {
    let anterior = -1
    let iguais = 0
    for (let i = 0; i < MAXIMO_LEITURAS_LAYOUT && iguais < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, INTERVALO_LAYOUT))
      const largura = quadroAtual()?.contentDocument?.scrollingElement?.scrollWidth ?? 0
      iguais = largura === anterior ? iguais + 1 : 0
      anterior = largura
    }
  }

  function localDoTrechoVisivel() {
    const doc = quadroAtual()?.contentDocument
    const text = doc && trechoVisivel(doc)
    if (!text || !local) return local
    return Locator.deserialize({ href: local.href, type: local.type, locations: { progression: local.locations?.progression }, text })
  }

  function ir(locator) {
    return new Promise((resolve) => nav.go(locator, false, resolve))
  }

  // Uma navegação recusa a outra enquanto está em andamento, então os pedidos ficam em fila.
  function enfileirar(acao) {
    fila = fila.then(acao).catch((erro) => console.warn('Falha ao navegar no livro', erro))
    return fila
  }

  function desenharMarcacoes() {
    nav.applyDecorations(marcacoes.flatMap((marca) => {
      try {
        return [{
          id: marca.id,
          locator: Locator.deserialize(JSON.parse(marca.anchor)),
          style: { type: DecorationStyleType.Highlight, tint: CORES_MARCACAO[marca.color], enforceContrast: false },
        }]
      } catch {
        return []
      }
    }), GRUPO_MARCACOES)
  }

  return {
    sumario: () => sumario,
    anterior: () => new Promise((resolve) => nav.goBackward(false, resolve)),
    proxima: () => new Promise((resolve) => nav.goForward(false, resolve)),
    irPara: (destino) => enfileirar(() => new Promise((resolve) => nav.goLink(new Link({ href: destino }), false, resolve))),
    irParaPercentual(percentual) {
      const alvo = posicoes.findLast((p) => (p.locations.totalProgression ?? 0) <= percentual) ?? posicoes[0]
      return enfileirar(() => ir(alvo))
    },
    irParaAncora: (ancora) => enfileirar(() => ir(Locator.deserialize(JSON.parse(ancora)))),
    marcar(lista) {
      marcacoes = lista
      desenharMarcacoes()
    },
    limparSelecao() {
      toque?.limpar()
      quadroAtual()?.contentDocument?.getSelection()?.removeAllRanges()
    },
    aplicar(novas) {
      const mudouLayout = PREFERENCIAS_DE_LAYOUT.some((chave) => novas[chave] !== aplicadas[chave])
      aplicadas = { ...novas }
      // Vários toques seguidos no A+ continuam voltando ao trecho do primeiro.
      if (mudouLayout && !alvoDoAjuste) alvoDoAjuste = localDoTrechoVisivel()
      const lido = preferenciasDoReadium(novas)
      ajustesPendentes++
      return enfileirar(async () => {
        assentar()
        await nav.submitPreferences(lido)
        ajustesPendentes--
        // Mudar a letra redistribui as páginas; volta ao trecho que estava na tela. Se outro
        // ajuste chegou nesse meio-tempo, é ele que faz a volta, depois de aplicado.
        if (alvoDoAjuste && !ajustesPendentes) await layoutAssentado()
        if (alvoDoAjuste && !ajustesPendentes) await ir(alvoDoAjuste)
        if (!ajustesPendentes) alvoDoAjuste = null
        assentar()
      })
    },
    // O Readium acompanha sozinho o tamanho da área.
    redimensionar() {},
    destruir() {
      clearTimeout(temporizadorAssentar)
      clearTimeout(temporizadorSelecao)
      toque?.destruir()
      nav.destroy()
      embutidor.liberar()
    },
  }
}
