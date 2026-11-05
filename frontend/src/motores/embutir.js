// Os quadros do Readium são documentos blob: com sandbox, e o que eles pedem não passa pelo
// service worker. Sem rede, CSS, imagens e fontes do livro não chegariam. Por isso, o livro
// baixado já entra no quadro com tudo embutido em blob:, que a política do quadro permite.
const ELEMENTOS = [
  ['link[rel~="stylesheet"][href]', 'href'],
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['video[src]', 'src'],
  ['video[poster]', 'poster'],
  ['audio[src]', 'src'],
  ['image[href]', 'href'],
]
const XLINK = 'http://www.w3.org/1999/xlink'
const URL_EM_CSS = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]*?))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')/g

function daOrigem(url) {
  return url.origin === location.origin
}

export function criarEmbutidor() {
  const blobs = new Map()

  function resolver(endereco, base) {
    if (!endereco || endereco.startsWith('#')) return null
    try {
      const url = new URL(endereco, base)
      return daOrigem(url) ? url : null
    } catch {
      return null
    }
  }

  async function embutirCss(css, base) {
    const achados = [...css.matchAll(URL_EM_CSS)]
    const trocas = await Promise.all(achados.map(async (achado) => {
      const endereco = achado.slice(1).find((grupo) => grupo !== undefined)
      const url = resolver(endereco, base)
      return url ? paraBlob(url.href) : null
    }))
    let i = 0
    return css.replace(URL_EM_CSS, (trecho) => {
      const blob = trocas[i++]
      if (!blob) return trecho
      return trecho.startsWith('@import') ? `@import "${blob}"` : `url("${blob}")`
    })
  }

  // Um arquivo citado em vários capítulos vira um blob só.
  function paraBlob(url) {
    if (!blobs.has(url)) {
      blobs.set(url, (async () => {
        const resposta = await fetch(url)
        if (!resposta.ok) return null
        const tipo = resposta.headers.get('Content-Type') ?? ''
        const conteudo = tipo.includes('text/css')
          ? new Blob([await embutirCss(await resposta.text(), url)], { type: tipo })
          : await resposta.blob()
        return URL.createObjectURL(conteudo)
      })().catch(() => null))
    }
    return blobs.get(url)
  }

  async function trocarAtributo(elemento, atributo, base, espaco = null) {
    const url = resolver(elemento.getAttributeNS(espaco, atributo), base)
    const blob = url && (await paraBlob(url.href))
    if (blob) elemento.setAttributeNS(espaco, atributo, blob)
  }

  async function embutirDocumento(doc, base) {
    const tarefas = ELEMENTOS.flatMap(([seletor, atributo]) =>
      [...doc.querySelectorAll(seletor)].map((elemento) => trocarAtributo(elemento, atributo, base)),
    )
    for (const elemento of doc.getElementsByTagName('image')) {
      if (elemento.hasAttributeNS(XLINK, 'href')) tarefas.push(trocarAtributo(elemento, 'href', base, XLINK))
    }
    for (const estilo of doc.querySelectorAll('style')) {
      tarefas.push(embutirCss(estilo.textContent, base).then((css) => { estilo.textContent = css }))
    }
    for (const elemento of doc.querySelectorAll('[style*="url("]')) {
      tarefas.push(embutirCss(elemento.getAttribute('style'), base).then((css) => elemento.setAttribute('style', css)))
    }
    await Promise.all(tarefas)
  }

  // Entra no lugar do fetch do Readium: os capítulos passam por aqui antes de virar quadro.
  async function buscar(url, opcoes) {
    const resposta = await fetch(url, opcoes)
    const tipo = resposta.headers.get('Content-Type') ?? ''
    if (!resposta.ok || !/html|xml/.test(tipo)) return resposta
    const texto = await resposta.text()
    const ehHtml = tipo.includes('text/html')
    const doc = new DOMParser().parseFromString(texto, ehHtml ? 'text/html' : 'application/xhtml+xml')
    if (doc.querySelector('parsererror')) return new Response(texto, { headers: { 'Content-Type': tipo } })
    await embutirDocumento(doc, String(url))
    const pronto = ehHtml ? doc.documentElement.outerHTML : new XMLSerializer().serializeToString(doc)
    return new Response(pronto, { headers: { 'Content-Type': tipo } })
  }

  async function liberar() {
    const urls = await Promise.all(blobs.values())
    urls.filter(Boolean).forEach((url) => URL.revokeObjectURL(url))
    blobs.clear()
  }

  return { buscar, paraBlob, embutirCss, embutirDocumento, liberar }
}
