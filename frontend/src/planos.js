import { enfileirarPedido, lerDoServidor } from './dados.js'
import { somarDias } from './estatisticas.js'

// Planos de leitura (R35): metas por dia, por capítulos ou páginas. O servidor monta o cronograma;
// aqui ficam a leitura dos planos, as marcações (pela fila offline) e as contas da tela.
const CHAVE_PLANOS = 'biblioteca-planos'
export const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
export const NOMES_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

const comoData = (dia) => new Date(`${dia}T12:00:00Z`)
const formatoDia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
const formatoLongo = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })

const formatoComDia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
export const dataComDia = (dia) => formatoComDia.format(comoData(dia))
export const lidas = (plano) => (plano.unit === 'paginas' ? 'lidas' : 'lidos')
export const nomeDoDia = (dia) => formatoDia.format(comoData(dia)).replace(/\./g, '')
export const dataLonga = (dia) => formatoLongo.format(comoData(dia))
export const diaDaSemana = (dia) => comoData(dia).getUTCDay()

export async function lerPlanos() {
  const { dados, semConexao } = await lerDoServidor('/api/plans', CHAVE_PLANOS, [])
  return { planos: dados, semConexao }
}

export function guardarPlanos(planos) {
  try {
    localStorage.setItem(CHAVE_PLANOS, JSON.stringify(planos))
  } catch {
    // Sem espaço, a tela só não abre offline com a última versão.
  }
}

export function planosGuardados() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_PLANOS)) ?? []
  } catch {
    return []
  }
}

function enviarMarcacao(planoId, metaId, estado) {
  enfileirarPedido(`meta-${planoId}-${metaId}`, {
    url: `/api/plans/${encodeURIComponent(planoId)}/goals/${metaId}`,
    metodo: 'PUT',
    corpo: JSON.stringify({ state: estado }),
  })
}

// marcarMeta muda na hora, no aparelho, e manda pela fila: funciona fora de casa.
export function marcarMeta(planos, plano, meta, estado) {
  meta.state = estado
  guardarPlanos(planos)
  enviarMarcacao(plano.id, meta.id, estado)
}

// marcarDoLeitor: o leitor não tem a lista de planos aberta; muda a cópia do aparelho.
export function marcarDoLeitor(planoId, metaId, estado) {
  const planos = planosGuardados()
  const meta = planos.find((p) => p.id === planoId)?.goals.find((m) => m.id === metaId)
  if (meta) {
    meta.state = estado
    guardarPlanos(planos)
  }
  enviarMarcacao(planoId, metaId, estado)
}

async function pedirJSON(url, metodo, corpo) {
  let resposta
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    throw new Error('Sem conexão com a sua rede. Tente de novo em casa.')
  }
  if (resposta.status === 204) return null
  const dados = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(dados.error ?? `o servidor respondeu ${resposta.status}`)
  return dados
}

export const criarPlano = (dados) => pedirJSON('/api/plans', 'POST', dados)
export const ajustarPlano = (id, dados) => pedirJSON(`/api/plans/${encodeURIComponent(id)}`, 'PUT', dados)
export const apagarPlano = (id) => pedirJSON(`/api/plans/${encodeURIComponent(id)}`, 'DELETE')
export const reorganizar = (id, hoje) => pedirJSON(`/api/plans/${encodeURIComponent(id)}/replan`, 'POST', { today: hoje })
export const buscarNoCatalogo = (busca) => pedirJSON(`/api/catalogo?q=${encodeURIComponent(busca)}`, 'GET')
export const capitulosDoLivro = (id) => pedirJSON(`/api/books/${encodeURIComponent(id)}/chapters`, 'GET')

// lerSumarioPorFotos manda as fotos do sumário ao servidor, que pede ao Claude para ler (R36).
// Antes, cada foto é reduzida no aparelho: a do celular passa de 5 MB e o texto se lê bem com 2.000 px.
export async function lerSumarioPorFotos(fotos) {
  const formulario = new FormData()
  for (const foto of fotos) formulario.append('foto', await reduzirFoto(foto), 'sumario.jpg')
  let resposta
  try {
    resposta = await fetch('/api/sumario', { method: 'POST', body: formulario, signal: AbortSignal.timeout(5 * 60 * 1000) })
  } catch {
    throw new Error('Sem conexão com a sua rede, ou a leitura demorou demais. Tente de novo em casa.')
  }
  const dados = await resposta.json().catch(() => ({}))
  if (!resposta.ok) throw new Error(dados.error ?? `o servidor respondeu ${resposta.status}`)
  return dados
}

// O servidor aceita até 8 fotos por leitura (cada uma abre um Claude); mais que isso vai em lotes,
// um depois do outro, e os capítulos de todos se juntam (R37).
export const FOTOS_POR_LOTE = 8

// aoLote recebe os capítulos de cada lote assim que chegam: se um lote falhar, os de antes ficam.
export async function lerSumarioEmLotes(fotos, { aoAvancar = () => {}, aoLote = () => {} } = {}) {
  for (let i = 0; i < fotos.length; i += FOTOS_POR_LOTE) {
    const lote = fotos.slice(i, i + FOTOS_POR_LOTE)
    aoAvancar({ de: i + 1, ate: i + lote.length, total: fotos.length })
    const { chapters, note } = await lerSumarioPorFotos(lote)
    aoLote(chapters ?? [], note ?? '')
  }
}

const LADO_MAXIMO = 2000

export async function reduzirFoto(foto) {
  try {
    const bitmap = await createImageBitmap(foto)
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height))
    const tela = document.createElement('canvas')
    tela.width = Math.round(bitmap.width * escala)
    tela.height = Math.round(bitmap.height * escala)
    tela.getContext('2d').drawImage(bitmap, 0, 0, tela.width, tela.height)
    bitmap.close?.()
    return await new Promise((ok, falha) => tela.toBlob((b) => (b ? ok(b) : falha(new Error('foto'))), 'image/jpeg', 0.85))
  } catch {
    // Sem como reduzir (formato que o navegador não abre), vai como está; o servidor avisa se não servir.
    return foto
  }
}

export const urlDaCapa = (plano) =>
  plano.has_cover ? `/api/plans/${encodeURIComponent(plano.id)}/cover` : plano.book_id ? `/api/books/${encodeURIComponent(plano.book_id)}/cover` : ''

// Os capítulos que servem de unidade do plano: o primeiro nível do sumário; se ele tem pouca
// coisa (um livro dividido em partes), entra o nível de baixo também. O que não é leitura (notas,
// índice, agradecimentos…) já vem fora do plano (R41).
export function capitulosParaPlano(sumario) {
  const primeiro = sumario.filter((c) => c.level <= 1)
  const lista = primeiro.length >= 3 ? primeiro : sumario.filter((c) => c.level <= 2)
  return sugerirForaDoPlano(lista.map((c) => ({ title: c.title, first_page: c.first_page, last_page: c.last_page, anchor: c.anchor })))
}

// ---------- Capítulos fora do plano (R41) ----------

// Partes do livro que não são leitura: o título tem de ser só isso ("Notas", "Índice remissivo"),
// sem mais nada; "Capítulo 3: Notas de um viajante" é capítulo. Prefácio, introdução, epílogo,
// posfácio, glossário e apêndice ficam no plano: muita gente lê.
const FORA_DO_PLANO = {
  notas: ['notas', 'notas finais', 'notas e referencias', 'notas de fim', 'notes', 'endnotes', 'end notes', 'notas al final'],
  bibliografia: [
    'referencias', 'referencias bibliograficas', 'bibliografia', 'bibliografia selecionada', 'bibliografia seleccionada',
    'obras citadas', 'fontes', 'fontes e bibliografia', 'references', 'bibliography', 'selected bibliography', 'works cited',
    'further reading', 'sources', 'leituras recomendadas', 'sugestoes de leitura', 'para saber mais',
  ],
  'índice': [
    'indice', 'indice remissivo', 'indice onomastico', 'indice analitico', 'indice de nomes', 'indice de assuntos', 'indice geral',
    'index', 'general index', 'indice alfabetico', 'indice tematico',
  ],
  'sumário': ['sumario', 'conteudo', 'contents', 'table of contents', 'contenido', 'contenidos', 'tabla de contenido'],
  agradecimentos: ['agradecimentos', 'agradecimento', 'acknowledgments', 'acknowledgements', 'agradecimientos'],
  'sobre o autor': [
    'sobre o autor', 'sobre a autora', 'sobre os autores', 'sobre as autoras', 'o autor', 'a autora', 'about the author',
    'about the authors', 'sobre el autor', 'sobre la autora', 'acerca del autor', 'acerca de la autora', 'el autor', 'la autora',
    'sobre o tradutor', 'sobre a tradutora', 'about the translator',
  ],
  'créditos': [
    'creditos', 'copyright', 'direitos autorais', 'ficha catalografica', 'ficha tecnica', 'dados internacionais de catalogacao na publicacao',
    'credits', 'copyright page', 'pagina de creditos', 'creditos das imagens', 'creditos das ilustracoes', 'creditos das fotos',
    'creditos fotograficos', 'image credits', 'photo credits', 'expediente', 'colofao', 'colophon', 'colofon',
  ],
  'dedicatória': ['dedicatoria', 'dedication', 'epigrafe', 'epigraph'],
  capa: [
    'capa', 'contracapa', 'quarta capa', 'orelha', 'orelhas', 'folha de rosto', 'rosto', 'pagina de rosto', 'pagina de titulo',
    'cover', 'back cover', 'title page', 'half title', 'portada', 'portadilla', 'contraportada', 'pagina de titulo',
  ],
  'outras obras': [
    'outras obras', 'outras obras do autor', 'outras obras da autora', 'outros livros', 'outros livros do autor', 'outros titulos',
    'do mesmo autor', 'da mesma autora', 'obras do autor', 'obras da autora', 'other books', 'other books by the author',
    'also by the author', 'otras obras', 'otros libros', 'del mismo autor', 'conheca tambem', 'leia tambem', 'veja tambem',
  ],
  listas: [
    'lista de ilustracoes', 'lista de figuras', 'lista de tabelas', 'lista de abreviaturas', 'lista de siglas', 'lista de abreviaturas e siglas',
    'list of illustrations', 'list of figures', 'list of tables', 'list of abbreviations', 'abreviaturas', 'abbreviations', 'siglas',
  ],
}
// Começos de título que bastam: "Também de Machado de Assis", "Also by Ursula K. Le Guin".
const COMECOS_FORA = { 'outras obras': ['tambem de ', 'tambem por ', 'also by ', 'other books by ', 'more by ', 'otros libros de ', 'tambien de ', 'outras obras de ', 'outros livros de ', 'obras de '] }
// Notas do autor ou do tradutor: no começo do livro costumam ser leitura (uma apresentação); só
// ficam fora do plano na segunda metade do sumário.
const NOTAS_NO_FIM = [
  'nota do autor', 'notas do autor', 'nota da autora', 'notas da autora', 'nota do tradutor', 'notas do tradutor', 'nota da tradutora',
  'notas da tradutora', 'notas da traducao', 'notas do editor', 'nota do editor', 'notas da edicao', "author's note", 'authors note',
  "translator's note", 'translators notes', "translator's notes", 'notas del autor', 'notas del traductor', 'nota del traductor',
]
const PARTE_POR_TITULO = new Map(Object.entries(FORA_DO_PLANO).flatMap(([parte, titulos]) => titulos.map((t) => [t, parte])))

// O título sem número na frente ("12. Notas", "XII - Índice"), sem pontuação e sem acento.
function tituloEssencial(titulo) {
  return normal(titulo)
    .replace(/[’`]/g, "'")
    .replace(/^(?:\d+|[ivxlcdm]+)\s*[.:)\-–—]\s*/, '')
    .replace(/^\d+\s+/, '')
    .replace(/[\s.:;,·\-–—*"“”]+$/g, '')
    .replace(/^[\s"“”*]+/, '')
    .trim()
}

// parteForaDoPlano: o nome da parte ("notas", "índice"…) quando o título é de algo que não é
// leitura; '' quando é capítulo. posicao e total (base 0) dizem se o item está no fim do sumário.
export function parteForaDoPlano(titulo, posicao = 0, total = 1) {
  const t = tituloEssencial(titulo)
  if (!t) return ''
  const parte = PARTE_POR_TITULO.get(t)
  if (parte) return parte
  for (const [nome, comecos] of Object.entries(COMECOS_FORA)) if (comecos.some((c) => t.startsWith(c))) return nome
  if (NOTAS_NO_FIM.includes(t) && total > 1 && posicao >= total / 2) return 'notas'
  return ''
}

// sugerirForaDoPlano marca como fora do plano o que não é leitura, nos capítulos ainda sem
// escolha (skip indefinido); o que o Lucas já marcou ou desmarcou fica como está.
export function sugerirForaDoPlano(lista, novos = null) {
  return lista.map((c, i) => {
    if (novos ? !novos.has(c) : c.skip !== undefined) return c
    return { ...c, skip: Boolean(parteForaDoPlano(c.title, i, lista.length)) }
  })
}

const dentro = (c) => !c?.skip

// unidadesNoPlano: quantos capítulos (ou páginas) entram no plano, do começo até o fim.
export function unidadesNoPlano({ unit, total, first, chapters }) {
  const inicio = Number(first) || 1
  if (unit !== 'capitulos' || !chapters?.length) return Math.max(0, total - inicio + 1)
  let n = 0
  for (let u = inicio; u <= total; u++) if (dentro(chapters[u - 1])) n++
  return n
}

// Os números (base 1) dos capítulos que ficaram fora do plano.
export function capitulosFora(plano) {
  if (plano.unit !== 'capitulos') return new Set()
  return new Set((plano.chapters ?? []).flatMap((c, i) => (c.skip ? [i + 1] : [])))
}

export function nomeDaUnidade(plano, n) {
  if (plano.unit === 'paginas') return n === 1 ? 'página' : 'páginas'
  return n === 1 ? 'capítulo' : 'capítulos'
}

// O texto da meta: "Capítulo 5", "Capítulos 5 a 6", "Páginas 40 a 49", ou os nomes do sumário.
export function rotuloDaMeta(plano, meta) {
  if (plano.unit === 'paginas') return meta.from === meta.to ? `Página ${meta.from}` : `Páginas ${meta.from} a ${meta.to}`
  const nome = (n) => plano.chapters?.[n - 1]?.title
  if (nome(meta.from)) return meta.from === meta.to ? nome(meta.from) : `${nome(meta.from)} → ${nome(meta.to)}`
  return meta.from === meta.to ? `Capítulo ${meta.from}` : `Capítulos ${meta.from} a ${meta.to}`
}

// Os capítulos que caem nas páginas da meta, quando o sumário tem as páginas.
export function capitulosDasPaginas(plano, meta) {
  return (plano.chapters ?? []).filter((c, i, lista) => {
    if (!c.first_page) return false
    const fim = c.last_page || (lista[i + 1]?.first_page ? lista[i + 1].first_page - 1 : Infinity)
    return c.first_page <= meta.to && fim >= meta.from
  })
}

export function detalheDaMeta(plano, meta) {
  const n = meta.to - meta.from + 1
  if (plano.unit === 'paginas') {
    const caps = capitulosDasPaginas(plano, meta)
    const quantas = n > 1 ? `${n} páginas` : ''
    if (!caps.length) return quantas
    const nomes = caps.length > 2 ? `${caps[0].title} … ${caps.at(-1).title}` : caps.map((c) => c.title).join(', ')
    return [quantas, nomes].filter(Boolean).join(' · ')
  }
  if (!plano.chapters?.[meta.from - 1]?.title) return n > 1 ? `${n} capítulos` : ''
  return meta.from === meta.to ? `Capítulo ${meta.from}` : `Capítulos ${meta.from} a ${meta.to}`
}

// A meta para ler agora: a primeira ainda não lida, na ordem do livro (as atrasadas vêm antes).
export function metaParaLer(plano) {
  return plano.goals.find((m) => m.state !== 'lida') ?? null
}

// Até onde vai a meta, em fração do livro, pelas páginas do sumário; null sem como saber.
export function fimDaMeta(plano, meta) {
  if (plano.unit === 'paginas') return plano.total ? meta.to / plano.total : null
  const paginas = Math.max(0, ...(plano.chapters ?? []).map((c) => c.last_page || c.first_page || 0))
  const ultima = plano.chapters?.[meta.to - 1]
  const fim = ultima?.last_page || (plano.chapters?.[meta.to]?.first_page ?? 0) - 1
  return paginas && fim > 0 ? Math.min(fim / paginas, 1) : null
}

// estadoDoPlano: a frase da listagem. No livro digital, se o leitor já passou de uma meta que
// ficou sem marcar, o mais provável é que ela foi lida e falta marcar.
export function estadoDoPlano(plano, hoje) {
  const r = resumo(plano, hoje)
  if (r.concluido) return { tipo: 'concluido', texto: 'Livro concluído' }
  const atrasadas = plano.goals.filter((m) => m.state !== 'lida' && m.day < hoje)
  if (atrasadas.length) {
    const ultima = atrasadas.at(-1)
    const fim = plano.book_id ? fimDaMeta(plano, ultima) : null
    if (fim !== null && plano.percent >= fim - 0.005) {
      return { tipo: 'falta-marcar', texto: `Pelo leitor você já passou ${atrasadas.length === 1 ? 'da meta atrasada' : `das ${atrasadas.length} metas atrasadas`}: falta marcar` }
    }
    const naoLidas = atrasadas.filter((m) => m.state === 'nao-lida').length
    const semMarcar = atrasadas.length - naoLidas
    const partes = []
    if (semMarcar) partes.push(semMarcar === 1 ? '1 meta sem marcar' : `${semMarcar} metas sem marcar`)
    if (naoLidas) partes.push(naoLidas === 1 ? '1 não lida' : `${naoLidas} não lidas`)
    return { tipo: 'atrasado', texto: `Atrasado: ${partes.join(' e ')}` }
  }
  if (r.hoje.length && r.hoje.every((m) => m.state === 'lida')) return { tipo: 'feito', texto: 'Meta de hoje feita' }
  if (r.hoje.length) return { tipo: 'hoje', texto: 'Em dia · a meta de hoje está esperando' }
  if (plano.goals[0]?.day > hoje) return { tipo: 'em-dia', texto: `Começa ${nomeDoDia(plano.goals[0].day)}` }
  return { tipo: 'em-dia', texto: 'Em dia · hoje é folga' }
}

const normal = (texto) => (texto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()

// O começo e o fim da meta no livro digital, no formato das marcações, para o leitor abrir ali e
// saber até onde ir. O fim é o começo do que vem depois ('' quando a meta vai até o fim do livro).
export async function ancorasDaMeta(plano, meta) {
  const livro = encodeURIComponent(plano.book_id)
  if (plano.unit === 'paginas') {
    const ancora = (pagina) =>
      pedirJSON(`/api/books/${livro}/anchor?page=${pagina}`, 'GET').then((d) => d.anchor).catch(() => '')
    const [inicio, fim] = await Promise.all([ancora(meta.from), meta.to < plano.total ? ancora(meta.to + 1) : ''])
    return { inicio, fim }
  }
  let caps = plano.chapters ?? []
  if (!caps[meta.from - 1]?.anchor) {
    // Plano criado antes das âncoras: acha os capítulos do livro pelo título.
    const sumario = await capitulosDoLivro(plano.book_id).catch(() => null)
    const porTitulo = new Map((sumario?.chapters ?? []).map((c) => [normal(c.title), c.anchor]))
    caps = caps.map((c) => ({ ...c, anchor: c.anchor || porTitulo.get(normal(c.title)) || '' }))
  }
  return { inicio: caps[meta.from - 1]?.anchor ?? '', fim: caps[meta.to]?.anchor ?? '' }
}

// metaDoLivro: a meta para ler de um livro da biblioteca, pela cópia dos planos no aparelho. Com
// mais de um plano para o livro, vale o do play (planoId); sem ele, o primeiro com meta a ler.
export function metaDoLivro(livroId, planoId = '') {
  const planos = planosGuardados()
  planos.sort((a, b) => (b.id === planoId) - (a.id === planoId))
  for (const plano of planos) {
    if (plano.book_id !== livroId) continue
    const meta = metaParaLer(plano)
    if (meta) return { plano, meta }
  }
  return null
}

// Os itens do sumário do leitor que são da meta: por título (capítulos) ou pela página (PDF).
export function itemNaMeta(plano, meta, item, ehPdf) {
  if (plano.unit === 'capitulos') {
    const titulos = plano.chapters.slice(meta.from - 1, meta.to).filter(dentro).map((c) => normal(c.title))
    if (titulos.includes(normal(item.rotulo))) return true
    if (!ehPdf) return false
    const primeira = plano.chapters[meta.from - 1]?.first_page
    const ultima = plano.chapters[meta.to - 1]?.last_page || plano.chapters[meta.to - 1]?.first_page
    return Boolean(primeira && ultima && item.destino >= primeira && item.destino <= ultima)
  }
  return ehPdf && item.destino >= meta.from && item.destino <= meta.to
}

// O estado na tela: lida, não lida, atrasada (passou e não foi marcada), hoje ou a fazer.
export function situacao(meta, hoje) {
  if (meta.state === 'lida') return 'lida'
  if (meta.state === 'nao-lida') return 'nao-lida'
  if (meta.day < hoje) return 'atrasada'
  if (meta.day === hoje) return 'hoje'
  return 'futura'
}

export function resumo(plano, hoje) {
  // Os capítulos fora do plano (R41) não contam, nem quando já tinham sido lidos.
  const fora = capitulosFora(plano)
  const noPlano = unidadesNoPlano(plano)
  let lidas = 0
  let atrasadas = 0
  for (const meta of plano.goals) {
    if (meta.state === 'lida') {
      for (let u = meta.from; u <= meta.to; u++) if (!fora.has(u)) lidas++
    } else if (meta.day < hoje) atrasadas++
  }
  const pendentes = plano.goals.filter((m) => m.state !== 'lida')
  const fim = plano.goals.at(-1)?.day ?? plano.start_day
  return {
    lidas,
    noPlano,
    fracao: noPlano ? lidas / noPlano : 0,
    atrasadas,
    fim,
    concluido: lidas >= noPlano,
    proxima: pendentes.find((m) => m.day >= hoje) ?? pendentes[0] ?? null,
    hoje: plano.goals.filter((m) => m.day === hoje),
  }
}

// diasDeLeitura: os dias permitidos de inicio até fim, inclusive.
export function diasDeLeitura(inicio, fim, semana) {
  let n = 0
  for (let dia = inicio; dia <= fim; dia = somarDias(dia, 1)) {
    if (semana.includes(String(diaDaSemana(dia)))) n++
  }
  return n
}

// previsao faz a mesma conta do servidor para mostrar enquanto o Lucas ajusta: quantos dias de
// leitura e quando termina.
export function previsao({ unit, total, first, chapters, per_day: porDia, weekdays: semana, start_day: inicio }) {
  const unidades = unidadesNoPlano({ unit, total, first, chapters })
  if (!(unidades > 0) || !(porDia > 0) || !semana || !inicio) return null
  const dias = Math.ceil(unidades / porDia)
  let dia = inicio
  let contados = 0
  for (let guarda = 0; guarda < 20000; guarda++) {
    if (semana.includes(String(diaDaSemana(dia)))) {
      contados++
      if (contados === dias) return { dias, fim: dia }
    }
    dia = somarDias(dia, 1)
  }
  return null
}

// porDiaParaTerminar: o ritmo que fecha o livro até a data escolhida.
export function porDiaParaTerminar({ unit, total, first, chapters, weekdays: semana, start_day: inicio }, fim) {
  const dias = diasDeLeitura(inicio, fim, semana)
  if (!dias) return null
  return Math.max(1, Math.ceil(unidadesNoPlano({ unit, total, first, chapters }) / dias))
}

// ---------- Tempo estimado de leitura (R37) ----------

// Sem histórico, a média de um adulto lendo em silêncio: perto de 250 palavras por minuto, e uma
// página de livro tem umas 300 a 350; com folga, 1,5 minuto por página (40 páginas por hora).
export const MINUTOS_POR_PAGINA = 1.5
// O ritmo próprio só vale depois de 30 minutos e 10 páginas registrados nas Estatísticas (R31).
const MINIMO_PARA_RITMO = 30 * 60

// ritmoDeLeitura: minutos por página, do próprio livro, senão de todas as leituras, senão a média.
export function ritmoDeLeitura(registros, livroId) {
  const doLivro = livroId ? registros.filter((r) => r.book_id === livroId) : []
  for (const [lista, fonte] of [[doLivro, 'livro'], [registros, 'geral']]) {
    const segundos = lista.reduce((n, r) => n + r.seconds, 0)
    const paginas = lista.reduce((n, r) => n + r.pages, 0)
    if (segundos >= MINIMO_PARA_RITMO && paginas >= 10) {
      return { minutos: Math.min(5, Math.max(0.3, segundos / 60 / paginas)), fonte }
    }
  }
  return { minutos: MINUTOS_POR_PAGINA, fonte: 'media' }
}

// Quantas páginas tem cada capítulo, pelo sumário; o que não dá para saber fica com a média dos outros.
function paginasDosCapitulos(capitulos) {
  const conhecidas = capitulos.map((c, i) => {
    const inicio = Number(c.first_page) || 0
    const proximo = Number(capitulos[i + 1]?.first_page) || 0
    const fim = Number(c.last_page) || (proximo > inicio ? proximo - 1 : 0)
    return inicio && fim >= inicio ? fim - inicio + 1 : null
  })
  const validas = conhecidas.filter((n) => n)
  if (!validas.length) return null
  const media = validas.reduce((a, b) => a + b, 0) / validas.length
  return conhecidas.map((n) => n ?? media)
}

// paginasDaMeta: quantas páginas a meta tem; null quando o sumário não diz as páginas.
export function paginasDaMeta(plano, meta) {
  if (plano.unit === 'paginas') return meta.to - meta.from + 1
  const porCapitulo = paginasDosCapitulos(plano.chapters ?? [])
  if (!porCapitulo) return null
  let soma = 0
  for (let i = meta.from; i <= meta.to; i++) {
    if (plano.chapters?.[i - 1]?.skip) continue
    soma += porCapitulo[i - 1] ?? porCapitulo.reduce((a, b) => a + b, 0) / porCapitulo.length
  }
  return soma
}

// paginasPorDia: a média de páginas de um dia de leitura, para a prévia do formulário.
export function paginasPorDia(plano) {
  if (!plano.per_day) return null
  if (plano.unit === 'paginas') return plano.per_day
  const porCapitulo = paginasDosCapitulos(plano.chapters ?? [])
  if (!porCapitulo) return null
  // A média só dos capítulos que entram no plano (R41): notas e índice não pesam no dia.
  const noPlano = porCapitulo.filter((_, i) => dentro(plano.chapters[i]))
  const lista = noPlano.length ? noPlano : porCapitulo
  return (lista.reduce((a, b) => a + b, 0) / lista.length) * plano.per_day
}

// tempoDeLeitura: "≈ 25 min", arredondado para não fingir precisão.
export function tempoDeLeitura(paginas, ritmo) {
  if (!paginas || !ritmo) return ''
  const minutos = paginas * ritmo.minutos
  if (minutos < 5) return '≈ 5 min'
  const arredondado = minutos < 60 ? Math.round(minutos / 5) * 5 : Math.round(minutos / 10) * 10
  if (arredondado < 60) return `≈ ${arredondado} min`
  const h = Math.floor(arredondado / 60)
  const m = arredondado % 60
  return m ? `≈ ${h}h${String(m).padStart(2, '0')}` : `≈ ${h}h`
}

export const tempoDaMeta = (plano, meta, ritmo) => tempoDeLeitura(paginasDaMeta(plano, meta), ritmo)

// De onde vem o ritmo, para a prévia explicar a conta.
export function origemDoRitmo(ritmo) {
  const porPagina = `${ritmo.minutos.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min por página`
  if (ritmo.fonte === 'livro') return `no seu ritmo neste livro (${porPagina})`
  if (ritmo.fonte === 'geral') return `no seu ritmo nas Estatísticas (${porPagina})`
  return `pela média de um adulto (${porPagina}); com 30 minutos de leitura no app, passa a usar o seu ritmo`
}

// ---------- Sumário em partes (R37) ----------

// juntarSumario soma os capítulos de uma nova leitura aos que já estão na lista, sem repetir: o
// Lucas pode fotografar o sumário em partes. Com todas as páginas conhecidas, a lista fica na
// ordem das páginas; senão, o novo vai para o fim.
export function juntarSumario(atual, novos) {
  const chave = (c) => `${normal(c.title)}|${Number(c.first_page) || ''}`
  const vistos = new Set(atual.filter((c) => c.title?.trim()).map(chave))
  const lista = [...atual]
  const somados = new Set()
  for (const c of novos) {
    if (vistos.has(chave(c))) continue
    vistos.add(chave(c))
    const novo = { ...c }
    somados.add(novo)
    lista.push(novo)
  }
  // Os que acabaram de chegar ganham a sugestão do que fica fora do plano (R41), já na ordem final.
  if (lista.every((c) => Number(c.first_page) > 0)) {
    const ordenada = lista.map((c, i) => ({ c, i })).sort((a, b) => a.c.first_page - b.c.first_page || a.i - b.i).map(({ c }) => c)
    return sugerirForaDoPlano(ordenada, somados)
  }
  return sugerirForaDoPlano(lista, somados)
}
