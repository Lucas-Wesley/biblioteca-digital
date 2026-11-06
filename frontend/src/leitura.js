import { enfileirarPedido, lerDoServidor } from './dados.js'

// Estatísticas de leitura (R31): o leitor conta o tempo com a leitura ativa e as páginas lidas,
// por dia e por livro. Tudo fica primeiro no aparelho e sobe pela fila, como o progresso.
const CHAVE_LEITURA = 'biblioteca-leitura'
const CHAVE_DO_SERVIDOR = 'biblioteca-leitura-servidor'
const CHAVE_APARELHO = 'biblioteca-aparelho'

// Sem virar página nem tocar na tela por 5 minutos, o tempo para de contar.
export const PAUSA = 5 * 60 * 1000
// Uma página só conta depois de ficar na tela por 3 segundos: folhear não é ler.
export const TEMPO_NA_PAGINA = 3000
// Avançar até tantas posições de uma vez ainda é ler em sequência (uma tela do EPUB pode ter
// várias); mais que isso foi um salto, e o que ficou no meio não foi lido.
const SALTO_MAXIMO = 20
// Um tique pode chegar atrasado (o sistema congela a aba); o atraso não é leitura.
const TIQUE_MAXIMO = 5000
const SALVAR_A_CADA = 15000
const ENVIAR_A_CADA = 60000
const DIAS_COM_PAGINAS = 2

const DATA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })

// O dia da leitura, no horário de Brasília (AAAA-MM-DD).
export function diaDe(momento) {
  return DATA.format(momento)
}

function ler(chave, padrao) {
  try {
    return JSON.parse(localStorage.getItem(chave)) ?? padrao
  } catch {
    return padrao
  }
}

function gravar(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor))
  } catch (erro) {
    console.warn('Não foi possível guardar no aparelho', chave, erro)
  }
}

// Cada aparelho manda o total dele; o servidor soma os aparelhos.
export function aparelho() {
  let id = ler(CHAVE_APARELHO, null)
  if (!id) {
    id = crypto.randomUUID()
    gravar(CHAVE_APARELHO, id)
  }
  return id
}

const paginasDe = (registro) => (registro.unidades?.length ?? 0) * (registro.porUnidade ?? 1)

// Junta ao que está guardado o que este leitor contou desde a última vez. Somar, e não
// substituir, deixa duas abas abertas no mesmo livro sem apagar uma à outra.
function guardar(livroId, contado) {
  const tudo = ler(CHAVE_LEITURA, {})
  for (const [dia, novo] of Object.entries(contado)) {
    const registro = tudo[dia]?.[livroId] ?? { segundos: 0, paginas: 0, unidades: [] }
    const unidades = new Set([...(registro.unidades ?? []), ...novo.unidades])
    const atualizado = {
      segundos: registro.segundos + novo.ms / 1000,
      unidades: [...unidades],
      porUnidade: novo.porUnidade ?? registro.porUnidade ?? 1,
      totalDePaginas: novo.totalDePaginas ?? registro.totalDePaginas ?? 0,
    }
    atualizado.paginas = Math.max(registro.paginas, paginasDe(atualizado))
    tudo[dia] = { ...tudo[dia], [livroId]: atualizado }
  }
  // As páginas de dias passados já estão somadas; guardar quais foram só ocupa espaço.
  const recentes = Object.keys(tudo).sort().slice(-DIAS_COM_PAGINAS)
  for (const dia of Object.keys(tudo)) {
    if (recentes.includes(dia)) continue
    for (const registro of Object.values(tudo[dia])) delete registro.unidades
  }
  gravar(CHAVE_LEITURA, tudo)
  return tudo
}

function enviar(livroId, dias) {
  const tudo = ler(CHAVE_LEITURA, {})
  for (const dia of dias) {
    const registro = tudo[dia]?.[livroId]
    if (!registro) continue
    enfileirarPedido(`leitura:${dia}:${livroId}`, {
      url: `/api/books/${encodeURIComponent(livroId)}/reading/${dia}`,
      metodo: 'PUT',
      corpo: JSON.stringify({
        device: aparelho(),
        seconds: Math.round(registro.segundos),
        pages: Math.round(registro.paginas * 100) / 100,
        book_pages: Math.round(registro.totalDePaginas ?? 0),
      }),
    })
  }
}

// criarContador acompanha um livro aberto. O leitor chama tique() a cada segundo, mudou() quando
// a página muda, atividade() em qualquer toque ou tecla e visivel() quando o app some ou volta.
// unidade é a página no PDF e a posição do Readium no EPUB; porUnidade diz quantas páginas
// estimadas cada uma vale.
export function criarContador(livroId, { agora = () => Date.now() } = {}) {
  let contado = {}
  let ultimoTique = null
  let ultimaAtividade = agora()
  let naTela = document.visibilityState !== 'hidden'
  let pagina = null // { unidade, porUnidade, totalDePaginas }
  const tempoNaUnidade = new Map()
  const lidas = new Set()
  let ultimoSalvo = agora()
  let ultimoEnvio = agora()

  function doDia(dia) {
    contado[dia] ??= { ms: 0, unidades: new Set() }
    return contado[dia]
  }

  function marcar(unidade, momento) {
    lidas.add(unidade)
    const dia = doDia(diaDe(momento))
    dia.unidades.add(unidade)
    dia.porUnidade = pagina?.porUnidade
    dia.totalDePaginas = pagina?.totalDePaginas
  }

  function salvar(mandar = false) {
    const momento = agora()
    const dias = Object.keys(contado)
    if (dias.length) guardar(livroId, contado)
    contado = {}
    ultimoSalvo = momento
    if (mandar || momento - ultimoEnvio >= ENVIAR_A_CADA) {
      enviar(livroId, dias.length ? dias : [diaDe(momento)])
      ultimoEnvio = momento
    }
  }

  function tique() {
    const momento = agora()
    if (!naTela || momento - ultimaAtividade > PAUSA) {
      ultimoTique = null
      return
    }
    const passou = ultimoTique === null ? 0 : Math.min(Math.max(momento - ultimoTique, 0), TIQUE_MAXIMO)
    ultimoTique = momento
    if (passou) {
      const dia = doDia(diaDe(momento))
      dia.ms += passou
      dia.porUnidade ??= pagina?.porUnidade
      dia.totalDePaginas ??= pagina?.totalDePaginas
      if (pagina) {
        const tempo = (tempoNaUnidade.get(pagina.unidade) ?? 0) + passou
        tempoNaUnidade.set(pagina.unidade, tempo)
        if (tempo >= TEMPO_NA_PAGINA && !dia.unidades.has(pagina.unidade)) marcar(pagina.unidade, momento)
      }
    }
    if (momento - ultimoSalvo >= SALVAR_A_CADA) salvar()
  }

  function atividade() {
    ultimaAtividade = agora()
  }

  // porLeitura: a página mudou porque o Lucas virou, não por um salto, abertura ou ajuste.
  function mudou(nova, porLeitura = false) {
    atividade()
    const anterior = pagina
    pagina = nova
    if (!porLeitura || !anterior || !lidas.has(anterior.unidade)) return
    const salto = nova.unidade - anterior.unidade
    if (salto > 1 && salto <= SALTO_MAXIMO) {
      for (let u = anterior.unidade + 1; u < nova.unidade; u++) marcar(u, agora())
    }
  }

  function visivel(sim) {
    naTela = sim
    ultimoTique = null
    if (sim) atividade()
    else salvar(true)
  }

  function encerrar() {
    tique()
    salvar(true)
  }

  return { tique, mudou, atividade, visivel, encerrar }
}

// ---------- Para a tela de Estatísticas ----------

// Os registros deste aparelho que ainda estão só aqui, no formato do servidor.
function registrosLocais() {
  const meu = aparelho()
  return Object.entries(ler(CHAVE_LEITURA, {})).flatMap(([dia, livros]) =>
    Object.entries(livros).map(([livroId, r]) => ({
      device: meu,
      day: dia,
      book_id: livroId,
      seconds: Math.round(r.segundos),
      pages: r.paginas,
      book_pages: Math.round(r.totalDePaginas ?? 0),
    })),
  )
}

// juntarRegistros soma o que o servidor tem e o que este aparelho contou; do mesmo aparelho, vale
// o maior total, porque o aparelho pode estar à frente do servidor, mas nunca atrás.
export function juntarRegistros(doServidor, locais) {
  const mapa = new Map()
  for (const r of [...doServidor, ...locais]) {
    const chave = `${r.device}|${r.day}|${r.book_id}`
    const antes = mapa.get(chave)
    mapa.set(chave, antes
      ? { ...antes, seconds: Math.max(antes.seconds, r.seconds), pages: Math.max(antes.pages, r.pages), book_pages: r.book_pages || antes.book_pages }
      : r)
  }
  return [...mapa.values()]
}

export async function lerRegistros() {
  const resposta = await lerDoServidor('/api/reading', CHAVE_DO_SERVIDOR, [])
  return { registros: juntarRegistros(resposta.dados, registrosLocais()), semConexao: resposta.semConexao }
}
