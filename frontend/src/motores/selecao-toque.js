// No toque, a seleção nativa traz junto o menu do Android e o painel de busca do Google, que a
// web não consegue desligar. Sem seleção nativa não há menu: aqui o app desenha a própria, com
// o toque longo, as alças e o destaque da CSS Highlight API, nos dois motores.
const TEMPO_TOQUE_LONGO = 450
const TOLERANCIA_DEDO = 10
// O alvo fica acima do dedo, para ele não esconder a letra que está sendo escolhida.
const DISTANCIA_DEDO = 22
const ESPERA_APOS_SOLTAR = 350
const NOME_DESTAQUE = 'biblioteca-selecao'

export function selecaoPorToqueDisponivel(wnd = window) {
  return Boolean(
    wnd.matchMedia?.('(pointer: coarse)').matches && wnd.CSS?.highlights && wnd.document.caretRangeFromPoint,
  )
}

// Início e fim da palavra em volta do ponto tocado; null se o toque caiu em espaço ou pontuação.
export function palavraEm(texto, posicao) {
  for (const { segment, index, isWordLike } of new Intl.Segmenter('pt', { granularity: 'word' }).segment(texto)) {
    if (posicao >= index && posicao < index + segment.length) {
      return isWordLike ? [index, index + segment.length] : null
    }
  }
  return null
}

function cssDaSelecao(seletor) {
  return `${seletor} { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; }
    ::highlight(${NOME_DESTAQUE}) { background-color: rgb(0 102 204 / 28%); }`
}

export function criarSelecaoPorToque({ camada, aoComecar, aoTerminar }) {
  let faixa = null
  let doc = null
  let quadro = null
  let temporizador = null
  let inicio = null
  let estendendo = false
  let ignorarToqueAte = 0
  const ouvidos = new WeakSet()
  const alcas = ['inicio', 'fim'].map(criarAlca)

  function deslocamento() {
    const caixa = quadro?.()?.getBoundingClientRect()
    return { x: caixa?.left ?? 0, y: caixa?.top ?? 0 }
  }

  function destaques() {
    return doc?.defaultView?.CSS?.highlights
  }

  function desenhar() {
    const lista = faixa ? [...faixa.getClientRects()].filter((r) => r.width > 0) : []
    if (!lista.length) {
      alcas.forEach((alca) => { alca.hidden = true })
      return
    }
    destaques()?.set(NOME_DESTAQUE, new doc.defaultView.Highlight(faixa))
    const { x, y } = deslocamento()
    const [primeira, ultima] = [lista[0], lista.at(-1)]
    posicionar(alcas[0], primeira.left + x, primeira.bottom + y)
    posicionar(alcas[1], ultima.right + x, ultima.bottom + y)
  }

  function posicionar(alca, x, y) {
    alca.hidden = false
    alca.style.transform = `translate(${x}px, ${y}px)`
  }

  function caretEm(x, y, aceita) {
    const caret = doc.caretRangeFromPoint(x, y)
    const no = caret?.startContainer
    if (no?.nodeType !== Node.TEXT_NODE || !aceita(no)) return null
    return { no, posicao: caret.startOffset }
  }

  // Mantém o outro extremo parado; passar dele inverte os lados, como na seleção nativa.
  function moverExtremo(extremo, ponto) {
    const nova = doc.createRange()
    const outro = extremo === 'inicio'
      ? [faixa.endContainer, faixa.endOffset]
      : [faixa.startContainer, faixa.startOffset]
    nova.setStart(...outro)
    nova.setEnd(ponto.no, ponto.posicao)
    if (nova.collapsed) {
      nova.setStart(ponto.no, ponto.posicao)
      nova.setEnd(...outro)
    }
    if (nova.collapsed || !nova.toString().trim()) return
    faixa = nova
    desenhar()
  }

  function criarAlca(extremo) {
    const alca = document.createElement('div')
    alca.className = 'alca-selecao'
    alca.hidden = true
    alca.dataset.extremo = extremo
    alca.addEventListener('touchstart', (evento) => {
      evento.preventDefault()
      aoComecar()
    }, { passive: false })
    alca.addEventListener('touchmove', (evento) => {
      evento.preventDefault()
      const { clientX, clientY } = evento.touches[0]
      const { x, y } = deslocamento()
      const ponto = caretEm(clientX - x, clientY - y - DISTANCIA_DEDO, () => true)
      if (ponto) moverExtremo(extremo, ponto)
    }, { passive: false })
    alca.addEventListener('touchend', () => aoTerminar(faixa, doc))
    camada.append(alca)
    return alca
  }

  function limpar() {
    clearTimeout(temporizador)
    destaques()?.delete(NOME_DESTAQUE)
    faixa = null
    estendendo = false
    alcas.forEach((alca) => { alca.hidden = true })
  }

  function comecar(raizDoc, quadroAtual, x, y, aceita) {
    if (faixa) limpar()
    doc = raizDoc
    quadro = quadroAtual
    const ponto = caretEm(x, y, aceita)
    const limites = ponto && palavraEm(ponto.no.data, ponto.posicao)
    if (!limites) return
    faixa = doc.createRange()
    faixa.setStart(ponto.no, limites[0])
    faixa.setEnd(ponto.no, limites[1])
    estendendo = true
    navigator.vibrate?.(10)
    aoComecar()
    desenhar()
  }

  // raiz recebe os toques: o documento do quadro no EPUB, a área da página no PDF.
  function ouvir(raiz, raizDoc, { quadroAtual = null, seletor = 'html, body, body *', aceita = () => true } = {}) {
    if (ouvidos.has(raiz)) return
    ouvidos.add(raiz)
    const estilo = raizDoc.createElement('style')
    estilo.textContent = cssDaSelecao(seletor)
    raizDoc.head.append(estilo)

    raiz.addEventListener('contextmenu', (evento) => evento.preventDefault())
    raiz.addEventListener('touchstart', (evento) => {
      clearTimeout(temporizador)
      if (evento.touches.length > 1) return
      const { clientX: x, clientY: y } = evento.touches[0]
      inicio = { x, y }
      temporizador = setTimeout(() => comecar(raizDoc, quadroAtual, x, y, aceita), TEMPO_TOQUE_LONGO)
    }, { passive: true })
    raiz.addEventListener('touchmove', (evento) => {
      const { clientX: x, clientY: y } = evento.touches[0]
      if (estendendo) {
        // O Readium também ouve o dedo, e a página não pode andar enquanto a seleção cresce.
        evento.preventDefault()
        evento.stopPropagation()
        const ponto = caretEm(x, y, aceita)
        if (ponto) moverExtremo('fim', ponto)
      } else if (inicio && Math.hypot(x - inicio.x, y - inicio.y) > TOLERANCIA_DEDO) {
        clearTimeout(temporizador)
      }
    }, { passive: false, capture: true })
    const aoSoltar = () => {
      clearTimeout(temporizador)
      if (!estendendo) return
      estendendo = false
      ignorarToqueAte = Date.now() + ESPERA_APOS_SOLTAR
      aoTerminar(faixa, raizDoc)
    }
    raiz.addEventListener('touchend', aoSoltar)
    raiz.addEventListener('touchcancel', aoSoltar)
  }

  return {
    ouvir,
    limpar,
    faixa: () => faixa,
    // O toque que encerra o gesto longo também chega como toque comum, e não pode desfazer a seleção.
    recemSolta: () => Date.now() < ignorarToqueAte,
    destruir() {
      limpar()
      alcas.forEach((alca) => alca.remove())
    },
  }
}
