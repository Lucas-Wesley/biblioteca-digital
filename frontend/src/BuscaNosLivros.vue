<script>
import { ref } from 'vue'

// Fora do componente: abrir um trecho troca a tela pelo leitor, e ao voltar a busca continua ali.
const pedido = ref('')
const buscado = ref('')
const resultados = ref([])
const estado = ref(null)
</script>

<script setup>
import { computed } from 'vue'
import Icone from './Icone.vue'

// Busca no texto dos livros (R32): o servidor guarda o texto de cada livro, página por página.
const emit = defineEmits(['abrir'])

const buscando = ref(false)
const erro = ref('')

const semBusca = computed(() => estado.value?.failed ?? [])

async function buscar() {
  const q = pedido.value.trim()
  if (!q) return
  buscando.value = true
  erro.value = ''
  try {
    const resposta = await fetch(`/api/search?limit=30&q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(10000) })
    if (!resposta.ok) throw new Error((await resposta.json()).error)
    const corpo = await resposta.json()
    resultados.value = corpo.results
    estado.value = corpo.state
    buscado.value = q
  } catch (falha) {
    erro.value = falha instanceof TypeError || falha.name === 'TimeoutError'
      ? 'A busca precisa da conexão com a sua rede.'
      : falha.message || 'Não foi possível buscar.'
  } finally {
    buscando.value = false
  }
}

// O servidor marca as palavras achadas entre **; o texto vira pedaços, nunca HTML.
function pedacos(trecho) {
  return trecho.split('**').map((texto, i) => ({ texto, achado: i % 2 === 1 }))
}

function onde(r) {
  return [`p. ${r.page}`, r.chapter].filter(Boolean).join(' · ')
}
</script>

<template>
  <h1>Buscar nos meus livros</h1>

  <form class="busca" role="search" @submit.prevent="buscar">
    <input v-model="pedido" type="search" placeholder="Uma palavra, um nome, um assunto" aria-label="O que buscar nos livros" enterkeyhint="search" />
    <button type="submit" :disabled="buscando || !pedido.trim()" aria-label="Buscar"><Icone nome="pesquisar" /></button>
  </form>

  <p v-if="erro" class="falha" role="alert">{{ erro }}</p>

  <template v-else-if="estado">
    <p class="suave" aria-live="polite">
      <template v-if="resultados.length">{{ resultados.length === 1 ? '1 trecho' : `${resultados.length} trechos` }} para “{{ buscado }}”</template>
      <template v-else>Nada encontrado para “{{ buscado }}”.</template>
      <template v-if="estado.indexed < estado.books"> Busca em {{ estado.indexed }} de {{ estado.books }} livros.</template>
    </p>

    <ul class="resultados">
      <li v-for="r in resultados" :key="`${r.book_id}-${r.page}-${r.anchor}`">
        <button type="button" @click="emit('abrir', r.book_id, r.anchor)">
          <span class="livro">{{ r.title }}</span>
          <span class="suave">{{ onde(r) }}</span>
          <span class="trecho"><template v-for="(p, i) in pedacos(r.snippet)" :key="i"><mark v-if="p.achado">{{ p.texto }}</mark><template v-else>{{ p.texto }}</template></template></span>
        </button>
      </li>
    </ul>

    <details v-if="semBusca.length" class="fora">
      <summary class="suave">{{ semBusca.length === 1 ? '1 livro fica fora da busca' : `${semBusca.length} livros ficam fora da busca` }}</summary>
      <ul>
        <li v-for="f in semBusca" :key="f.title"><span>{{ f.title }}</span> <span class="suave">— {{ f.error }}</span></li>
      </ul>
    </details>
  </template>

  <p v-else class="suave">Busca no texto de todos os livros da biblioteca. Toque num trecho para abrir o livro naquela página.</p>
</template>

<style scoped>
h1 {
  margin: 0 0 1.5rem;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.busca {
  display: flex;
  gap: 0.5rem;
  max-width: 44rem;
  margin-bottom: 1rem;
}

.busca input {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0 0.75rem;
  color: var(--texto);
  font: inherit;
  background: var(--superficie);
  border: 1px solid var(--linha);
  border-radius: var(--raio-p);
}

.busca button {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  color: var(--destaque-texto);
  background: var(--destaque);
  border: 0;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.busca button:disabled {
  opacity: 0.4;
  cursor: default;
}

.busca button :deep(svg) {
  width: 20px;
  height: 20px;
}

.suave {
  color: var(--texto-suave);
  font-size: 0.8125rem;
}

.falha {
  color: var(--perigo);
}

.resultados {
  display: grid;
  max-width: 44rem;
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
}

.resultados li {
  border-bottom: 1px solid var(--linha);
}

.resultados button {
  display: grid;
  gap: 0.25rem;
  width: 100%;
  padding: 0.875rem 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.resultados button:hover .livro {
  text-decoration: underline;
}

.livro {
  font-weight: 500;
}

.trecho {
  font-family: var(--leitura);
  font-size: 0.9375rem;
  line-height: 1.55;
}

mark {
  color: inherit;
  background: var(--azul-fundo);
  border-radius: 3px;
  box-shadow: 0 0 0 2px var(--azul-fundo);
}

.fora {
  max-width: 44rem;
  margin-top: 1.5rem;
}

.fora summary {
  cursor: pointer;
}

.fora ul {
  margin: 0.5rem 0 0;
  padding-left: 1.25rem;
  font-size: 0.875rem;
}
</style>
