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
      <span class="rotulo-secao">Mais informações</span>
      <button type="button" class="botao discreto icone" aria-label="Fechar" @click="emit('fechar')"><Icone nome="fechar" /></button>
    </header>
    <h2 id="titulo-pesquisa">“{{ atual.quote }}”</h2>
    <p v-if="atual.label" class="origem">{{ atual.label }}</p>

    <div class="corpo">
      <p v-if="atual.state === 'processando'" class="aviso neutro"><span class="ponto" aria-hidden="true"></span> Pesquisando em mais de uma fonte. Leva um ou dois minutos; pode continuar lendo e voltar aqui pela lista do livro.</p>
      <p v-else-if="atual.state === 'falhou' || atual.state === 'indisponivel'" class="aviso">{{ atual.state === 'falhou' ? 'A pesquisa não deu certo' : 'Sem resposta do Acervo' }}: {{ atual.error }}.</p>
      <template v-else>
        <article class="explicacao leitura" v-html="explicacao"></article>
        <section v-if="atual.sources?.length" class="fontes">
          <h3 class="rotulo-secao">Fontes consultadas</h3>
          <ol>
            <li v-for="f in atual.sources" :key="f.url">
              <a :href="f.url" target="_blank" rel="noopener">{{ f.titulo || site(f.url) }}</a>
              <span class="origem"> · {{ site(f.url) }}</span>
            </li>
          </ol>
        </section>
        <p class="origem">Pesquisado em {{ data(atual.updated_at) }}.</p>
        <section class="referencia">
          <h3 class="rotulo-secao">Virar referência</h3>
          <template v-if="atual.reference_link">
            <p class="feito">
              {{ aviso || 'Esta pesquisa já é uma Referência no Acervo, com o livro e o link de volta ao trecho.' }}
              <a :href="atual.reference_link" target="_blank" rel="noopener">Abrir no Acervo</a>
            </p>
          </template>
          <template v-else>
            <p class="origem">O texto e as fontes viram uma Referência no Acervo, com o trecho como título, o livro, o autor e o link de volta para cá.</p>
            <button type="button" class="botao primario" :disabled="ocupado" @click="virar">{{ ocupado ? 'Criando…' : 'Virar referência' }}</button>
          </template>
        </section>
      </template>
      <p v-if="erro" class="aviso">{{ erro }}</p>
    </div>

    <footer>
      <button type="button" class="botao discreto perigo" :disabled="ocupado" @click="apagar">Apagar</button>
      <span class="linha-acoes">
        <button v-if="atual.anchor" type="button" class="botao" @click="emit('ir', atual)">Ir ao trecho</button>
        <button v-if="atual.state === 'pronto' || atual.state === 'falhou'" type="button" class="botao" :disabled="ocupado" @click="pedirDeNovo">
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
  background: rgb(0 0 0 / 0.55);
}

/* Folha que sobe do pé (design system: diálogo no celular). */
.folha {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: 85dvh;
  margin-inline: auto;
  padding: var(--e4) var(--e4) calc(env(safe-area-inset-bottom) + var(--e3));
  background: var(--fundo);
  border: 1px solid var(--borda);
  border-bottom: 0;
  border-radius: var(--raio-g) var(--raio-g) 0 0;
}

header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--e2);
}

footer {
  flex-wrap: wrap;
  margin-top: var(--e3);
  padding-top: var(--e3);
  border-top: 1px solid var(--borda);
}

h2 {
  margin: var(--e1) 0 0;
  font-family: var(--fonte-livro);
  font-size: 18px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.corpo {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.explicacao {
  margin-top: var(--e3);
  font-size: 15px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.explicacao :deep(h1),
.explicacao :deep(h2),
.explicacao :deep(h3) {
  margin: var(--e4) 0 var(--e2);
  font-size: 16px;
}

.fontes,
.referencia {
  margin-top: var(--e4);
  padding-top: var(--e3);
  border-top: 1px solid var(--borda);
}

h3.rotulo-secao {
  margin-bottom: var(--e2);
}

.fontes ol {
  margin: 0;
  padding-left: var(--e5);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.origem {
  margin: var(--e1) 0;
  color: var(--texto-suave);
  font-size: 13px;
}

.referencia .origem {
  margin-bottom: var(--e2);
}

.feito {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}

.feito a {
  display: block;
  margin-top: var(--e1);
  font-weight: 600;
}

.corpo .aviso {
  margin: var(--e3) 0;
  line-height: 1.5;
}

.ponto {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: var(--e1);
  background: var(--azul);
  border-radius: 50%;
  animation: piscar 1.2s ease-in-out infinite;
}

@keyframes piscar {
  50% {
    opacity: 0.3;
  }
}
</style>
