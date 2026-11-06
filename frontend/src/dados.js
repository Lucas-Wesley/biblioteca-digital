// Tudo que o leitor muda fica primeiro no aparelho e vai para o servidor quando houver rede.
// Fora de casa o servidor não responde (o app é só da rede local), e a leitura não pode parar.
const CHAVE_FILA = 'biblioteca-fila'
const CHAVE_PROGRESSO = 'biblioteca-progresso'
const CHAVE_LIVROS = 'biblioteca-livros'
const PREFIXO_ANOTACOES = 'biblioteca-anotacoes-'

// Em outra rede, o pedido ao IP de casa pode ficar pendurado até o sistema desistir.
const TEMPO_LIMITE = 4000
// Depois de uma falha, nem tenta por um tempo: abrir um livro fora de casa não pode esperar a rede.
const PAUSA_SEM_REDE = 30000

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

let ultimaFalhaDeRede = 0

async function pedir(url, opcoes = {}) {
  if (Date.now() - ultimaFalhaDeRede < PAUSA_SEM_REDE) throw new Error('sem rede')
  try {
    return await fetch(url, { ...opcoes, signal: AbortSignal.timeout(TEMPO_LIMITE) })
  } catch (erro) {
    ultimaFalhaDeRede = Date.now()
    throw erro
  }
}

// O aparelho avisou que a rede mudou, ou o app voltou para a frente: vale tentar de novo.
export function tentarRedeDeNovo() {
  ultimaFalhaDeRede = 0
}

function urlDoLivro(id) {
  return `/api/books/${encodeURIComponent(id)}`
}

// A chave faz a mudança nova substituir a antiga do mesmo item, em vez de enviar as duas.
function enfileirar(chave, pedido) {
  const fila = ler(CHAVE_FILA, {})
  fila[chave] = pedido
  gravar(CHAVE_FILA, fila)
  sincronizar()
}

// Para os outros módulos (as estatísticas de leitura) usarem a mesma fila.
export const enfileirarPedido = enfileirar

function tirarDaFila(chave, pedido) {
  const fila = ler(CHAVE_FILA, {})
  if (fila[chave]?.corpo !== pedido.corpo || fila[chave]?.metodo !== pedido.metodo) return
  delete fila[chave]
  gravar(CHAVE_FILA, fila)
}

async function esvaziarFila() {
  for (const [chave, pedido] of Object.entries(ler(CHAVE_FILA, {}))) {
    const resposta = await pedir(pedido.url, {
      method: pedido.metodo,
      headers: pedido.corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: pedido.corpo,
      // Garante o envio mesmo com a aba fechando.
      keepalive: true,
    })
    if (resposta.status >= 500) throw new Error(`servidor respondeu ${resposta.status}`)
    // Um 4xx nunca vai passar, como o de um livro que saiu do catálogo.
    tirarDaFila(chave, pedido)
  }
}

let envio = null
let houveMudanca = false

export function sincronizar() {
  if (envio) {
    houveMudanca = true
    return envio
  }
  houveMudanca = false
  envio = esvaziarFila()
    .catch(() => {
      // Sem rede: tudo continua na fila até a próxima tentativa.
      houveMudanca = false
    })
    .finally(() => {
      envio = null
      if (houveMudanca) sincronizar()
    })
  return envio
}

// lerDoServidor traz uma lista do servidor e guarda uma cópia; sem rede, vale a cópia.
export async function lerDoServidor(url, chave, padrao) {
  await sincronizar()
  try {
    const resposta = await pedir(url)
    if (!resposta.ok) throw new Error(`servidor respondeu ${resposta.status}`)
    const dados = await resposta.json()
    gravar(chave, dados)
    return { dados, semConexao: false }
  } catch {
    return { dados: ler(chave, padrao), semConexao: true }
  }
}

export function haPendencias() {
  return Object.keys(ler(CHAVE_FILA, {})).length > 0
}

function maisRecente(a, b) {
  if (!a?.position) return b
  if (!b?.position) return a
  return new Date(a.updated_at) > new Date(b.updated_at) ? a : b
}

export async function lerProgresso(id) {
  const locais = ler(CHAVE_PROGRESSO, {})
  await sincronizar()
  let doServidor = null
  try {
    const resposta = await pedir(`${urlDoLivro(id)}/progress`)
    if (resposta.ok) doServidor = await resposta.json()
  } catch {
    // Sem rede, vale o que está no aparelho.
  }
  const progresso = maisRecente(locais[id], doServidor) ?? {}
  if (progresso.position) gravar(CHAVE_PROGRESSO, { ...ler(CHAVE_PROGRESSO, {}), [id]: progresso })
  return progresso
}

export function salvarProgresso(id, position, percent) {
  const progresso = { position, percent, updated_at: new Date().toISOString() }
  gravar(CHAVE_PROGRESSO, { ...ler(CHAVE_PROGRESSO, {}), [id]: progresso })
  enfileirar(`progresso:${id}`, { url: `${urlDoLivro(id)}/progress`, metodo: 'PUT', corpo: JSON.stringify(progresso) })
}

function anotacoesPendentes(id) {
  const fila = ler(CHAVE_FILA, {})
  const prefixo = `anotacao:${id}:`
  return Object.keys(fila)
    .filter((chave) => chave.startsWith(prefixo))
    .map((chave) => ({ id: chave.slice(prefixo.length), corpo: fila[chave].corpo }))
}

function ordenarAnotacoes(lista) {
  return [...lista].sort((a, b) => a.percent - b.percent || a.created_at.localeCompare(b.created_at))
}

export async function lerAnotacoes(id) {
  await sincronizar()
  const chave = `${PREFIXO_ANOTACOES}${id}`
  try {
    const resposta = await pedir(`${urlDoLivro(id)}/annotations`)
    if (!resposta.ok) return ler(chave, [])
    // O que ainda não subiu continua valendo sobre a resposta do servidor.
    const mapa = new Map((await resposta.json()).map((a) => [a.id, a]))
    for (const { id: pendente, corpo } of anotacoesPendentes(id)) {
      if (corpo) mapa.set(pendente, JSON.parse(corpo))
      else mapa.delete(pendente)
    }
    const lista = ordenarAnotacoes([...mapa.values()])
    gravar(chave, lista)
    return lista
  } catch {
    return ler(chave, [])
  }
}

export function salvarAnotacao(livroId, anotacao) {
  const agora = new Date().toISOString()
  const completa = { created_at: agora, ...anotacao, updated_at: agora }
  const chave = `${PREFIXO_ANOTACOES}${livroId}`
  gravar(chave, ordenarAnotacoes([...ler(chave, []).filter((a) => a.id !== completa.id), completa]))
  enfileirar(`anotacao:${livroId}:${completa.id}`, {
    url: `${urlDoLivro(livroId)}/annotations/${encodeURIComponent(completa.id)}`,
    metodo: 'PUT',
    corpo: JSON.stringify(completa),
  })
  return completa
}

export function apagarAnotacao(livroId, anotacaoId) {
  const chave = `${PREFIXO_ANOTACOES}${livroId}`
  gravar(chave, ler(chave, []).filter((a) => a.id !== anotacaoId))
  enfileirar(`anotacao:${livroId}:${anotacaoId}`, {
    url: `${urlDoLivro(livroId)}/annotations/${encodeURIComponent(anotacaoId)}`,
    metodo: 'DELETE',
    corpo: '',
  })
}

// O progresso feito no aparelho e ainda não enviado aparece nas capas.
function comProgressoLocal(livros) {
  const locais = ler(CHAVE_PROGRESSO, {})
  return livros.map((livro) => {
    const local = locais[livro.id]
    const maisNovo = local && (!livro.read_at || new Date(local.updated_at) > new Date(livro.read_at))
    return maisNovo ? { ...livro, percent: local.percent, read_at: local.updated_at } : livro
  })
}

// sem rede, devolve a última lista vista, para o Início abrir mesmo fora de casa.
export async function carregarLivros() {
  try {
    await sincronizar()
    const resposta = await pedir('/api/books')
    if (!resposta.ok) throw new Error(`servidor respondeu ${resposta.status}`)
    const livros = await resposta.json()
    gravar(CHAVE_LIVROS, livros)
    return { livros: comProgressoLocal(livros), semConexao: false }
  } catch {
    return { livros: comProgressoLocal(ler(CHAVE_LIVROS, [])), semConexao: true }
  }
}

export function livrosGuardados() {
  return comProgressoLocal(ler(CHAVE_LIVROS, []))
}

export function guardarLivros(livros) {
  gravar(CHAVE_LIVROS, livros)
}

// Sugestões de melhoria do app (Ajustes). Vão pela mesma fila: escritas fora de casa, sobem depois.
const PREFIXO_SUGESTAO = 'sugestao:'
const CHAVE_SUGESTOES = 'biblioteca-sugestoes'

function sugestoesNaFila() {
  return Object.entries(ler(CHAVE_FILA, {}))
    .filter(([chave, pedido]) => chave.startsWith(PREFIXO_SUGESTAO) && pedido.metodo === 'PUT')
    .map(([chave, pedido]) => ({ ...JSON.parse(pedido.corpo), id: chave.slice(PREFIXO_SUGESTAO.length), estado: 'pendente' }))
}

export function enviarSugestao(texto, tela) {
  const id = crypto.randomUUID()
  const criada_em = new Date().toISOString()
  enfileirar(`${PREFIXO_SUGESTAO}${id}`, {
    url: `/api/sugestoes/${id}`,
    metodo: 'PUT',
    corpo: JSON.stringify({ texto: texto.trim(), tela, criada_em }),
  })
  return id
}

// As que ainda não subiram vêm primeiro; sem rede, vale a última lista vista.
export async function lerSugestoes() {
  await sincronizar()
  let lista = ler(CHAVE_SUGESTOES, [])
  let semConexao = true
  try {
    const resposta = await pedir('/api/sugestoes')
    if (resposta.ok) {
      lista = await resposta.json()
      gravar(CHAVE_SUGESTOES, lista)
      semConexao = false
    }
  } catch {
    // Sem rede: fica a lista guardada.
  }
  // Com algo na fila, vale a fila: a nova ainda não subiu, a apagada ainda não sumiu do servidor.
  const pendentes = new Set(
    Object.keys(ler(CHAVE_FILA, {}))
      .filter((chave) => chave.startsWith(PREFIXO_SUGESTAO))
      .map((chave) => chave.slice(PREFIXO_SUGESTAO.length)),
  )
  return { lista: [...sugestoesNaFila(), ...lista.filter((s) => !pendentes.has(s.id))], semConexao }
}

export function apagarSugestao(id) {
  const chave = `${PREFIXO_SUGESTAO}${id}`
  gravar(CHAVE_SUGESTOES, ler(CHAVE_SUGESTOES, []).filter((s) => s.id !== id))
  // Ainda não subiu: basta tirar da fila.
  if (ler(CHAVE_FILA, {})[chave]?.metodo === 'PUT') {
    const fila = ler(CHAVE_FILA, {})
    delete fila[chave]
    gravar(CHAVE_FILA, fila)
    return
  }
  enfileirar(chave, { url: `/api/sugestoes/${id}`, metodo: 'DELETE', corpo: '' })
}
