import urlDoWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { estaBaixado } from '../offline.js'
import { criarSelecaoPorToque, selecaoPorToqueDisponivel } from './selecao-toque.js'

const LARGURA_CAPA = 400
const ESPERA_SELECAO = 250

// Carrega só quando há um PDF: o PDF.js é bem maior que o resto do app. A versão legacy traz o
// que falta nos navegadores mais antigos; a normal não abre nada no Chrome 134 (sem Uint8Array.toHex).
async function carregarPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = urlDoWorker
  return pdfjs
}

async function desenhar(pagina, canvas, escala) {
  // Limitado a 2x para um PDF grande não esgotar a memória do celular.
  const densidade = Math.min(window.devicePixelRatio || 1, 2)
  const viewport = pagina.getViewport({ scale: escala * densidade })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  canvas.style.width = `${Math.floor(viewport.width / densidade)}px`
  canvas.style.height = `${Math.floor(viewport.height / densidade)}px`
  const tarefa = pagina.render({ canvas, viewport })
  await tarefa.promise
}

// O Go não lê PDF, então título, autor e capa saem daqui, antes do envio.
export async function lerMetadadosPdf(arquivo) {
  const url = URL.createObjectURL(arquivo)
  const pdfjs = await carregarPdfjs()
  const tarefa = pdfjs.getDocument({ url })
  try {
    const doc = await tarefa.promise
    const { info } = await doc.getMetadata()
    const pagina = await doc.getPage(1)
    const canvas = document.createElement('canvas')
    const viewport = pagina.getViewport({ scale: LARGURA_CAPA / pagina.getViewport({ scale: 1 }).width })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    await pagina.render({ canvas, viewport }).promise
    const capa = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    return { titulo: info?.Title ?? '', autor: info?.Author ?? '', capa }
  } finally {
    URL.revokeObjectURL(url)
    tarefa.destroy()
  }
}

export async function lerSumario(doc) {
  const achatar = async (itens, nivel) => {
    const lista = []
    for (const item of itens ?? []) {
      try {
        const destino = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest
        if (destino) {
          const indice = await doc.getPageIndex(destino[0])
          lista.push({ rotulo: item.title.trim(), destino: indice + 1, nivel })
        }
      } catch {
        // Um item com destino quebrado não deve derrubar o sumário inteiro.
      }
      lista.push(...(await achatar(item.items, nivel + 1)))
    }
    return lista
  }
  return achatar(await doc.getOutline(), 0)
}

export async function carregarDocumento(livro) {
  const pdfjs = await carregarPdfjs()
  // O baixado vem do cache, inteiro: o service worker não responde a pedidos por partes.
  const tarefa = pdfjs.getDocument({
    url: `/api/books/${encodeURIComponent(livro.id)}/file`,
    disableRange: await estaBaixado(livro.id),
  })
  return { pdfjs, tarefa, doc: await tarefa.promise }
}

// Em frações da página: a marcação continua no lugar com qualquer zoom ou tamanho de tela.
export function retangulosDaSelecao(trecho, pagina) {
  const base = pagina.getBoundingClientRect()
  if (!base.width || !base.height) return []
  return [...trecho.getClientRects()]
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      x: (r.left - base.left) / base.width,
      y: (r.top - base.top) / base.height,
      l: r.width / base.width,
      a: r.height / base.height,
    }))
}

export async function abrirPdf({
  livro, area, posicao, preferencias,
  aoMudar, aoClicar, aoDeslizar, aoSelecionar = () => {}, aoTocarMarcacao = () => {},
}) {
  const { pdfjs, tarefa, doc } = await carregarDocumento(livro)
  const sumario = await lerSumario(doc)
  const total = doc.numPages

  let atual = Math.min(Math.max(Number.parseInt(posicao, 10) || 1, 1), total)
  let zoom = preferencias.zoom
  let geracao = 0
  let inicioToque = null
  let camadaTexto = null
  let paginaEl = null
  let camadaMarcas = null
  let marcacoes = []
  let temporizadorSelecao
  const toque = selecaoPorToqueDisponivel()
    ? criarSelecaoPorToque({
      camada: area.parentElement,
      aoComecar: () => aoSelecionar(null),
      aoTerminar: avisarSelecao,
    })
    : null

  function rotuloCapitulo() {
    return sumario.filter((item) => item.destino <= atual).at(-1)
  }

  function ancoraDe(marca) {
    try {
      return JSON.parse(marca.anchor)
    } catch {
      return null
    }
  }

  function desenharMarcacoes() {
    if (!camadaMarcas) return
    camadaMarcas.replaceChildren(...marcacoes.flatMap((marca) => {
      const ancora = ancoraDe(marca)
      if (ancora?.pagina !== atual) return []
      return ancora.retangulos.map((r) => {
        const el = document.createElement('div')
        el.className = `marca marca-${marca.color}`
        el.dataset.marcacao = marca.id
        el.style.cssText = `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.l * 100}%;height:${r.a * 100}%`
        return el
      })
    }))
  }

  // Ponto da página no centro da tela, em frações: com zoom, a página nova abre no mesmo lugar.
  function centroVisivel() {
    if (!paginaEl) return { x: 0.5, y: 0 }
    return {
      x: (area.scrollLeft + area.clientWidth / 2) / area.scrollWidth,
      y: (area.scrollTop + area.clientHeight / 2) / area.scrollHeight,
    }
  }

  function voltarAoCentro({ x, y }, manterAltura) {
    area.scrollLeft = Math.max(0, x * area.scrollWidth - area.clientWidth / 2)
    area.scrollTop = manterAltura ? Math.max(0, y * area.scrollHeight - area.clientHeight / 2) : 0
  }

  // Ao virar a página, mantém a posição na horizontal e volta ao topo; no zoom, mantém as duas.
  async function renderizar({ manterAltura = true } = {}) {
    const minha = ++geracao
    const centro = centroVisivel()
    const pagina = await doc.getPage(atual)
    const base = pagina.getViewport({ scale: 1 })
    const ajuste = Math.min(area.clientWidth / base.width, area.clientHeight / base.height) || 1
    const escala = (ajuste * zoom) / 100
    const canvas = document.createElement('canvas')
    await desenhar(pagina, canvas, escala)

    const conteudo = await pagina.getTextContent()
    // Se o leitor já mudou de página, este desenho ficou velho.
    if (minha !== geracao) return

    const viewport = pagina.getViewport({ scale: escala })
    const novaPagina = document.createElement('div')
    novaPagina.className = 'pagina-pdf'
    novaPagina.style.width = `${Math.floor(viewport.width)}px`
    novaPagina.style.height = `${Math.floor(viewport.height)}px`
    novaPagina.style.setProperty('--total-scale-factor', String(escala))

    const marcas = document.createElement('div')
    marcas.className = 'camada-marcas'
    const texto = document.createElement('div')
    texto.className = 'textLayer'
    novaPagina.append(canvas, marcas, texto)

    const camada = new pdfjs.TextLayer({ textContentSource: conteudo, container: texto, viewport })
    await camada.render()
    if (minha !== geracao) return

    if (toque?.faixa()) {
      toque.limpar()
      aoSelecionar(null)
    }
    paginaEl = novaPagina
    camadaTexto = texto
    camadaMarcas = marcas
    area.replaceChildren(novaPagina)
    voltarAoCentro(centro, manterAltura)
    desenharMarcacoes()
  }

  function avisar(porLeitura) {
    const capitulo = rotuloCapitulo()
    aoMudar({
      posicao: String(atual),
      percentual: total > 1 ? (atual - 1) / (total - 1) : 1,
      capitulo: capitulo?.destino ?? '',
      rotulo: `Página ${atual} de ${total}`,
      contagem: { unidade: atual, porUnidade: 1, totalDePaginas: total },
    }, porLeitura)
  }

  async function irPara(pagina) {
    if (pagina < 1 || pagina > total) return
    atual = pagina
    avisar(true)
    await renderizar({ manterAltura: false })
  }

  function selecaoNaPagina() {
    if (toque?.faixa()) return toque.faixa()
    const selecao = document.getSelection()
    if (!selecao || selecao.isCollapsed || !selecao.rangeCount || !camadaTexto) return null
    const trecho = selecao.getRangeAt(0)
    if (!camadaTexto.contains(trecho.commonAncestorContainer)) return null
    return trecho.toString().trim() ? trecho : null
  }

  function avisarSelecao() {
    const trecho = selecaoNaPagina()
    if (!trecho) {
      aoSelecionar(null)
      return
    }
    const retangulos = retangulosDaSelecao(trecho, paginaEl)
    const caixa = trecho.getBoundingClientRect()
    aoSelecionar({
      texto: trecho.toString().trim(),
      ancora: JSON.stringify({ pagina: atual, retangulos }),
      percentual: total > 1 ? (atual - 1) / (total - 1) : 1,
      rotulo: rotuloCapitulo()?.rotulo ?? `Página ${atual}`,
      caixa: { topo: caixa.top, base: caixa.bottom },
    })
  }

  function aoMudarSelecao() {
    clearTimeout(temporizadorSelecao)
    temporizadorSelecao = setTimeout(avisarSelecao, ESPERA_SELECAO)
  }

  // A camada de texto fica sobre as marcações, então o toque é conferido pelas coordenadas.
  function marcacaoEm(x, y) {
    if (!camadaMarcas) return null
    for (const el of camadaMarcas.children) {
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el.dataset.marcacao
    }
    return null
  }

  const aoRedimensionar = () => renderizar()
  const aoClicarArea = (evento) => {
    if (toque?.faixa()) {
      if (!toque.recemSolta()) {
        toque.limpar()
        aoSelecionar(null)
      }
      return
    }
    if (selecaoNaPagina()) return
    const marca = marcacaoEm(evento.clientX, evento.clientY)
    if (marca) aoTocarMarcacao(marca)
    else aoClicar(evento.clientX)
  }
  const aoTocar = (evento) => {
    inicioToque = evento.changedTouches[0]
  }
  const aoSoltar = (evento) => {
    const fim = evento.changedTouches[0]
    // Com zoom, arrastar serve para percorrer a página; com seleção, para ajustá-la.
    if (!inicioToque || !fim || zoom > 100 || selecaoNaPagina()) return
    const dx = fim.screenX - inicioToque.screenX
    const dy = fim.screenY - inicioToque.screenY
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) aoDeslizar(dx < 0 ? 'proxima' : 'anterior')
  }

  window.addEventListener('resize', aoRedimensionar)
  document.addEventListener('selectionchange', aoMudarSelecao)
  area.addEventListener('click', aoClicarArea)
  toque?.ouvir(area, document, {
    seletor: '.textLayer, .textLayer *',
    aceita: (no) => camadaTexto?.contains(no),
  })
  area.addEventListener('touchstart', aoTocar, { passive: true })
  area.addEventListener('touchend', aoSoltar, { passive: true })

  await renderizar()
  avisar(false)

  return {
    sumario: () => sumario,
    anterior: () => irPara(atual - 1),
    proxima: () => irPara(atual + 1),
    irPara,
    irParaPercentual: (percentual) => irPara(Math.round(percentual * (total - 1)) + 1),
    irParaAncora(ancora) {
      const pagina = JSON.parse(ancora).pagina
      return pagina ? irPara(pagina) : undefined
    },
    marcar(lista) {
      marcacoes = lista
      desenharMarcacoes()
    },
    limparSelecao() {
      toque?.limpar()
      document.getSelection()?.removeAllRanges()
    },
    aplicar(novas) {
      if (novas.zoom === zoom) return
      zoom = novas.zoom
      renderizar()
    },
    redimensionar: () => renderizar(),
    destruir() {
      geracao++
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
