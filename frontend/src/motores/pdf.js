import urlDoWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

const LARGURA_CAPA = 400

// Carrega só quando há um PDF: o PDF.js é bem maior que o resto do app.
async function carregarPdfjs() {
  const pdfjs = await import('pdfjs-dist')
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

async function lerSumario(doc) {
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

export async function abrirPdf({ livro, area, posicao, preferencias, aoMudar, aoClicar, aoDeslizar }) {
  const pdfjs = await carregarPdfjs()
  const tarefa = pdfjs.getDocument({ url: `/api/books/${encodeURIComponent(livro.id)}/file` })
  const doc = await tarefa.promise
  const sumario = await lerSumario(doc)
  const total = doc.numPages

  let atual = Math.min(Math.max(Number.parseInt(posicao, 10) || 1, 1), total)
  let zoom = preferencias.zoom
  let geracao = 0
  let inicioToque = null

  async function renderizar() {
    const minha = ++geracao
    const pagina = await doc.getPage(atual)
    const base = pagina.getViewport({ scale: 1 })
    const ajuste = Math.min(area.clientWidth / base.width, area.clientHeight / base.height) || 1
    const canvas = document.createElement('canvas')
    await desenhar(pagina, canvas, (ajuste * zoom) / 100)
    // Se o leitor já mudou de página, este desenho ficou velho.
    if (minha !== geracao) return
    area.replaceChildren(canvas)
    area.scrollTo?.(0, 0)
  }

  function avisar() {
    const capitulo = sumario.filter((item) => item.destino <= atual).at(-1)
    aoMudar({
      posicao: String(atual),
      percentual: total > 1 ? (atual - 1) / (total - 1) : 1,
      capitulo: capitulo?.destino ?? '',
      rotulo: `Página ${atual} de ${total}`,
    })
  }

  async function irPara(pagina) {
    if (pagina < 1 || pagina > total) return
    atual = pagina
    avisar()
    await renderizar()
  }

  const aoRedimensionar = () => renderizar()
  const aoClicarArea = (evento) => aoClicar(evento.clientX)
  const aoTocar = (evento) => {
    inicioToque = evento.changedTouches[0]
  }
  const aoSoltar = (evento) => {
    const fim = evento.changedTouches[0]
    // Com zoom, arrastar serve para percorrer a página.
    if (!inicioToque || !fim || zoom > 100) return
    const dx = fim.screenX - inicioToque.screenX
    const dy = fim.screenY - inicioToque.screenY
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) aoDeslizar(dx < 0 ? 'proxima' : 'anterior')
  }

  window.addEventListener('resize', aoRedimensionar)
  area.addEventListener('click', aoClicarArea)
  area.addEventListener('touchstart', aoTocar, { passive: true })
  area.addEventListener('touchend', aoSoltar, { passive: true })

  await renderizar()
  avisar()

  return {
    sumario: () => sumario,
    anterior: () => irPara(atual - 1),
    proxima: () => irPara(atual + 1),
    irPara,
    aplicar(novas) {
      if (novas.zoom === zoom) return
      zoom = novas.zoom
      renderizar()
    },
    redimensionar: renderizar,
    destruir() {
      geracao++
      window.removeEventListener('resize', aoRedimensionar)
      area.removeEventListener('click', aoClicarArea)
      area.removeEventListener('touchstart', aoTocar)
      area.removeEventListener('touchend', aoSoltar)
      tarefa.destroy()
    },
  }
}
