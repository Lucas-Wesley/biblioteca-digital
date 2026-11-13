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

function guardarPlanos(planos) {
  try {
    localStorage.setItem(CHAVE_PLANOS, JSON.stringify(planos))
  } catch {
    // Sem espaço, a tela só não abre offline com a última versão.
  }
}

// marcarMeta muda na hora, no aparelho, e manda pela fila: funciona fora de casa.
export function marcarMeta(planos, plano, meta, estado) {
  meta.state = estado
  guardarPlanos(planos)
  enfileirarPedido(`meta-${plano.id}-${meta.id}`, {
    url: `/api/plans/${encodeURIComponent(plano.id)}/goals/${meta.id}`,
    metodo: 'PUT',
    corpo: JSON.stringify({ state: estado }),
  })
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

export const urlDaCapa = (plano) =>
  plano.has_cover ? `/api/plans/${encodeURIComponent(plano.id)}/cover` : plano.book_id ? `/api/books/${encodeURIComponent(plano.book_id)}/cover` : ''

// Os capítulos que servem de unidade do plano: o primeiro nível do sumário; se ele tem pouca
// coisa (um livro dividido em partes), entra o nível de baixo também.
export function capitulosParaPlano(sumario) {
  const primeiro = sumario.filter((c) => c.level <= 1)
  const lista = primeiro.length >= 3 ? primeiro : sumario.filter((c) => c.level <= 2)
  return lista.map((c) => ({ title: c.title, first_page: c.first_page, last_page: c.last_page }))
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

export function detalheDaMeta(plano, meta) {
  const n = meta.to - meta.from + 1
  if (plano.unit === 'paginas' || !plano.chapters?.[meta.from - 1]?.title) return n > 1 ? `${n} ${nomeDaUnidade(plano, n)}` : ''
  return meta.from === meta.to ? `Capítulo ${meta.from}` : `Capítulos ${meta.from} a ${meta.to}`
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
  const noPlano = plano.total - plano.first + 1
  let lidas = 0
  let atrasadas = 0
  for (const meta of plano.goals) {
    if (meta.state === 'lida') lidas += meta.to - meta.from + 1
    else if (meta.day < hoje) atrasadas++
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
export function previsao({ total, first, per_day: porDia, weekdays: semana, start_day: inicio }) {
  const unidades = total - first + 1
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
export function porDiaParaTerminar({ total, first, weekdays: semana, start_day: inicio }, fim) {
  const dias = diasDeLeitura(inicio, fim, semana)
  if (!dias) return null
  return Math.max(1, Math.ceil((total - first + 1) / dias))
}
