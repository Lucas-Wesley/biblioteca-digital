<script setup>
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icone from './Icone.vue'
import { apagarPesquisa, lerPesquisa, pesquisarDeNovo, virarReferencia } from './dados.js'

// Mais informações (R39): a folha com o resultado da pesquisa de um trecho, feita pelo Acervo. O livro
// não muda; a pesquisa pode ser pedida de novo ou virar uma Referência no Acervo.
const props = defineProps({
  livroId: { type: String, required: true },
  pesquisa: { type: Object, required: true },
})
const emit = defineEmits(['fechar', 'mudou', 'apagada', 'ir'])

const atual = ref(props.pesquisa)
const ocupado = ref(false)
const erro = ref('')
const aviso = ref('')
let espera

watch(
  () => props.pesquisa,
  (nova) => {
    atual.value = nova
    acompanhar()
  },
)

const explicacao = computed(() => (atual.value.explanation ? DOMPurify.sanitize(marked.parse(atual.value.explanation)) : ''))
const site = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
const data = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '')

// Enquanto pesquisa, pergunta de novo a cada 4 s.
function acompanhar() {
  clearTimeout(espera)
  if (atual.value.state !== 'processando') return
  espera = setTimeout(async () => {
    try {
      atual.value = await lerPesquisa(props.livroId, atual.value.id)
      emit('mudou', atual.value)
    } catch (falha) {
      erro.value = falha.message
    }
    acompanhar()
  }, 4000)
}
acompanhar()

async function agir(acao) {
  ocupado.value = true
  erro.value = ''
  try {
    await acao()
  } catch (falha) {
    erro.value = falha.message
  } finally {
    ocupado.value = false
  }
}

const pedirDeNovo = () =>
  agir(async () => {
    atual.value = await pesquisarDeNovo(props.livroId, atual.value.id)
    aviso.value = ''
    emit('mudou', atual.value)
    acompanhar()
  })

const virar = () =>
  agir(async () => {
    const r = await virarReferencia(props.livroId, atual.value.id)
    atual.value = { ...atual.value, reference_link: r.reference_link }
    aviso.value = r.existed ? 'Esta pesquisa já era uma Referência no Acervo.' : 'Virou uma Referência no Acervo.'
    emit('mudou', atual.value)
  })

function apagar() {
  if (!confirm('Apagar esta pesquisa?')) return
  agir(async () => {
    await apagarPesquisa(props.livroId, atual.value.id)
    emit('apagada', atual.value.id)
  })
}

onBeforeUnmount(() => clearTimeout(espera))
</script>

<template>
  <div class="fundo-folha" @click="emit('fechar')"></div>
  <aside class="folha" role="dialog" aria-modal="true" aria-labelledby="titulo-pesquisa">
    <header>
      <span class="rotulo">Mais informações</span>
      <button type="button" class="icone" aria-label="Fechar" @click="emit('fechar')"><Icone nome="fechar" /></button>
    </header>
    <h2 id="titulo-pesquisa">“{{ atual.quote }}”</h2>
    <p v-if="atual.label" class="origem">{{ atual.label }}</p>

    <div class="corpo">
      <p v-if="atual.state === 'processando'" class="aviso"><span class="ponto" aria-hidden="true"></span> Pesquisando em mais de uma fonte. Leva um ou dois minutos; pode continuar lendo e voltar aqui pela lista do livro.</p>
      <p v-else-if="atual.state === 'falhou' || atual.state === 'indisponivel'" class="aviso erro">{{ atual.state === 'falhou' ? 'A pesquisa não deu certo' : 'Sem resposta do Acervo' }}: {{ atual.error }}.</p>
      <template v-else>
        <article class="explicacao" v-html="explicacao"></article>
        <section v-if="atual.sources?.length" class="fontes">
          <h3>Fontes consultadas</h3>
          <ol>
            <li v-for="f in atual.sources" :key="f.url">
              <a :href="f.url" target="_blank" rel="noopener">{{ f.titulo || site(f.url) }}</a>
              <span class="origem"> · {{ site(f.url) }}</span>
            </li>
          </ol>
        </section>
        <p class="origem">Pesquisado em {{ data(atual.updated_at) }}.</p>
        <section class="referencia">
          <h3>Virar referência</h3>
          <template v-if="atual.reference_link">
            <p class="feito">
              {{ aviso || 'Esta pesquisa já é uma Referência no Acervo, com o livro e o link de volta ao trecho.' }}
              <a :href="atual.reference_link" target="_blank" rel="noopener">Abrir no Acervo</a>
            </p>
          </template>
          <template v-else>
            <p class="origem">O texto e as fontes viram uma Referência no Acervo, com o trecho como título, o livro, o autor e o link de volta para cá.</p>
            <button type="button" class="botao-texto principal" :disabled="ocupado" @click="virar">{{ ocupado ? 'Criando…' : 'Virar referência' }}</button>
          </template>
        </section>
      </template>
      <p v-if="erro" class="aviso erro">{{ erro }}</p>
    </div>

    <footer>
      <button type="button" class="botao-texto perigo" :disabled="ocupado" @click="apagar">Apagar</button>
      <span>
        <button v-if="atual.anchor" type="button" class="botao-texto" @click="emit('ir', atual)">Ir ao trecho</button>
        <button v-if="atual.state === 'pronto' || atual.state === 'falhou'" type="button" class="botao-texto" :disabled="ocupado" @click="pedirDeNovo">
          {{ atual.state === 'falhou' ? 'Tentar de novo' : 'Pedir de novo' }}
        </button>
      </span>
    </footer>
  </aside>
</template>

<style scoped>
.fundo-folha {
  position: absolute;
  inset: 0;
  z-index: 5;
  background: rgb(0 0 0 / 30%);
}

.folha {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  width: min(36rem, 100%);
  max-height: 85dvh;
  margin-inline: auto;
  padding: 1rem 1rem calc(env(safe-area-inset-bottom) + 0.5rem);
  background: var(--fundo);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 8px 40px rgb(0 0 0 / 22%);
}

header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

footer {
  flex-wrap: wrap;
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--linha);
}

.rotulo {
  color: var(--texto-suave);
  font-size: 0.8125rem;
  font-weight: 600;
}

.icone {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: inherit;
  background: transparent;
  border: 0;
  cursor: pointer;
}

h2 {
  margin: 0.25rem 0 0;
  font-family: var(--fonte-leitura, inherit);
  font-size: 1.125rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.corpo {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.explicacao {
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.explicacao :deep(h1),
.explicacao :deep(h2),
.explicacao :deep(h3) {
  margin: 1rem 0 0.375rem;
  font-size: 1rem;
}

.explicacao :deep(a) {
  color: var(--marca);
}

.fontes,
.referencia {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--linha);
}

h3 {
  margin: 0 0 0.375rem;
  font-size: 0.9375rem;
}

.fontes ol {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.9rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.fontes a,
.feito a {
  color: var(--marca);
}

.origem {
  margin: 0.25rem 0;
  color: var(--texto-suave);
  font-size: 0.8125rem;
}

.referencia .origem {
  margin-bottom: 0.5rem;
}

.feito {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
}

.feito a {
  display: block;
  margin-top: 0.25rem;
  font-weight: 600;
}

.aviso {
  margin: 0.75rem 0;
  padding: 0.75rem;
  font-size: 0.875rem;
  line-height: 1.5;
  background: var(--superficie);
  border-radius: 10px;
}

.aviso.erro {
  color: var(--perigo);
}

.ponto {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 0.25rem;
  background: var(--marca);
  border-radius: 50%;
  animation: piscar 1.2s ease-in-out infinite;
}

@keyframes piscar {
  50% {
    opacity: 0.3;
  }
}

.botao-texto {
  min-height: 44px;
  padding: 0 1rem;
  font: inherit;
  font-weight: 600;
  color: inherit;
  background: transparent;
  border: 0;
  cursor: pointer;
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

.perigo {
  color: var(--perigo);
  font-weight: 400;
}
</style>
