import { lerAnotacoes, lerProgresso } from './dados.js'

// Cada livro baixado é um cache próprio, consultado pelo service worker (sw.js).
const PREFIXO = 'livro-'
const DOWNLOADS_SIMULTANEOS = 4

const marcaDeCompleto = (id) => `/api/books/${encodeURIComponent(id)}/.baixado`

async function arquivosDoLivro(livro) {
  const base = `/api/books/${encodeURIComponent(livro.id)}`
  const urls = livro.has_cover ? [`${base}/cover`] : []
  if (livro.format === 'pdf') return [...urls, `${base}/file`]

  const urlManifesto = `${base}/publication/manifest.json`
  const resposta = await fetch(urlManifesto)
  if (!resposta.ok) throw new Error(`manifesto respondeu ${resposta.status}`)
  const manifesto = await resposta.json()
  const internos = [...manifesto.readingOrder, ...manifesto.resources, ...manifesto.links.filter((l) => l.rel !== 'self')]
  const absoluta = new URL(urlManifesto, location.href)
  return [
    ...urls,
    urlManifesto,
    ...new Set(internos.map((link) => {
      const url = new URL(link.href, absoluta)
      return url.pathname
    })),
  ]
}

export async function baixarLivro(livro, aoProgresso = () => {}) {
  // Pede ao Android para não apagar os livros quando faltar espaço; sem isso, ele pode.
  navigator.storage?.persist?.()
  const nome = `${PREFIXO}${livro.id}`
  try {
    const urls = await arquivosDoLivro(livro)
    const cache = await caches.open(nome)
    const restantes = [...urls]
    let feitos = 0
    aoProgresso(0)
    await Promise.all(Array.from({ length: DOWNLOADS_SIMULTANEOS }, async () => {
      while (restantes.length) {
        const url = restantes.shift()
        const resposta = await fetch(url)
        if (!resposta.ok) throw new Error(`${url} respondeu ${resposta.status}`)
        await cache.put(url, resposta)
        aoProgresso(++feitos / urls.length)
      }
    }))
    // Por último: um download interrompido nunca aparece como baixado.
    await cache.put(marcaDeCompleto(livro.id), new Response('1'))
  } catch (erro) {
    await caches.delete(nome)
    throw erro
  }
  // Deixa a posição e as marcações no aparelho, para a leitura seguir fora de casa.
  await Promise.all([lerProgresso(livro.id), lerAnotacoes(livro.id)])
}

export function removerDownload(id) {
  return caches.delete(`${PREFIXO}${id}`)
}

export async function estaBaixado(id) {
  if (!('caches' in window)) return false
  return Boolean(await caches.match(marcaDeCompleto(id), { cacheName: `${PREFIXO}${id}` }))
}

export async function livrosBaixados() {
  if (!('caches' in window)) return new Set()
  const nomes = (await caches.keys()).filter((nome) => nome.startsWith(PREFIXO))
  const ids = nomes.map((nome) => nome.slice(PREFIXO.length))
  const completos = await Promise.all(ids.map(estaBaixado))
  return new Set(ids.filter((_, i) => completos[i]))
}
