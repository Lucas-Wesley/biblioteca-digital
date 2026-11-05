import ePub from 'epubjs'

const ID_ESTILO = 'biblioteca-tema'

// O livro pode trazer cores próprias, e texto escuro sumiria no fundo escuro.
// Sem o color-scheme igual ao da página, o navegador pinta o iframe de branco.
const CSS_ESCURO = `
  :root { color-scheme: dark; }
  html, body { background: #14171b !important; color: #dfe3e8 !important; }
  body * { color: inherit !important; background-color: transparent !important; }
  a, a * { color: #8fb4e3 !important; }
`

function aplicarTema(contents, tema) {
  const doc = contents.document
  let estilo = doc.getElementById(ID_ESTILO)
  if (!estilo) {
    estilo = doc.createElement('style')
    estilo.id = ID_ESTILO
    doc.head.appendChild(estilo)
  }
  estilo.textContent = tema === 'escuro' ? CSS_ESCURO : ''
}

function achatarSumario(itens, secao, nivel = 0) {
  return itens.flatMap((item) => [
    {
      rotulo: item.label.trim(),
      destino: item.href,
      nivel,
      secao: secao(item.href)?.index ?? -1,
      ancora: item.href.split('#')[1] ?? '',
    },
    ...achatarSumario(item.subitems ?? [], secao, nivel + 1),
  ])
}

// Vários capítulos podem estar no mesmo arquivo; nesse caso, compara a posição de cada âncora.
function capituloAtual(sumario, inicio, rendition, CFI) {
  const anteriores = sumario.filter((item) => item.secao >= 0 && item.secao <= inicio.index)
  const naSecao = anteriores.filter((item) => item.secao === inicio.index && item.ancora)
  const contents = rendition.getContents?.()[0]
  if (naSecao.length > 1 && contents && CFI) {
    const comparador = new CFI()
    for (const item of [...anteriores].reverse()) {
      if (item.secao < inicio.index || !item.ancora) return item
      const alvo = contents.document.getElementById(item.ancora)
      if (alvo && comparador.compare(contents.cfiFromNode(alvo), inicio.cfi) <= 0) return item
    }
  }
  return anteriores.at(-1) ?? null
}

// Aproximado: cada arquivo do livro pesa igual, sem precisar processar o livro inteiro.
function calcularPercentual(local, totalSecoes) {
  if (local.atEnd) return 1
  const { index, displayed } = local.start
  const naSecao = displayed?.total ? (displayed.page - 1) / displayed.total : 0
  return Math.min((index + naSecao) / (totalSecoes || 1), 1)
}

export async function abrirEpub({ livro, area, posicao, preferencias, aoMudar, aoClicar, aoDeslizar, aoTeclar }) {
  const epub = ePub(`/api/books/${encodeURIComponent(livro.id)}/file`, { openAs: 'epub' })
  const rendition = epub.renderTo(area, {
    width: '100%',
    height: '100%',
    flow: 'paginated',
    spread: 'none',
  })

  let tema = preferencias.tema
  let sumario = []
  let inicioToque = null

  rendition.hooks.content.register((contents) => aplicarTema(contents, tema))
  rendition.themes.fontSize(`${preferencias.fonte}%`)

  rendition.on('relocated', (local) => {
    const capitulo = capituloAtual(sumario, local.start, rendition, ePub.CFI)
    aoMudar({
      posicao: local.start.cfi,
      percentual: calcularPercentual(local, epub.spine.length),
      capitulo: capitulo?.destino ?? '',
      rotulo: capitulo?.rotulo ?? '',
    })
  })
  rendition.on('keydown', aoTeclar)
  rendition.on('click', (evento) => {
    // Link e seleção de texto não viram mudança de página.
    if (evento.target.closest?.('a') || evento.view?.getSelection()?.toString()) return
    const quadro = evento.view?.frameElement?.getBoundingClientRect().left ?? 0
    aoClicar(evento.clientX + quadro)
  })
  rendition.on('touchstart', (evento) => {
    inicioToque = evento.changedTouches[0]
  })
  rendition.on('touchend', (evento) => {
    const fim = evento.changedTouches[0]
    if (!inicioToque || !fim) return
    const dx = fim.screenX - inicioToque.screenX
    const dy = fim.screenY - inicioToque.screenY
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) aoDeslizar(dx < 0 ? 'proxima' : 'anterior')
  })

  const navegacao = await epub.loaded?.navigation
  sumario = achatarSumario(navegacao?.toc ?? [], (href) => epub.spine.get(href))

  try {
    await rendition.display(posicao || undefined)
  } catch (erro) {
    // Uma posição salva pode não valer mais; o livro ainda deve abrir.
    if (!posicao) throw erro
    await rendition.display()
  }

  return {
    sumario: () => sumario,
    anterior: () => rendition.prev(),
    proxima: () => rendition.next(),
    irPara: (destino) => rendition.display(destino),
    aplicar(novas) {
      tema = novas.tema
      rendition.themes.fontSize(`${novas.fonte}%`)
      rendition.getContents?.().forEach((contents) => aplicarTema(contents, tema))
    },
    // null faz o epub.js medir a área de novo e voltar para a mesma posição.
    redimensionar: () => rendition.resize(null, null),
    destruir: () => epub.destroy(),
  }
}
