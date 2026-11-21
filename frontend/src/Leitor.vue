<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import Icone from './Icone.vue'
import MaisInformacoes from './MaisInformacoes.vue'
import SeletorTema from './SeletorTema.vue'
import { apagarAnotacao, criarCartao, lerAnotacoes, lerBaralhos, lerPesquisas, lerProgresso, pesquisarTrecho, salvarAnotacao, salvarProgresso, ultimoBaralho } from './dados.js'
import { criarContador, diaDe } from './leitura.js'
import { ancorasDaMeta, itemNaMeta, marcarDoLeitor, metaDoLivro, nomeDoDia, rotuloDaMeta } from './planos.js'
import { abrirEpub } from './motores/epub.js'
import { abrirPdf } from './motores/pdf.js'
import { abrirTextoPdf } from './motores/texto-pdf.js'
import { ESTILOS, FONTE, ZOOM, ajustesDoLivro, guardarAjustes, mostrarTema, preferencias } from './preferencias.js'
import { ORIENTACOES, aplicarOrientacao, podeGirar, soltar } from './orientacao.js'

const ESPERA_PARA_SALVAR = 1000
const JANELA_DO_CONTROLE = 1500
const LIMITE_CITACAO = 20000
const PASSOS_DA_BARRA = 1000
const ESPACO_DA_BARRA = 64
const ESPACO_DAS_ALCAS = 28

const CORES = [
  { valor: 'amarelo', rotulo: 'amarelo' },
  { valor: 'verde', rotulo: 'verde' },
  { valor: 'azul', rotulo: 'azul' },
  { valor: 'rosa', rotulo: 'rosa' },
]
const OPCOES = {
  familia: [
    { valor: 'literata', rotulo: 'Literata' },
    { valor: 'sem-serifa', rotulo: 'Sem serifa' },
    { valor: 'original', rotulo: 'Do livro' },
  ],
  entrelinhas: [
    { valor: 'compacto', rotulo: 'Compacto' },
    { valor: 'normal', rotulo: 'Normal' },
    { valor: 'confortavel', rotulo: 'Confortável' },
    { valor: 'amplo', rotulo: 'Amplo' },
  ],
  margem: [
    { valor: 'pequena', rotulo: 'Pequena' },
    { valor: 'media', rotulo: 'Média' },
    { valor: 'grande', rotulo: 'Grande' },
  ],
  alinhamento: [
    { valor: 'esquerda', rotulo: 'Esquerda' },
    { valor: 'justificado', rotulo: 'Justificado' },
  ],
}
// O texto tirado do PDF perde as fontes dele, então "Do livro" não vale no modo texto.
const OPCOES_TEXTO_PDF = { ...OPCOES, familia: OPCOES.familia.filter((opcao) => opcao.valor !== 'original') }
const GRUPOS = [
  { chave: 'familia', legenda: 'Fonte' },
  { chave: 'entrelinhas', legenda: 'Entrelinhas' },
  { chave: 'margem', legenda: 'Margens' },
  { chave: 'alinhamento', legenda: 'Alinhamento' },
]

const props = defineProps({
  livro: { type: Object, required: true },
  // Um ponto do livro para abrir (vindo da busca, R32), no formato das marcações.
  ancora: { type: String, default: '' },
  // O plano de leitura cujo play abriu o livro (R35).
  planoId: { type: String, default: '' },
})
defineEmits(['fechar'])

const area = ref(null)
const localizacao = ref('')
const percentual = ref(0)
const rotulo = ref('')
const capitulo = ref('')
const sumario = ref([])
const erro = ref(false)
const painel = ref(null)
const abaLista = ref('capitulos')
const controlesVisiveis = ref(true)
const arrasto = ref(null)
const anotacoes = ref([])
const selecao = ref(null)
const edicao = ref(null)
// Criar cartão da marcação aberta: { baralhos, baralho, carregando, enviando, erro, revisar }.
const cartao = ref(null)
// Modo do motor aberto agora, que só muda depois de o outro modo abrir.
const emTexto = ref(false)
const abrindo = ref(false)
// Meta do plano de leitura deste livro (R35): o trecho a ler, de onde a onde (fração do livro).
const metaAtiva = ref(null)
const avisoDoFimFechado = ref(false)

// Cada livro tem os seus ajustes de leitura (fonte, fundo, margens…); mudar aqui não mexe nos outros.
const ajustes = reactive(ajustesDoLivro(props.livro.id))
const estiloAtual = computed(() =>
  Object.keys(ESTILOS).find((chave) => {
    const estilo = ESTILOS[chave].ajustes()
    return Object.keys(estilo).every((campo) => campo === 'tema' || estilo[campo] === ajustes[campo])
  }),
)

function aplicarEstilo(chave) {
  Object.assign(ajustes, ESTILOS[chave].ajustes())
}

const ehPdf = computed(() => props.livro.format === 'pdf')
const textoEscolhido = computed(() => ehPdf.value && Boolean(preferencias.textoPdf?.[props.livro.id]))
const opcoes = computed(() => (emTexto.value ? OPCOES_TEXTO_PDF : OPCOES))
const percentualExibido = computed(() => Math.round((arrasto.value ?? percentual.value) * 100))

// Chegou ao começo do que vem depois da meta: a meta do dia acabou.
const chegouAoFimDaMeta = computed(() => {
  const m = metaAtiva.value
  if (!m || m.fim === null || m.estado === 'lida') return false
  return m.fim >= 1 ? percentual.value >= 0.995 : percentual.value >= m.fim - 0.001
})
const faixaDaMeta = computed(() => {
  const m = metaAtiva.value
  if (!m || m.inicio === null) return null
  const fim = m.fim ?? m.inicio
  return { left: `${m.inicio * 100}%`, width: `max(${(fim - m.inicio) * 100}%, 3px)` }
})
const quandoDaMeta = computed(() => {
  const m = metaAtiva.value
  if (!m) return ''
  const hoje = diaDe(new Date())
  return m.meta.day === hoje ? 'Meta de hoje' : m.meta.day < hoje ? `Meta atrasada (${nomeDoDia(m.meta.day)})` : `Próxima meta (${nomeDoDia(m.meta.day)})`
})
const textoDaMeta = computed(() => (metaAtiva.value ? `${quandoDaMeta.value}: ${metaAtiva.value.rotulo}` : ''))

// O rodapé (R43) separa as duas medidas: quanto da meta já foi (o trecho de hoje) e quanto do livro.
// Páginas do app: as que as Estatísticas contam (no PDF, as do arquivo).
const totalDePaginas = ref(0)
const andamentoDaMeta = computed(() => {
  const m = metaAtiva.value
  if (!m || m.inicio === null) return null
  const fim = m.fim ?? 1
  const atual = arrasto.value ?? percentual.value
  if (m.estado === 'lida') return { fracao: 1, texto: 'lida' }
  if (atual < m.inicio - 0.0005) {
    return { fracao: 0, texto: 'começa mais adiante' }
  }
  const largura = Math.max(fim - m.inicio, 0.0001)
  const fracao = Math.min(Math.max((atual - m.inicio) / largura, 0), 1)
  if (fracao >= 0.999 || chegouAoFimDaMeta.value) return { fracao: 1, texto: 'chegou ao fim' }
  const faltam = totalDePaginas.value ? Math.max(1, Math.round((fim - atual) * totalDePaginas.value)) : 0
  const resto = faltam ? ` · faltam ~${faltam} ${faltam === 1 ? 'página' : 'páginas'}` : ''
  return { fracao, texto: `${Math.round(fracao * 100)}%${resto}` }
})

async function carregarMeta() {
  const achada = metaDoLivro(props.livro.id, props.planoId)
  if (!achada || !motor) return
  const { plano, meta } = achada
  metaAtiva.value = { plano, meta, rotulo: rotuloDaMeta(plano, meta), inicio: null, fim: null, estado: meta.state }
  try {
    const { inicio, fim } = await ancorasDaMeta(plano, meta)
    if (desmontado || !motor || metaAtiva.value?.meta.id !== meta.id) return
    const pInicio = inicio ? motor.percentualDe?.(inicio) ?? null : null
    const pFim = fim ? motor.percentualDe?.(fim) ?? null : pInicio !== null ? 1 : null
    metaAtiva.value = { ...metaAtiva.value, inicio: pInicio, fim: pFim !== null && pInicio !== null && pFim < pInicio ? null : pFim }
  } catch (falha) {
    console.warn('Não foi possível achar a meta no livro', falha)
  }
}

function marcarMetaLida() {
  const m = metaAtiva.value
  marcarDoLeitor(m.plano.id, m.meta.id, 'lida')
  metaAtiva.value = { ...m, estado: 'lida' }
}

const naMeta = (item) => Boolean(metaAtiva.value && itemNaMeta(metaAtiva.value.plano, metaAtiva.value.meta, item, ehPdf.value))

let motor
let desmontado = false
// Estatísticas: conta o tempo com a leitura ativa e as páginas lidas (leitura.js).
const contador = criarContador(props.livro.id)
let relogio
// Abrir o livro ou mudar a fonte também move a posição; só salva depois que a leitura avançar.
let navegou = false
let ultimoSalvo = ''
let temporizador
let ultimoControle = 0

function salvarAgora() {
  clearTimeout(temporizador)
  if (!navegou || !localizacao.value || localizacao.value === ultimoSalvo) return
  ultimoSalvo = localizacao.value
  salvarProgresso(props.livro.id, localizacao.value, percentual.value)
}

// porLeitura: o motor viu a página mudar sem ser por abertura ou ajuste, como ao deslizar o dedo.
function aoMudar(novo, porLeitura = false) {
  if (novo.contagem) contador.mudou(novo.contagem, porLeitura)
  if (novo.contagem?.totalDePaginas) totalDePaginas.value = novo.contagem.totalDePaginas
  localizacao.value = novo.posicao
  percentual.value = Math.min(Math.max(novo.percentual, 0), 1)
  rotulo.value = novo.rotulo
  capitulo.value = novo.capitulo
  if (porLeitura) {
    navegou = true
    // Virar a página volta o foco ao texto; só os botões da barra a mantêm aberta.
    if (Date.now() - ultimoControle > JANELA_DO_CONTROLE) controlesVisiveis.value = false
  }
  if (navegou) {
    clearTimeout(temporizador)
    temporizador = setTimeout(salvarAgora, ESPERA_PARA_SALVAR)
  }
}

function anterior() {
  navegou = true
  ultimoControle = Date.now()
  motor?.anterior()
}

function proxima() {
  navegou = true
  ultimoControle = Date.now()
  motor?.proxima()
}

function irPara(destino) {
  navegou = true
  ultimoControle = Date.now()
  painel.value = null
  motor?.irPara(destino)
}

function saltarNaBarra(evento) {
  navegou = true
  ultimoControle = Date.now()
  arrasto.value = null
  motor?.irParaPercentual(Number(evento.target.value) / PASSOS_DA_BARRA)
}

function aoDeslizar(direcao) {
  if (direcao === 'proxima') proxima()
  else anterior()
  controlesVisiveis.value = false
}

// Como no Kindle: laterais viram a página, o centro mostra ou esconde os controles.
function aoClicar(x) {
  contador.atividade()
  aoTocarParaGirar()
  if (painel.value) {
    painel.value = null
    return
  }
  const fracao = x / window.innerWidth
  if (fracao >= 0.3 && fracao <= 0.7) {
    controlesVisiveis.value = !controlesVisiveis.value
    return
  }
  if (fracao < 0.3) anterior()
  else proxima()
  controlesVisiveis.value = false
}

function aoTeclar(evento) {
  contador.atividade()
  if (evento.target?.tagName === 'TEXTAREA' || evento.target?.tagName === 'INPUT') return
  if (evento.key === 'ArrowLeft') anterior()
  if (evento.key === 'ArrowRight') proxima()
  if (evento.key === 'Escape') {
    painel.value = null
    fecharEdicao()
  }
}

function alternarPainel(nome) {
  painel.value = painel.value === nome ? null : nome
}

function ajustar(chave, limites, sentido) {
  const novo = ajustes[chave] + sentido * limites.passo
  ajustes[chave] = Math.min(Math.max(novo, limites.minimo), limites.maximo)
}

function aoEsconderPagina() {
  contador.visivel(document.visibilityState !== 'hidden')
  if (document.visibilityState === 'hidden') salvarAgora()
}

function aoSairDaPagina() {
  salvarAgora()
  contador.encerrar()
}

function aoSelecionar(nova) {
  contador.atividade()
  selecao.value = nova
  if (nova) controlesVisiveis.value = false
}

// A barra fica junto do trecho: acima dele, ou abaixo se não houver espaço.
const estiloDaBarra = computed(() => {
  const caixa = selecao.value?.caixa
  if (!caixa) return {}
  if (caixa.topo > ESPACO_DA_BARRA) return { top: `${caixa.topo - ESPACO_DA_BARRA}px`, bottom: 'auto' }
  const abaixo = Math.min(caixa.base + ESPACO_DAS_ALCAS, window.innerHeight - ESPACO_DA_BARRA)
  return { top: `${abaixo}px`, bottom: 'auto' }
})

// Tela cheia esconde as barras do sistema; o Android sai dela pelo gesto de voltar.
const telaCheiaDisponivel = Boolean(document.fullscreenEnabled)
const telaCheia = ref(Boolean(document.fullscreenElement))

function aoMudarTelaCheia() {
  telaCheia.value = Boolean(document.fullscreenElement)
  // A trava que precisou da tela cheia cai junto com ela (gesto de voltar do Android, por exemplo).
  if (!telaCheia.value && travouComTelaCheia) {
    travouComTelaCheia = false
    if (preferencias.orientacao !== 'auto') estadoDoGiro.value = 'solta'
  }
}

// Girar a tela (R40): Automático segue o celular; Em pé e Deitado travam. Ao abrir o leitor, a
// escolha guardada é aplicada; se o navegador pedir um toque antes (para a tela cheia), ela fica
// "esperando" e vale no próximo toque na página.
const girarDisponivel = podeGirar()
const estadoDoGiro = ref('')
let travouComTelaCheia = false
const AVISOS_DO_GIRO = {
  pendente: 'Toque na página para a tela girar.',
  solta: 'Ao sair da tela cheia, a tela voltou a girar com o celular. Escolha de novo para travar.',
  'sem-suporte': 'Este aparelho não deixa o app travar a tela: ela segue o celular.',
  falhou: 'Não deu para travar a tela agora. Tente de novo.',
}

async function aplicarGiro() {
  const escolha = preferencias.orientacao ?? 'auto'
  const tinhaTelaCheia = Boolean(document.fullscreenElement)
  // Girar redistribui as páginas: o motor guarda o começo da página para voltar a ele (R43).
  motor?.guardarPosicao?.()
  const resultado = await aplicarOrientacao(escolha)
  if (desmontado) {
    soltar()
    return
  }
  if (resultado.ok) {
    estadoDoGiro.value = ''
    travouComTelaCheia = escolha !== 'auto' && !tinhaTelaCheia && Boolean(document.fullscreenElement)
    return
  }
  estadoDoGiro.value = resultado.motivo === 'sem-gesto' ? 'pendente' : resultado.motivo
  // Sem suporte não adianta insistir: volta para o automático.
  if (resultado.motivo === 'sem-suporte') preferencias.orientacao = 'auto'
}

function escolherGiro(valor) {
  preferencias.orientacao = valor
  aplicarGiro()
}

// Um toque na página (ou nos controles) aplica a escolha que estava esperando.
function aoTocarParaGirar() {
  if (estadoDoGiro.value === 'pendente') aplicarGiro()
}

async function alternarTelaCheia() {
  // Entrar ou sair da tela cheia muda o tamanho do texto na tela; o motor guarda o começo da
  // página agora, ainda no tamanho de antes, e volta a ele quando a tela parar de mudar (R43).
  motor?.guardarPosicao?.()
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
  } catch (falha) {
    console.warn('Não foi possível alternar a tela cheia', falha)
  }
}

function encerrarSelecao() {
  selecao.value = null
  motor?.limparSelecao()
}

// As ações do texto selecionado ficam aqui; Anki e Flashcards entram nesta mesma barra.
async function copiarSelecao() {
  const { texto } = selecao.value
  encerrarSelecao()
  try {
    await navigator.clipboard.writeText(texto)
  } catch (falha) {
    console.warn('Não foi possível copiar', falha)
  }
}

function pesquisarSelecao() {
  const { texto } = selecao.value
  encerrarSelecao()
  window.open(`https://www.google.com/search?q=${encodeURIComponent(texto)}`, '_blank', 'noopener')
}

// Mais informações (R39): o Acervo pesquisa o trecho; a folha mostra o resultado e as pesquisas do
// livro ficam na aba Pesquisas do sumário, para voltar a elas.
const LIMITE_PESQUISA = 1000
const pesquisas = ref([])
const pesquisaAberta = ref(null)
const avisoPesquisa = ref('')
const carregandoPesquisas = ref(false)

async function carregarPesquisas() {
  carregandoPesquisas.value = true
  avisoPesquisa.value = ''
  try {
    pesquisas.value = await lerPesquisas(props.livro.id)
  } catch (falha) {
    avisoPesquisa.value = falha.message
  } finally {
    carregandoPesquisas.value = false
  }
}

async function pedirMaisInformacoes() {
  const atual = selecao.value
  if (!atual) return
  encerrarSelecao()
  const trecho = atual.texto.trim()
  if (trecho.length > LIMITE_PESQUISA) {
    pesquisaAberta.value = null
    window.alert(`Trecho longo demais: selecione até ${LIMITE_PESQUISA} caracteres.`)
    return
  }
  try {
    const nova = await pesquisarTrecho(props.livro.id, {
      id: crypto.randomUUID(),
      quote: trecho,
      anchor: atual.ancora ?? '',
      label: atual.rotulo ?? '',
      percent: atual.percentual ?? 0,
    })
    pesquisas.value = [nova, ...pesquisas.value.filter((p) => p.id !== nova.id)]
    pesquisaAberta.value = nova
  } catch (falha) {
    window.alert(falha.message)
  }
}

function abrirPesquisa(p) {
  painel.value = null
  pesquisaAberta.value = p
}

function pesquisaMudou(p) {
  pesquisas.value = pesquisas.value.map((x) => (x.id === p.id ? p : x))
}

function pesquisaApagada(id) {
  pesquisas.value = pesquisas.value.filter((x) => x.id !== id)
  pesquisaAberta.value = null
}

function irAoTrechoPesquisado(p) {
  pesquisaAberta.value = null
  navegou = true
  ultimoControle = Date.now()
  motor?.irParaAncora(p.anchor)
}

watch(abaLista, (aba) => {
  if (aba === 'pesquisas') carregarPesquisas()
})

const ESTADO_DA_PESQUISA = { processando: 'pesquisando…', falhou: 'não deu certo', indisponivel: 'Acervo fora do ar' }

function redesenharMarcacoes() {
  motor?.marcar(anotacoes.value)
}

function criarMarcacao(cor, abrirNota = false) {
  const atual = selecao.value
  if (!atual) return
  const nova = salvarAnotacao(props.livro.id, {
    id: crypto.randomUUID(),
    color: cor,
    note: '',
    quote: atual.texto.slice(0, LIMITE_CITACAO),
    anchor: atual.ancora,
    label: atual.rotulo,
    percent: atual.percentual,
  })
  anotacoes.value = [...anotacoes.value, nova].sort((a, b) => a.percent - b.percent)
  encerrarSelecao()
  redesenharMarcacoes()
  if (abrirNota) edicao.value = { ...nova }
}

function trocar(nova) {
  anotacoes.value = anotacoes.value.map((a) => (a.id === nova.id ? nova : a))
  redesenharMarcacoes()
}

function aoTocarMarcacao(id) {
  const marca = anotacoes.value.find((a) => a.id === id)
  if (marca) edicao.value = { ...marca }
}

function mudarCorDaEdicao(cor) {
  const salva = salvarAnotacao(props.livro.id, { ...edicao.value, color: cor })
  edicao.value = { ...salva }
  trocar(salva)
}

function fecharEdicao() {
  const atual = edicao.value
  if (!atual) return
  edicao.value = null
  cartao.value = null
  const original = anotacoes.value.find((a) => a.id === atual.id)
  if (original && original.note !== atual.note) trocar(salvarAnotacao(props.livro.id, atual))
}

function apagarDaEdicao() {
  const { id } = edicao.value
  edicao.value = null
  cartao.value = null
  apagarAnotacao(props.livro.id, id)
  anotacoes.value = anotacoes.value.filter((a) => a.id !== id)
  redesenharMarcacoes()
}

async function abrirCartao() {
  cartao.value = { baralhos: [], baralho: '', carregando: true, enviando: false, erro: '', revisar: '' }
  try {
    const baralhos = await lerBaralhos()
    if (!cartao.value) return
    const ultimo = ultimoBaralho()
    cartao.value.baralhos = baralhos
    cartao.value.baralho = baralhos.some((b) => b.id === ultimo) ? ultimo : (baralhos[0]?.id ?? '')
    if (!baralhos.length) cartao.value.erro = 'Nenhum baralho no Flashcards ainda. Crie um lá primeiro.'
  } catch (falha) {
    if (cartao.value) cartao.value.erro = falha.message
  } finally {
    if (cartao.value) cartao.value.carregando = false
  }
}

async function enviarCartao() {
  const atual = edicao.value
  const pedido = cartao.value
  if (!atual || !pedido?.baralho) return
  // A nota escrita agora vai junto: a IA usa a nota para saber o que lembrar.
  const original = anotacoes.value.find((a) => a.id === atual.id)
  if (original && original.note !== atual.note) trocar(salvarAnotacao(props.livro.id, atual))
  pedido.enviando = true
  pedido.erro = ''
  try {
    const r = await criarCartao(props.livro.id, atual.id, pedido.baralho)
    pedido.revisar = r.review
    if (edicao.value?.id === atual.id) edicao.value = { ...edicao.value, flashcards_at: r.flashcards_at }
    anotacoes.value = anotacoes.value.map((a) => (a.id === atual.id ? { ...a, flashcards_at: r.flashcards_at } : a))
  } catch (falha) {
    pedido.erro = falha.message
  } finally {
    pedido.enviando = false
  }
}

const quandoVirouCartao = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })

function irParaMarcacao(marca) {
  navegou = true
  ultimoControle = Date.now()
  painel.value = null
  motor?.irParaAncora(marca.anchor)
}

async function abrirMotor(posicao, percentualSalvo) {
  emTexto.value = textoEscolhido.value
  abrindo.value = true
  // A área muda de forma entre os modos, e o motor mede a área ao abrir.
  await nextTick()
  try {
    const abrir = !ehPdf.value ? abrirEpub : emTexto.value ? abrirTextoPdf : abrirPdf
    const aberto = await abrir({
      livro: props.livro,
      area: area.value,
      posicao,
      percentualSalvo,
      preferencias: ajustes,
      aoMudar,
      aoClicar,
      aoDeslizar,
      aoTeclar,
      aoSelecionar,
      aoTocarMarcacao,
    })
    if (desmontado) {
      aberto.destruir()
      return
    }
    motor = aberto
    sumario.value = motor.sumario()
    redesenharMarcacoes()
  } finally {
    abrindo.value = false
  }
}

// A posição é a página do PDF nos dois modos, então a leitura continua no mesmo ponto.
async function mudarExibicao(texto) {
  if (abrindo.value || texto === emTexto.value) return
  const { [props.livro.id]: _, ...outros } = preferencias.textoPdf ?? {}
  preferencias.textoPdf = texto ? { ...outros, [props.livro.id]: true } : outros
  encerrarSelecao()
  motor?.destruir()
  motor = null
  try {
    await abrirMotor(localizacao.value, percentual.value)
    carregarMeta()
  } catch (falha) {
    console.warn('Não foi possível mudar o modo de leitura', falha)
    erro.value = true
  }
}

onMounted(async () => {
  window.addEventListener('keydown', aoTeclar)
  window.addEventListener('pagehide', aoSairDaPagina)
  document.addEventListener('visibilitychange', aoEsconderPagina)
  document.addEventListener('fullscreenchange', aoMudarTelaCheia)
  if (girarDisponivel && preferencias.orientacao !== 'auto') aplicarGiro()
  relogio = setInterval(contador.tique, 1000)
  try {
    const [salvo, marcas] = await Promise.all([lerProgresso(props.livro.id), lerAnotacoes(props.livro.id)])
    ultimoSalvo = salvo.position ?? ''
    anotacoes.value = marcas
    await abrirMotor(salvo.position, salvo.percent)
    if (props.ancora) await motor?.irParaAncora(props.ancora)
    carregarMeta()
  } catch (falha) {
    console.warn('Não foi possível abrir o livro', falha)
    erro.value = true
  }
})

// O livro usa o próprio tema enquanto está aberto; ao fechar, volta o tema do app.
watch(() => ajustes.tema, mostrarTema, { immediate: true })

watch(ajustes, () => {
  guardarAjustes(props.livro.id, ajustes)
  motor?.aplicar(ajustes)
})

onBeforeUnmount(() => {
  desmontado = true
  mostrarTema(preferencias.tema)
  fecharEdicao()
  salvarAgora()
  clearInterval(relogio)
  contador.encerrar()
  window.removeEventListener('keydown', aoTeclar)
  window.removeEventListener('pagehide', aoSairDaPagina)
  document.removeEventListener('visibilitychange', aoEsconderPagina)
  document.removeEventListener('fullscreenchange', aoMudarTelaCheia)
  // Fora do leitor, o app volta a seguir o celular (a escolha fica guardada para o próximo livro).
  if (girarDisponivel) soltar()
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  motor?.destruir()
})
</script>

<template>
  <div class="leitor" :data-localizacao="localizacao" @pointerdown="contador.atividade" @pointerup="aoTocarParaGirar" @wheel.passive="contador.atividade">
    <div ref="area" class="area" :class="ehPdf ? (emTexto ? 'texto' : 'pdf') : 'epub'"></div>

    <p v-if="abrindo && emTexto" class="preparando">Preparando o texto…</p>

    <div v-if="erro" class="erro">
      <p>Não foi possível abrir este livro.</p>
      <p class="dica">Sem conexão com a sua rede, só os livros baixados abrem.</p>
      <button type="button" class="botao" @click="$emit('fechar')">Voltar ao início</button>
    </div>

    <p v-if="!controlesVisiveis && !selecao" class="percentual-discreto" aria-hidden="true">{{ percentualExibido }}%</p>

    <header class="barra topo" :class="{ oculto: !controlesVisiveis }">
      <button type="button" class="icone" aria-label="Voltar" @click="$emit('fechar')"><Icone nome="voltar" :tamanho="20" /></button>
      <h1>{{ livro.title }}</h1>
      <button type="button" class="icone" aria-label="Sumário" :aria-expanded="painel === 'lista'" @click="alternarPainel('lista')"><Icone nome="lista" :tamanho="20" /></button>
      <button
        v-if="telaCheiaDisponivel"
        type="button"
        class="icone"
        :aria-label="telaCheia ? 'Sair da tela cheia' : 'Tela cheia'"
        :aria-pressed="telaCheia"
        @click="alternarTelaCheia"
      ><Icone :nome="telaCheia ? 'recolher' : 'expandir'" :tamanho="20" /></button>
      <button type="button" class="icone aa" aria-label="Ajustes" :aria-expanded="painel === 'ajustes'" @click="alternarPainel('ajustes')">Aa</button>
    </header>

    <!-- Rodapé (R43): a meta de hoje numa faixa própria, com o quanto dela já foi; embaixo, o livro
         (onde está, quanto já foi) e a barra com as setas dos lados. Nada se sobrepõe. -->
    <footer class="barra base" :class="{ oculto: !controlesVisiveis, 'tela-cheia': telaCheia }">
      <div v-if="metaAtiva" class="meta-leitor" :class="{ feita: metaAtiva.estado === 'lida' }" role="group" :aria-label="textoDaMeta">
        <p class="linha-valor">
          <span class="rotulo-secao">{{ metaAtiva.estado === 'lida' ? 'Meta lida' : quandoDaMeta }}</span>
          <span class="nome-meta" :title="metaAtiva.rotulo">{{ metaAtiva.rotulo }}</span>
          <span v-if="andamentoDaMeta" class="valor">{{ andamentoDaMeta.texto }}</span>
        </p>
        <span v-if="andamentoDaMeta" class="progresso" aria-hidden="true"><span :style="{ width: `${andamentoDaMeta.fracao * 100}%` }"></span></span>
      </div>
      <div class="livro-leitor">
        <p class="linha-valor">
          <span class="rotulo-secao">Livro</span>
          <span v-if="rotulo" class="onde">{{ rotulo }}</span>
          <span class="valor numero">{{ percentualExibido }}%</span>
        </p>
        <div class="navegar">
          <button type="button" class="icone" aria-label="Anterior" @click="anterior"><Icone nome="voltar" :tamanho="20" /></button>
          <div class="trilho">
            <span class="trilho-fundo" aria-hidden="true">
              <span class="trilho-lido" :style="{ width: `${(arrasto ?? percentual) * 100}%` }"></span>
              <span v-if="faixaDaMeta" class="faixa-meta" :style="faixaDaMeta"></span>
            </span>
            <input
              type="range"
              min="0"
              :max="PASSOS_DA_BARRA"
              :value="Math.round((arrasto ?? percentual) * PASSOS_DA_BARRA)"
              aria-label="Progresso da leitura"
              @input="arrasto = Number($event.target.value) / PASSOS_DA_BARRA"
              @change="saltarNaBarra"
            />
          </div>
          <button type="button" class="icone" aria-label="Próxima" @click="proxima"><Icone nome="avancar" :tamanho="20" /></button>
        </div>
      </div>
    </footer>

    <div v-if="chegouAoFimDaMeta && !avisoDoFimFechado && !selecao" class="fim-da-meta" :class="{ 'com-controles': controlesVisiveis, 'com-meta': controlesVisiveis && metaAtiva }" role="status">
      <span :title="metaAtiva.rotulo">Meta concluída</span>
      <button type="button" class="botao primario marcar" @click="marcarMetaLida">Marcar como lida</button>
      <button type="button" class="botao discreto icone" aria-label="Fechar o aviso" @click="avisoDoFimFechado = true"><Icone nome="fechar" /></button>
    </div>

    <div v-if="selecao" class="selecao" :style="estiloDaBarra" role="toolbar" aria-label="Marcar o texto selecionado">
      <!-- No modo texto do PDF a seleção ainda não vira marcação. -->
      <template v-if="selecao.ancora">
        <button
          v-for="cor in CORES"
          :key="cor.valor"
          type="button"
          class="cor"
          :class="`cor-${cor.valor}`"
          :aria-label="`Marcar em ${cor.rotulo}`"
          @click="criarMarcacao(cor.valor)"
        ></button>
        <span class="divisor"></span>
        <button type="button" class="icone" aria-label="Marcar com nota" @click="criarMarcacao('amarelo', true)"><Icone nome="nota" :tamanho="20" /></button>
      </template>
      <button type="button" class="icone" aria-label="Copiar" @click="copiarSelecao"><Icone nome="copiar" :tamanho="20" /></button>
      <button type="button" class="icone" aria-label="Mais informações" title="Mais informações" @click="pedirMaisInformacoes"><Icone nome="info" :tamanho="20" /></button>
      <button type="button" class="icone" aria-label="Pesquisar na Web" @click="pesquisarSelecao"><Icone nome="pesquisar" :tamanho="20" /></button>
    </div>

    <div v-if="painel" class="fundo-painel" :class="{ escurecer: painel === 'lista' }" @click="painel = null"></div>

    <aside v-if="painel === 'lista'" class="folha folha-sumario" aria-label="Sumário e marcações">
      <div class="abas" role="group">
        <button type="button" :class="{ ativa: abaLista === 'capitulos' }" :aria-pressed="abaLista === 'capitulos'" @click="abaLista = 'capitulos'">Capítulos</button>
        <button type="button" :class="{ ativa: abaLista === 'marcacoes' }" :aria-pressed="abaLista === 'marcacoes'" @click="abaLista = 'marcacoes'">Marcações</button>
        <button type="button" :class="{ ativa: abaLista === 'pesquisas' }" :aria-pressed="abaLista === 'pesquisas'" @click="abaLista = 'pesquisas'">Pesquisas</button>
      </div>
      <template v-if="abaLista === 'capitulos'">
        <ol v-if="sumario.length">
          <li v-for="item in sumario" :key="`${item.destino}-${item.rotulo}`">
            <button
              type="button"
              :class="{ atual: item.destino === capitulo, 'na-meta': naMeta(item) }"
              :aria-current="item.destino === capitulo ? 'true' : undefined"
              :style="{ paddingLeft: `${8 + item.nivel * 16}px` }"
              @click="irPara(item.destino)"
            >
              {{ item.rotulo }}
              <span v-if="naMeta(item)" class="etiqueta verde selo-meta">meta</span>
            </button>
          </li>
        </ol>
        <p v-else class="vazio">Este livro não tem sumário.</p>
      </template>
      <template v-else-if="abaLista === 'pesquisas'">
        <p v-if="avisoPesquisa" class="vazio">{{ avisoPesquisa }}</p>
        <ul v-else-if="pesquisas.length" class="marcacoes">
          <li v-for="p in pesquisas" :key="p.id">
            <button type="button" @click="abrirPesquisa(p)">
              <span class="citacao">{{ p.quote }}</span>
              <span class="origem">{{ p.label }}<template v-if="p.label"> · </template>{{ ESTADO_DA_PESQUISA[p.state] || (p.reference_link ? 'virou referência' : 'pronta') }}</span>
            </button>
          </li>
        </ul>
        <p v-else-if="!carregandoPesquisas" class="vazio">Selecione um trecho e toque em Mais informações (ⓘ) para pesquisar sobre ele.</p>
      </template>
      <template v-else>
        <ul v-if="anotacoes.length" class="marcacoes">
          <li v-for="marca in anotacoes" :key="marca.id">
            <button type="button" @click="irParaMarcacao(marca)">
              <span class="citacao" :class="`traco-${marca.color}`">{{ marca.quote }}</span>
              <span v-if="marca.note" class="nota">{{ marca.note }}</span>
              <span class="origem">{{ marca.label }}<template v-if="marca.label"> · </template>{{ Math.round(marca.percent * 100) }}%</span>
            </button>
          </li>
        </ul>
        <p v-else class="vazio">Selecione um trecho do livro para marcá-lo.</p>
      </template>
    </aside>

    <aside v-if="painel === 'ajustes'" class="folha ajustes" aria-label="Ajustes de leitura">
      <fieldset v-if="ehPdf">
        <legend>Exibição</legend>
        <div class="opcoes">
          <button type="button" :aria-pressed="!emTexto" :disabled="abrindo" @click="mudarExibicao(false)">Página</button>
          <button type="button" :aria-pressed="emTexto" :disabled="abrindo" @click="mudarExibicao(true)">Texto</button>
        </div>
      </fieldset>
      <div class="contador">
        <template v-if="ehPdf && !emTexto">
          <button type="button" aria-label="Diminuir zoom" :disabled="ajustes.zoom <= ZOOM.minimo" @click="ajustar('zoom', ZOOM, -1)">−</button>
          <output>{{ ajustes.zoom }}%</output>
          <button type="button" aria-label="Aumentar zoom" :disabled="ajustes.zoom >= ZOOM.maximo" @click="ajustar('zoom', ZOOM, 1)">+</button>
        </template>
        <template v-else>
          <button type="button" class="menor" aria-label="Diminuir fonte" :disabled="ajustes.fonte <= FONTE.minimo" @click="ajustar('fonte', FONTE, -1)">A</button>
          <output>{{ ajustes.fonte }}%</output>
          <button type="button" class="maior" aria-label="Aumentar fonte" :disabled="ajustes.fonte >= FONTE.maximo" @click="ajustar('fonte', FONTE, 1)">A</button>
        </template>
      </div>
      <fieldset v-if="!ehPdf || emTexto">
        <legend>Estilo pronto</legend>
        <div class="opcoes">
          <button
            v-for="(estilo, chave) in ESTILOS"
            :key="chave"
            type="button"
            :aria-pressed="estiloAtual === chave"
            @click="aplicarEstilo(chave)"
          >
            {{ estilo.rotulo }}
          </button>
        </div>
      </fieldset>
      <SeletorTema :alvo="ajustes" />
      <fieldset v-if="girarDisponivel">
        <legend>Girar a tela</legend>
        <div class="opcoes">
          <button
            v-for="opcao in ORIENTACOES"
            :key="opcao.valor"
            type="button"
            :aria-pressed="preferencias.orientacao === opcao.valor"
            :disabled="estadoDoGiro === 'sem-suporte' && opcao.valor !== 'auto'"
            @click="escolherGiro(opcao.valor)"
          >
            {{ opcao.rotulo }}
          </button>
        </div>
        <p v-if="estadoDoGiro" class="aviso-giro" role="status">{{ AVISOS_DO_GIRO[estadoDoGiro] }}</p>
      </fieldset>
      <template v-if="!ehPdf || emTexto">
        <fieldset v-for="grupo in GRUPOS" :key="grupo.chave">
          <legend>{{ grupo.legenda }}</legend>
          <div class="opcoes">
            <button
              v-for="opcao in opcoes[grupo.chave]"
              :key="opcao.valor"
              type="button"
              :aria-pressed="ajustes[grupo.chave] === opcao.valor"
              @click="ajustes[grupo.chave] = opcao.valor"
            >
              {{ opcao.rotulo }}
            </button>
          </div>
        </fieldset>
      </template>
    </aside>

    <MaisInformacoes
      v-if="pesquisaAberta"
      :livro-id="livro.id"
      :pesquisa="pesquisaAberta"
      @fechar="pesquisaAberta = null"
      @mudou="pesquisaMudou"
      @apagada="pesquisaApagada"
      @ir="irAoTrechoPesquisado"
    />

    <template v-if="edicao">
      <div class="fundo-painel escurecer" @click="fecharEdicao"></div>
      <aside class="folha edicao" aria-label="Editar marcação">
        <p class="citacao" :class="`traco-${edicao.color}`">{{ edicao.quote }}</p>
        <div class="cores">
          <button
            v-for="cor in CORES"
            :key="cor.valor"
            type="button"
            class="cor"
            :class="`cor-${cor.valor}`"
            :aria-label="`Mudar para ${cor.rotulo}`"
            :aria-pressed="edicao.color === cor.valor"
            @click="mudarCorDaEdicao(cor.valor)"
          ></button>
        </div>
        <textarea v-model="edicao.note" class="campo" rows="4" placeholder="Escreva uma nota" aria-label="Nota"></textarea>
        <section v-if="cartao" class="cartao-flashcards" aria-label="Criar cartão">
          <p v-if="cartao.revisar" class="feito">
            Cartão pedido. A IA monta a frente e o verso, e você aprova no Flashcards.
            <a :href="cartao.revisar" target="_blank" rel="noopener">Revisar no Flashcards</a>
          </p>
          <template v-else>
            <p v-if="cartao.carregando" class="origem">Buscando os baralhos…</p>
            <form v-else-if="cartao.baralhos.length" class="escolha" @submit.prevent="enviarCartao">
              <select v-model="cartao.baralho" class="campo" aria-label="Baralho">
                <option v-for="b in cartao.baralhos" :key="b.id" :value="b.id">{{ b.nome }}</option>
              </select>
              <button type="submit" class="botao primario" :disabled="cartao.enviando || !cartao.baralho">
                {{ cartao.enviando ? 'Enviando…' : 'Criar' }}
              </button>
            </form>
            <p v-if="edicao.flashcards_at" class="origem">Esta marcação já virou cartão em {{ quandoVirouCartao(edicao.flashcards_at) }}.</p>
            <p v-if="cartao.erro" class="erro-cartao">{{ cartao.erro }}</p>
          </template>
        </section>
        <div class="acoes">
          <button type="button" class="botao discreto perigo" @click="apagarDaEdicao">Apagar</button>
          <span class="linha-acoes">
            <button v-if="!cartao" type="button" class="botao" @click="abrirCartao">
              {{ edicao.flashcards_at ? 'Criar outro cartão' : 'Criar cartão' }}
            </button>
            <button type="button" class="botao primario" @click="fecharEdicao">Concluir</button>
          </span>
        </div>
      </aside>
    </template>
  </div>
</template>

<style scoped>
.leitor {
  position: relative;
  height: 100dvh;
  overflow: hidden;
  background: var(--fundo);
}

/* Fixa: mostrar os controles não redistribui o texto, porque eles flutuam sobre a página. */
.area {
  position: absolute;
  /* Deitado, o recorte da câmera fica de lado: as margens laterais seguras valem também (R40). */
  inset: calc(env(safe-area-inset-top) + 28px) env(safe-area-inset-right) calc(env(safe-area-inset-bottom) + 28px)
    env(safe-area-inset-left);
}

.area.pdf {
  display: flex;
  overflow: auto;
  inset: env(safe-area-inset-top) env(safe-area-inset-right) calc(env(safe-area-inset-bottom) + 24px) env(safe-area-inset-left);
}

.preparando {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  color: var(--texto-suave);
  font-size: 14px;
  pointer-events: none;
}

/* Com os controles escondidos, só o percentual, discreto, no pé. */
.percentual-discreto {
  position: absolute;
  right: 0;
  bottom: calc(env(safe-area-inset-bottom) + 6px);
  left: 0;
  margin: 0;
  color: var(--texto-fraco);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  pointer-events: none;
}

.barra {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 2;
  background: var(--fundo);
  transition: opacity 0.2s ease;
}

.topo {
  top: 0;
  display: flex;
  gap: var(--e1);
  align-items: center;
  padding: calc(env(safe-area-inset-top) + var(--e1)) calc(env(safe-area-inset-right) + var(--e2)) var(--e1) calc(env(safe-area-inset-left) + var(--e2));
  border-bottom: 1px solid var(--borda);
}

/* O pé respeita a barra de gestos do Android (env) e, na tela cheia, onde ela fica por cima do app,
   guarda mais um respiro. */
.base {
  bottom: 0;
  display: grid;
  gap: var(--e3);
  padding: var(--e3) calc(env(safe-area-inset-right) + var(--e3)) max(env(safe-area-inset-bottom), var(--e3)) calc(env(safe-area-inset-left) + var(--e3));
  border-top: 1px solid var(--borda);
}

.base.tela-cheia {
  padding-bottom: max(env(safe-area-inset-bottom), var(--e5));
}

.oculto {
  visibility: hidden;
  opacity: 0;
}

h1 {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-family: var(--fonte);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.icone {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  color: var(--texto-suave);
  background: transparent;
  border: 0;
  border-radius: var(--raio-p);
  cursor: pointer;
  transition: background var(--transicao), color var(--transicao);
}

.icone:hover {
  color: var(--texto);
  background: var(--superficie-2);
}

.aa {
  font-family: var(--fonte-titulo);
  font-size: 17px;
}

/* Rótulo à esquerda, o que é no meio (cortado se não couber) e o valor à direita, numa linha. */
.linha-valor {
  display: flex;
  gap: var(--e2);
  align-items: baseline;
  min-width: 0;
  margin: 0;
}

.linha-valor .rotulo-secao {
  flex: none;
  font-size: 11px;
}

.nome-meta,
.onde {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--texto-suave);
  font-size: 13px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.valor {
  flex: none;
  margin-left: auto;
  color: var(--texto);
  font-size: 12.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* A meta do plano de leitura (R35, R43): faixa própria, com o andamento do trecho de hoje. */
.meta-leitor {
  display: grid;
  gap: 6px;
  padding-bottom: var(--e3);
  border-bottom: 1px solid var(--borda);
}

.meta-leitor .rotulo-secao {
  color: var(--verde);
}

.meta-leitor.feita .rotulo-secao,
.meta-leitor.feita .valor {
  color: var(--texto-suave);
}

.livro-leitor {
  display: grid;
  gap: var(--e1);
}

.navegar {
  display: flex;
  gap: var(--e2);
  align-items: center;
  margin-inline: calc(-1 * var(--e2));
}

/* O trilho do livro: o lido em cinza e, sobre ele, o trecho da meta em verde claro; a bolinha é a
   do controle, que fica por cima com o trilho transparente. */
.trilho {
  position: relative;
  flex: 1;
  min-width: 0;
}

.trilho-fundo {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: 4px;
  overflow: hidden;
  background: var(--superficie-2);
  border-radius: 2px;
  transform: translateY(-50%);
  pointer-events: none;
}

.trilho-lido {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: var(--texto-suave);
}

.faixa-meta {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--verde) 55%, transparent);
}

input[type='range'] {
  position: relative;
  display: block;
  width: 100%;
  height: 32px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
}

input[type='range']::-webkit-slider-runnable-track {
  height: 4px;
  background: transparent;
}

input[type='range']::-moz-range-track {
  height: 4px;
  background: transparent;
}

input[type='range']::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  margin-top: -6px;
  background: var(--texto);
  border: 2px solid var(--fundo);
  border-radius: 50%;
  appearance: none;
}

input[type='range']::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--texto);
  border: 2px solid var(--fundo);
  border-radius: 50%;
}

/* "Meta concluída": acima do rodapé quando ele aparece, no pé quando não. */
.fim-da-meta {
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom) + var(--e6));
  left: 50%;
  z-index: 3;
  display: flex;
  gap: var(--e2);
  align-items: center;
  max-width: calc(100% - var(--e6));
  padding: var(--e1) var(--e1) var(--e1) var(--e4);
  color: var(--texto);
  font-size: 13px;
  background: var(--superficie-2);
  border: 1px solid var(--borda);
  border-radius: 999px;
  transform: translateX(-50%);
}

.fim-da-meta.com-controles {
  bottom: calc(max(env(safe-area-inset-bottom), var(--e3)) + 124px);
}

.fim-da-meta.com-meta {
  bottom: calc(max(env(safe-area-inset-bottom), var(--e3)) + 176px);
}

.fim-da-meta > span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.fim-da-meta .botao {
  flex: none;
  border-radius: 999px;
}

.folha-sumario li button.na-meta {
  box-shadow: inset 2px 0 0 var(--verde);
}

.selo-meta {
  margin-left: 6px;
  vertical-align: 1px;
}

.erro {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--e2);
  align-items: center;
  justify-content: center;
  padding: var(--e6);
  text-align: center;
}

.erro p {
  margin: 0;
}

.dica {
  color: var(--texto-suave);
  font-size: 14px;
}

/* A barra do texto selecionado: colada ao trecho (estiloDaBarra). */
.selecao {
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom) + var(--e4));
  left: 50%;
  z-index: 3;
  display: flex;
  align-items: center;
  max-width: calc(100vw - var(--e2));
  padding: 2px var(--e1);
  background: var(--superficie-2);
  border: 1px solid var(--borda-forte);
  border-radius: 999px;
  transform: translateX(-50%);
}

.selecao .icone {
  width: 40px;
  border-radius: 999px;
}

.selecao .cor {
  width: 36px;
}

.cor {
  width: 44px;
  height: 44px;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

/* O círculo é menor que a área de toque, para o dedo não errar a cor. */
.cor::before {
  display: block;
  width: 22px;
  height: 22px;
  margin: auto;
  background: var(--cor);
  border-radius: 50%;
  content: '';
}

.cor[aria-pressed='true']::before {
  outline: 2px solid var(--texto);
  outline-offset: 2px;
}

.cor-amarelo,
.traco-amarelo {
  --cor: var(--m-amarelo);
}

.cor-verde,
.traco-verde {
  --cor: var(--m-verde);
}

.cor-azul,
.traco-azul {
  --cor: var(--m-azul);
}

.cor-rosa,
.traco-rosa {
  --cor: var(--m-rosa);
}

.divisor {
  width: 1px;
  height: 22px;
  margin-inline: 2px;
  background: var(--borda-forte);
}

.fundo-painel {
  position: absolute;
  inset: 0;
  z-index: 3;
}

.fundo-painel.escurecer {
  background: rgb(0 0 0 / 0.55);
}

/* Folhas do leitor: sumário (de lado), ajustes (no canto) e edição da marcação (do pé). */
.folha {
  position: absolute;
  z-index: 4;
  padding: var(--e4);
  overflow-y: auto;
  background: var(--fundo);
  border: 1px solid var(--borda);
}

.folha-sumario {
  top: 0;
  bottom: 0;
  left: 0;
  width: min(360px, 90vw);
  padding-top: calc(env(safe-area-inset-top) + var(--e4));
  padding-bottom: calc(env(safe-area-inset-bottom) + var(--e4));
  padding-left: calc(env(safe-area-inset-left) + var(--e4));
  border-width: 0 1px 0 0;
}

/* Sem escurecer a página: a mudança aparece no texto enquanto se escolhe. */
.ajustes {
  top: calc(env(safe-area-inset-top) + 60px);
  right: calc(env(safe-area-inset-right) + var(--e3));
  display: grid;
  gap: var(--e4);
  width: min(340px, calc(100vw - var(--e5)));
  max-height: calc(100dvh - 80px - env(safe-area-inset-top));
  border-radius: var(--raio-g);
}

.edicao {
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  gap: var(--e3);
  width: min(560px, 100%);
  max-height: 80dvh;
  margin-inline: auto;
  padding-bottom: calc(env(safe-area-inset-bottom) + var(--e4));
  border-bottom: 0;
  border-radius: var(--raio-g) var(--raio-g) 0 0;
}

.folha-sumario > .abas {
  margin-bottom: var(--e3);
}

/* Alternâncias dos ajustes: segmentos numa faixa, o escolhido com o fundo ativo. */
.opcoes {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--superficie-2);
  border-radius: var(--raio-p);
}

.opcoes button {
  flex: 1;
  min-width: 0;
  min-height: var(--controle);
  padding: 0 var(--e1);
  font-size: 13.5px;
  color: var(--texto-suave);
  background: transparent;
  border: 0;
  border-radius: var(--raio-e);
  cursor: pointer;
}

.opcoes button[aria-pressed='true'] {
  color: var(--texto);
  font-weight: 500;
  background: var(--ativo);
}

.opcoes button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.folha-sumario ol,
.marcacoes {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.folha-sumario li button {
  width: 100%;
  min-height: 40px;
  padding: var(--e2);
  font-size: 14px;
  color: var(--texto-suave);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.folha-sumario li button:hover {
  color: var(--texto);
}

.folha-sumario li button.atual {
  color: var(--texto);
  font-weight: 600;
  background: var(--ativo);
}

.marcacoes li button {
  display: grid;
  gap: 6px;
}

.citacao {
  display: -webkit-box;
  margin: 0;
  padding-left: var(--e3);
  overflow: hidden;
  color: var(--texto);
  font-family: var(--fonte-livro);
  font-size: 15px;
  line-height: 1.45;
  border-left: 3px solid var(--cor);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.nota {
  color: var(--texto);
  font-size: 14px;
  white-space: pre-wrap;
}

.origem,
.vazio {
  color: var(--texto-suave);
  font-size: 12.5px;
}

.vazio {
  padding: var(--e4) var(--e2);
  font-size: 14px;
  text-align: left;
}

.cores {
  display: flex;
  gap: var(--e1);
}

.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--e2);
  justify-content: space-between;
}

.cartao-flashcards {
  display: grid;
  gap: var(--e2);
  padding: var(--e3);
  background: var(--superficie);
  border: 1px solid var(--borda);
  border-radius: var(--raio);
}

.cartao-flashcards p {
  margin: 0;
}

.escolha {
  display: flex;
  gap: var(--e2);
}

.escolha select {
  flex: 1;
  min-width: 0;
}

.feito {
  font-size: 14px;
  line-height: 1.5;
}

.feito a {
  display: block;
  margin-top: var(--e1);
  font-weight: 600;
}

.erro-cartao {
  color: var(--vermelho);
  font-size: 13.5px;
}

.aviso-giro {
  margin: 6px 0 0;
  color: var(--texto-suave);
  font-size: 12.5px;
  line-height: 1.4;
}

fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: 6px;
  padding: 0;
  font-family: var(--fonte);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--texto-fraco);
}

.contador {
  display: flex;
  align-items: center;
  overflow: hidden;
  background: var(--superficie-2);
  border-radius: var(--raio-p);
}

.contador button {
  flex: 1;
  height: 44px;
  color: var(--texto);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.contador button:hover:not(:disabled) {
  background: var(--ativo);
}

.contador button:disabled {
  opacity: 0.35;
  cursor: default;
}

.contador .menor {
  font-size: 14px;
}

.contador .maior {
  font-size: 22px;
}

.contador output {
  flex: none;
  width: 64px;
  color: var(--texto-suave);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

/* Celular deitado (R40) ou tela larga: a meta e o livro lado a lado, para o rodapé ocupar pouca
   altura. Cada um continua com o seu rótulo, o seu valor e a sua barra. */
@media (min-width: 700px) {
  .base:has(.meta-leitor) {
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: var(--e5);
    align-items: end;
  }

  .meta-leitor {
    align-self: stretch;
    align-content: center;
    padding: 0 var(--e5) 0 0;
    border-right: 1px solid var(--borda);
    border-bottom: 0;
  }

  .fim-da-meta.com-meta {
    bottom: calc(max(env(safe-area-inset-bottom), var(--e3)) + 124px);
  }
}

@media (max-height: 480px) {
  .base {
    padding-top: var(--e2);
  }
}
</style>
