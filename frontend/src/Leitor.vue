<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import Icone from './Icone.vue'
import SeletorTema from './SeletorTema.vue'
import { apagarAnotacao, criarCartao, lerAnotacoes, lerBaralhos, lerProgresso, salvarAnotacao, salvarProgresso, ultimoBaralho } from './dados.js'
import { criarContador } from './leitura.js'
import { abrirEpub } from './motores/epub.js'
import { abrirPdf } from './motores/pdf.js'
import { abrirTextoPdf } from './motores/texto-pdf.js'
import { ESTILOS, FONTE, ZOOM, ajustesDoLivro, guardarAjustes, mostrarTema, preferencias } from './preferencias.js'

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
}

async function alternarTelaCheia() {
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
  relogio = setInterval(contador.tique, 1000)
  try {
    const [salvo, marcas] = await Promise.all([lerProgresso(props.livro.id), lerAnotacoes(props.livro.id)])
    ultimoSalvo = salvo.position ?? ''
    anotacoes.value = marcas
    await abrirMotor(salvo.position, salvo.percent)
    if (props.ancora) await motor?.irParaAncora(props.ancora)
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
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  motor?.destruir()
})
</script>

<template>
  <div class="leitor" :data-localizacao="localizacao" @pointerdown="contador.atividade" @wheel.passive="contador.atividade">
    <div ref="area" class="area" :class="ehPdf ? (emTexto ? 'texto' : 'pdf') : 'epub'"></div>

    <p v-if="abrindo && emTexto" class="preparando">Preparando o texto…</p>

    <div v-if="erro" class="erro">
      <p>Não foi possível abrir este livro.</p>
      <p class="dica">Sem conexão com a sua rede, só os livros baixados abrem.</p>
      <button type="button" class="botao-texto" @click="$emit('fechar')">Voltar ao início</button>
    </div>

    <p v-if="!controlesVisiveis && !selecao" class="discreto" aria-hidden="true">{{ percentualExibido }}%</p>

    <header class="barra topo" :class="{ oculto: !controlesVisiveis }">
      <button type="button" class="icone" aria-label="Voltar" @click="$emit('fechar')"><Icone nome="voltar" /></button>
      <h1>{{ livro.title }}</h1>
      <button type="button" class="icone" aria-label="Sumário" :aria-expanded="painel === 'lista'" @click="alternarPainel('lista')"><Icone nome="lista" /></button>
      <button
        v-if="telaCheiaDisponivel"
        type="button"
        class="icone"
        :aria-label="telaCheia ? 'Sair da tela cheia' : 'Tela cheia'"
        :aria-pressed="telaCheia"
        @click="alternarTelaCheia"
      ><Icone :nome="telaCheia ? 'recolher' : 'expandir'" /></button>
      <button type="button" class="icone aa" aria-label="Ajustes" :aria-expanded="painel === 'ajustes'" @click="alternarPainel('ajustes')">Aa</button>
    </header>

    <footer class="barra base" :class="{ oculto: !controlesVisiveis }">
      <button type="button" class="icone" aria-label="Anterior" @click="anterior"><Icone nome="voltar" /></button>
      <div class="percurso">
        <input
          type="range"
          min="0"
          :max="PASSOS_DA_BARRA"
          :value="Math.round((arrasto ?? percentual) * PASSOS_DA_BARRA)"
          :style="{ '--andamento': `${(arrasto ?? percentual) * 100}%` }"
          aria-label="Progresso da leitura"
          @input="arrasto = Number($event.target.value) / PASSOS_DA_BARRA"
          @change="saltarNaBarra"
        />
        <p class="progresso">
          <span v-if="rotulo" class="rotulo">{{ rotulo }}</span>
          <span class="numero">{{ percentualExibido }}%</span>
        </p>
      </div>
      <button type="button" class="icone" aria-label="Próxima" @click="proxima"><Icone nome="avancar" /></button>
    </footer>

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
        <button type="button" class="icone" aria-label="Marcar com nota" @click="criarMarcacao('amarelo', true)"><Icone nome="nota" /></button>
      </template>
      <button type="button" class="icone" aria-label="Copiar" @click="copiarSelecao"><Icone nome="copiar" /></button>
      <button type="button" class="icone" aria-label="Pesquisar na Web" @click="pesquisarSelecao"><Icone nome="pesquisar" /></button>
    </div>

    <div v-if="painel" class="fundo-painel" :class="{ escurecer: painel === 'lista' }" @click="painel = null"></div>

    <aside v-if="painel === 'lista'" class="painel sumario" aria-label="Sumário e marcações">
      <div class="abas" role="group">
        <button type="button" :aria-pressed="abaLista === 'capitulos'" @click="abaLista = 'capitulos'">Capítulos</button>
        <button type="button" :aria-pressed="abaLista === 'marcacoes'" @click="abaLista = 'marcacoes'">Marcações</button>
      </div>
      <template v-if="abaLista === 'capitulos'">
        <ol v-if="sumario.length">
          <li v-for="item in sumario" :key="`${item.destino}-${item.rotulo}`">
            <button
              type="button"
              :class="{ atual: item.destino === capitulo }"
              :aria-current="item.destino === capitulo ? 'true' : undefined"
              :style="{ paddingLeft: `${0.75 + item.nivel}rem` }"
              @click="irPara(item.destino)"
            >
              {{ item.rotulo }}
            </button>
          </li>
        </ol>
        <p v-else class="vazio">Este livro não tem sumário.</p>
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

    <aside v-if="painel === 'ajustes'" class="painel ajustes" aria-label="Ajustes de leitura">
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

    <template v-if="edicao">
      <div class="fundo-painel escurecer" @click="fecharEdicao"></div>
      <aside class="painel edicao" aria-label="Editar marcação">
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
        <textarea v-model="edicao.note" rows="4" placeholder="Escreva uma nota" aria-label="Nota"></textarea>
        <section v-if="cartao" class="cartao" aria-label="Criar cartão">
          <p v-if="cartao.revisar" class="feito">
            Cartão pedido. A IA monta a frente e o verso, e você aprova no Flashcards.
            <a :href="cartao.revisar" target="_blank" rel="noopener">Revisar no Flashcards</a>
          </p>
          <template v-else>
            <p v-if="cartao.carregando" class="origem">Buscando os baralhos…</p>
            <form v-else-if="cartao.baralhos.length" class="escolha" @submit.prevent="enviarCartao">
              <select v-model="cartao.baralho" aria-label="Baralho">
                <option v-for="b in cartao.baralhos" :key="b.id" :value="b.id">{{ b.nome }}</option>
              </select>
              <button type="submit" class="botao-texto principal" :disabled="cartao.enviando || !cartao.baralho">
                {{ cartao.enviando ? 'Enviando…' : 'Criar' }}
              </button>
            </form>
            <p v-if="edicao.flashcards_at" class="origem">Esta marcação já virou cartão em {{ quandoVirouCartao(edicao.flashcards_at) }}.</p>
            <p v-if="cartao.erro" class="erro-cartao">{{ cartao.erro }}</p>
          </template>
        </section>
        <div class="acoes">
          <button type="button" class="botao-texto perigo" @click="apagarDaEdicao">Apagar</button>
          <span>
            <button v-if="!cartao" type="button" class="botao-texto" @click="abrirCartao">
              {{ edicao.flashcards_at ? 'Criar outro cartão' : 'Criar cartão' }}
            </button>
            <button type="button" class="botao-texto" @click="fecharEdicao">Concluir</button>
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
  inset: calc(env(safe-area-inset-top) + 1.75rem) 0 calc(env(safe-area-inset-bottom) + 1.75rem);
}

.area.pdf {
  display: flex;
  overflow: auto;
  inset: env(safe-area-inset-top) 0 calc(env(safe-area-inset-bottom) + 1.5rem);
}

.preparando {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  color: var(--texto-suave);
  font-size: 0.875rem;
  pointer-events: none;
}

.discreto {
  position: absolute;
  right: 0;
  bottom: calc(env(safe-area-inset-bottom) + 0.375rem);
  left: 0;
  margin: 0;
  color: var(--texto-suave);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
  pointer-events: none;
}

.barra {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 2;
  display: flex;
  gap: 0.25rem;
  align-items: center;
  padding: 0.25rem 0.5rem;
  background: var(--vidro);
  backdrop-filter: saturate(180%) blur(20px);
  transition: opacity 0.2s ease;
}

.topo {
  top: 0;
  padding-top: calc(env(safe-area-inset-top) + 0.25rem);
}

.base {
  bottom: 0;
  padding-bottom: calc(env(safe-area-inset-bottom) + 0.25rem);
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
  font-size: 0.9375rem;
  font-weight: 600;
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
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.aa {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.0625rem;
}

.percurso {
  flex: 1;
  min-width: 0;
}

input[type='range'] {
  display: block;
  width: 100%;
  height: 20px;
  margin: 0;
  background: transparent;
  cursor: pointer;
  appearance: none;
}

input[type='range']::-webkit-slider-runnable-track {
  height: 3px;
  background: linear-gradient(to right, var(--destaque) var(--andamento), var(--superficie-forte) var(--andamento));
  border-radius: 2px;
}

input[type='range']::-moz-range-track {
  height: 3px;
  background: linear-gradient(to right, var(--destaque) var(--andamento), var(--superficie-forte) var(--andamento));
  border-radius: 2px;
}

input[type='range']::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -5.5px;
  background: var(--destaque);
  border-radius: 50%;
  appearance: none;
}

input[type='range']::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: var(--destaque);
  border: 0;
  border-radius: 50%;
}

.progresso {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  min-width: 0;
  margin: 0;
  color: var(--texto-suave);
  font-size: 0.75rem;
}

.rotulo {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.numero {
  flex: none;
  font-variant-numeric: tabular-nums;
}

.erro {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
}

.erro p {
  margin: 0;
}

.dica {
  color: var(--texto-suave);
  font-size: 0.875rem;
}

.botao-texto {
  min-height: 44px;
  padding: 0 1rem;
  font-weight: 600;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.perigo {
  color: var(--perigo);
  font-weight: 400;
}

.selecao {
  position: absolute;
  bottom: calc(env(safe-area-inset-bottom) + 1rem);
  left: 50%;
  z-index: 3;
  display: flex;
  align-items: center;
  max-width: calc(100vw - 0.5rem);
  padding: 0.125rem 0.25rem;
  background: var(--fundo);
  border: 1px solid var(--linha);
  border-radius: 999px;
  box-shadow: 0 6px 24px rgb(0 0 0 / 18%);
  transform: translateX(-50%);
}

.selecao .icone {
  width: 40px;
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
  width: 24px;
  height: 24px;
  margin: auto;
  background: var(--cor);
  border-radius: 50%;
  content: '';
}

.cor[aria-pressed='true']::before {
  outline: 2px solid var(--destaque);
  outline-offset: 2px;
}

.cor-amarelo,
.traco-amarelo {
  --cor: #ffd60a;
}

.cor-verde,
.traco-verde {
  --cor: #5fd38d;
}

.cor-azul,
.traco-azul {
  --cor: #64c8ff;
}

.cor-rosa,
.traco-rosa {
  --cor: #ff8fb8;
}

.divisor {
  width: 1px;
  height: 22px;
  margin-inline: 0.125rem;
  background: var(--linha);
}

.fundo-painel {
  position: absolute;
  inset: 0;
  z-index: 3;
}

.fundo-painel.escurecer {
  background: rgb(0 0 0 / 30%);
}

.painel {
  position: absolute;
  z-index: 4;
  padding: 1rem;
  overflow-y: auto;
  background: var(--fundo);
  box-shadow: 0 8px 40px rgb(0 0 0 / 22%);
}

.sumario {
  top: 0;
  bottom: 0;
  left: 0;
  width: min(24rem, 90vw);
  padding-top: calc(env(safe-area-inset-top) + 1rem);
}

/* Sem escurecer a página: a mudança aparece no texto enquanto se escolhe. */
.ajustes {
  top: calc(env(safe-area-inset-top) + 3.5rem);
  right: 0.75rem;
  display: grid;
  gap: 1rem;
  width: min(21rem, calc(100vw - 1.5rem));
  max-height: calc(100dvh - 5rem);
  border-radius: 16px;
}

.edicao {
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  gap: 0.75rem;
  width: min(32rem, 100%);
  max-height: 80dvh;
  margin-inline: auto;
  padding-bottom: calc(env(safe-area-inset-bottom) + 1rem);
  border-radius: 16px 16px 0 0;
}

.abas,
.opcoes {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--superficie);
  border-radius: 10px;
}

.abas {
  margin-bottom: 0.75rem;
}

.abas button,
.opcoes button {
  flex: 1;
  min-width: 0;
  min-height: 40px;
  padding: 0 0.25rem;
  font-size: 0.875rem;
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}

.abas button[aria-pressed='true'],
.opcoes button[aria-pressed='true'] {
  font-weight: 600;
  background: var(--fundo);
  box-shadow: 0 1px 3px rgb(0 0 0 / 14%);
}

.sumario ol,
.marcacoes {
  display: grid;
  gap: 0.125rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sumario li button {
  width: 100%;
  min-height: 44px;
  padding: 0.625rem 0.75rem;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}

.sumario li button.atual {
  font-weight: 600;
  background: var(--superficie);
}

.marcacoes li button {
  display: grid;
  gap: 0.375rem;
}

.citacao {
  display: -webkit-box;
  margin: 0;
  padding-left: 0.625rem;
  overflow: hidden;
  font-family: 'Literata', Georgia, serif;
  font-size: 0.9375rem;
  line-height: 1.45;
  border-left: 3px solid var(--cor);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.nota {
  white-space: pre-wrap;
  font-size: 0.875rem;
}

.origem,
.vazio {
  color: var(--texto-suave);
  font-size: 0.75rem;
}

.vazio {
  padding: 1rem 0.75rem;
  font-size: 0.875rem;
}

.cores {
  display: flex;
  gap: 0.25rem;
}

textarea {
  width: 100%;
  padding: 0.75rem;
  font: inherit;
  color: inherit;
  background: var(--superficie);
  border: 0;
  border-radius: 10px;
  resize: vertical;
}

.acoes {
  display: flex;
  justify-content: space-between;
}

.cartao {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--superficie);
  border-radius: 10px;
}

.cartao p {
  margin: 0;
}

.escolha {
  display: flex;
  gap: 0.5rem;
}

.escolha select {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 0.75rem;
  font: inherit;
  color: inherit;
  background: var(--fundo);
  border: 1px solid var(--linha);
  border-radius: 10px;
}

.botao-texto.principal {
  color: var(--marca-texto);
  background: var(--marca);
  border-radius: 10px;
}

.botao-texto:disabled {
  opacity: 0.5;
  cursor: default;
}

.feito {
  font-size: 0.875rem;
  line-height: 1.5;
}

.feito a {
  display: block;
  margin-top: 0.25rem;
  font-weight: 600;
  color: var(--marca);
}

.erro-cartao {
  color: var(--vermelho);
  font-size: 0.875rem;
}

fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: 0.375rem;
  padding: 0;
  color: var(--texto-suave);
  font-size: 0.75rem;
}

.contador {
  display: flex;
  align-items: center;
  overflow: hidden;
  background: var(--superficie);
  border-radius: 10px;
}

.contador button {
  flex: 1;
  height: 48px;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.contador button:disabled {
  opacity: 0.35;
  cursor: default;
}

.contador .menor {
  font-size: 0.875rem;
}

.contador .maior {
  font-size: 1.375rem;
}

.contador output {
  flex: none;
  width: 4rem;
  color: var(--texto-suave);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
</style>
