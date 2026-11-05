<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { abrirEpub } from './motores/epub.js'
import { abrirPdf } from './motores/pdf.js'
import { FONTE, ZOOM, preferencias } from './preferencias.js'

const ESPERA_PARA_SALVAR = 1000
const MARGENS = [
  { valor: 'pequena', rotulo: 'Pequena' },
  { valor: 'media', rotulo: 'Média' },
  { valor: 'grande', rotulo: 'Grande' },
]

const props = defineProps({
  livro: { type: Object, required: true },
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
const controlesVisiveis = ref(true)

const ehPdf = computed(() => props.livro.format === 'pdf')
const urlProgresso = `/api/books/${encodeURIComponent(props.livro.id)}/progress`

let motor
let desmontado = false
// Abrir o livro ou mudar a fonte também move a posição; só salva depois que a leitura avançar.
let navegou = false
let ultimoSalvo = ''
let temporizador

function salvarAgora() {
  clearTimeout(temporizador)
  if (!navegou || !localizacao.value || localizacao.value === ultimoSalvo) return
  ultimoSalvo = localizacao.value
  fetch(urlProgresso, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ position: localizacao.value, percent: percentual.value }),
    // Garante o envio mesmo com a aba fechando.
    keepalive: true,
  }).catch(() => {
    ultimoSalvo = ''
  })
}

function aoMudar(novo) {
  localizacao.value = novo.posicao
  percentual.value = novo.percentual
  rotulo.value = novo.rotulo
  capitulo.value = novo.capitulo
  if (navegou) {
    clearTimeout(temporizador)
    temporizador = setTimeout(salvarAgora, ESPERA_PARA_SALVAR)
  }
}

function anterior() {
  navegou = true
  motor?.anterior()
}

function proxima() {
  navegou = true
  motor?.proxima()
}

function irPara(destino) {
  navegou = true
  painel.value = null
  motor?.irPara(destino)
}

function aoDeslizar(direcao) {
  if (direcao === 'proxima') proxima()
  else anterior()
}

// Como no Kindle: laterais viram a página, o centro mostra ou esconde os controles.
function aoClicar(x) {
  if (painel.value) {
    painel.value = null
    return
  }
  const fracao = x / window.innerWidth
  if (fracao < 0.3) anterior()
  else if (fracao > 0.7) proxima()
  else controlesVisiveis.value = !controlesVisiveis.value
}

function aoTeclar(evento) {
  if (evento.key === 'ArrowLeft') anterior()
  if (evento.key === 'ArrowRight') proxima()
  if (evento.key === 'Escape') painel.value = null
}

function alternarPainel(nome) {
  painel.value = painel.value === nome ? null : nome
}

function ajustar(chave, limites, sentido) {
  const novo = preferencias[chave] + sentido * limites.passo
  preferencias[chave] = Math.min(Math.max(novo, limites.minimo), limites.maximo)
}

function aoEsconderPagina() {
  if (document.visibilityState === 'hidden') salvarAgora()
}

async function buscarProgresso() {
  try {
    const resposta = await fetch(urlProgresso)
    return resposta.ok ? await resposta.json() : {}
  } catch {
    return {}
  }
}

onMounted(async () => {
  window.addEventListener('keydown', aoTeclar)
  window.addEventListener('pagehide', salvarAgora)
  document.addEventListener('visibilitychange', aoEsconderPagina)
  try {
    const salvo = await buscarProgresso()
    ultimoSalvo = salvo.position ?? ''
    const abrir = ehPdf.value ? abrirPdf : abrirEpub
    const aberto = await abrir({
      livro: props.livro,
      area: area.value,
      posicao: salvo.position,
      preferencias,
      aoMudar,
      aoClicar,
      aoDeslizar,
      aoTeclar,
    })
    if (desmontado) {
      aberto.destruir()
      return
    }
    motor = aberto
    sumario.value = motor.sumario()
  } catch {
    erro.value = true
  }
})

watch(
  () => [preferencias.tema, preferencias.fonte, preferencias.zoom],
  () => motor?.aplicar(preferencias),
)

watch(
  () => preferencias.margem,
  async () => {
    await nextTick()
    motor?.redimensionar()
  },
)

onBeforeUnmount(() => {
  desmontado = true
  salvarAgora()
  window.removeEventListener('keydown', aoTeclar)
  window.removeEventListener('pagehide', salvarAgora)
  document.removeEventListener('visibilitychange', aoEsconderPagina)
  motor?.destruir()
})
</script>

<template>
  <div class="leitor" :data-localizacao="localizacao">
    <header :class="{ oculto: !controlesVisiveis }">
      <button type="button" @click="$emit('fechar')">Voltar</button>
      <h1>{{ livro.title }}</h1>
      <button type="button" :aria-expanded="painel === 'sumario'" @click="alternarPainel('sumario')">Sumário</button>
      <button type="button" :aria-expanded="painel === 'ajustes'" @click="alternarPainel('ajustes')">Ajustes</button>
    </header>

    <p v-if="erro" class="erro">Não foi possível abrir este livro.</p>
    <div
      ref="area"
      class="area"
      :class="[ehPdf ? 'pdf' : 'epub', `margem-${preferencias.margem}`]"
    ></div>

    <footer :class="{ oculto: !controlesVisiveis }">
      <button type="button" @click="anterior">Anterior</button>
      <p class="progresso">
        <span v-if="rotulo" class="rotulo">{{ rotulo }}</span>
        <span>{{ Math.round(percentual * 100) }}%</span>
      </p>
      <button type="button" @click="proxima">Próxima</button>
    </footer>

    <div v-if="painel" class="fundo-painel" @click="painel = null"></div>

    <aside v-if="painel === 'sumario'" class="painel sumario" aria-label="Sumário">
      <h2>Sumário</h2>
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
      <p v-else>Este livro não tem sumário.</p>
    </aside>

    <aside v-if="painel === 'ajustes'" class="painel ajustes" aria-label="Ajustes de leitura">
      <h2>Ajustes</h2>
      <fieldset>
        <legend>Tema</legend>
        <div class="opcoes">
          <button type="button" :aria-pressed="preferencias.tema === 'claro'" @click="preferencias.tema = 'claro'">Claro</button>
          <button type="button" :aria-pressed="preferencias.tema === 'escuro'" @click="preferencias.tema = 'escuro'">Escuro</button>
        </div>
      </fieldset>
      <fieldset v-if="ehPdf">
        <legend>Zoom</legend>
        <div class="contador">
          <button type="button" aria-label="Diminuir zoom" :disabled="preferencias.zoom <= ZOOM.minimo" @click="ajustar('zoom', ZOOM, -1)">−</button>
          <output>{{ preferencias.zoom }}%</output>
          <button type="button" aria-label="Aumentar zoom" :disabled="preferencias.zoom >= ZOOM.maximo" @click="ajustar('zoom', ZOOM, 1)">+</button>
        </div>
      </fieldset>
      <template v-else>
        <fieldset>
          <legend>Tamanho da fonte</legend>
          <div class="contador">
            <button type="button" aria-label="Diminuir fonte" :disabled="preferencias.fonte <= FONTE.minimo" @click="ajustar('fonte', FONTE, -1)">−</button>
            <output>{{ preferencias.fonte }}%</output>
            <button type="button" aria-label="Aumentar fonte" :disabled="preferencias.fonte >= FONTE.maximo" @click="ajustar('fonte', FONTE, 1)">+</button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Margens</legend>
          <div class="opcoes">
            <button
              v-for="margem in MARGENS"
              :key="margem.valor"
              type="button"
              :aria-pressed="preferencias.margem === margem.valor"
              @click="preferencias.margem = margem.valor"
            >
              {{ margem.rotulo }}
            </button>
          </div>
        </fieldset>
      </template>
    </aside>
  </div>
</template>

<style scoped>
.leitor {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: var(--fundo);
}

header,
footer {
  display: flex;
  flex: none;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 1rem;
}

/* Some sem mudar o tamanho da área: redistribuir o texto a cada toque seria pior. */
.oculto {
  visibility: hidden;
}

footer {
  justify-content: space-between;
}

h1 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 1rem;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.progresso {
  display: flex;
  flex: 1;
  gap: 0.5rem;
  justify-content: center;
  min-width: 0;
  margin: 0;
  color: var(--texto-suave);
  font-size: 0.875rem;
}

.rotulo {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.area {
  flex: 1;
  min-height: 0;
  margin-inline: auto;
  width: 100%;
}

/* A coluna limita a largura da linha no computador; no celular, vale o recuo. */
.area.epub.margem-pequena {
  width: min(100%, 64rem);
}

.area.epub.margem-media {
  width: min(calc(100% - 1.5rem), 46rem);
}

.area.epub.margem-grande {
  width: min(calc(100% - 3.5rem), 36rem);
}

.area.pdf {
  display: flex;
  overflow: auto;
}

.area.pdf :deep(canvas) {
  display: block;
  margin: auto;
}

:root[data-theme='escuro'] .area.pdf :deep(canvas) {
  filter: invert(1) hue-rotate(180deg);
}

.erro {
  padding: 0 1rem;
  color: var(--perigo);
}

button {
  min-height: 44px;
  padding: 0 1rem;
  background: var(--superficie);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

.fundo-painel {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 35%);
}

.painel {
  position: absolute;
  top: 0;
  bottom: 0;
  width: min(22rem, 88vw);
  padding: 1rem;
  overflow-y: auto;
  background: var(--fundo);
  box-shadow: 0 0 24px rgb(0 0 0 / 30%);
}

.sumario {
  left: 0;
}

.ajustes {
  right: 0;
}

.painel h2 {
  margin: 0 0 1rem;
  font-size: 1.125rem;
}

.sumario ol {
  display: grid;
  gap: 0.125rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sumario button {
  width: 100%;
  height: auto;
  padding-block: 0.625rem;
  text-align: left;
  background: transparent;
}

.sumario button.atual {
  font-weight: 600;
  background: var(--superficie);
}

fieldset {
  margin: 0 0 1.25rem;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: 0.5rem;
  padding: 0;
  color: var(--texto-suave);
  font-size: 0.875rem;
}

.opcoes {
  display: flex;
  gap: 0.25rem;
}

.opcoes button {
  flex: 1;
  padding-inline: 0.5rem;
}

.opcoes button[aria-pressed='true'] {
  color: var(--destaque-texto);
  background: var(--destaque);
}

.contador {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  justify-content: space-between;
}

.contador button {
  width: 3.5rem;
  padding: 0;
  font-size: 1.25rem;
}
</style>
