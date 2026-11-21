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
  <div class="topo-pagina">
    <h1>Buscar nos meus livros</h1>
    <form class="meio busca-form" role="search" @submit.prevent="buscar">
      <div class="busca">
        <Icone nome="pesquisar" />
        <input v-model="pedido" class="campo" type="search" placeholder="Uma palavra, um nome, um assunto" aria-label="O que buscar nos livros" enterkeyhint="search" />
      </div>
      <button type="submit" class="botao primario" :disabled="buscando || !pedido.trim()" aria-label="Buscar">Buscar</button>
    </form>
  </div>

  <p v-if="erro" class="aviso falha" role="alert">{{ erro }}</p>

  <template v-else-if="estado">
    <p class="suave contagem" aria-live="polite">
      <template v-if="resultados.length">{{ resultados.length === 1 ? '1 trecho' : `${resultados.length} trechos` }} para “{{ buscado }}”</template>
      <template v-else>Nada encontrado para “{{ buscado }}”.</template>
      <template v-if="estado.indexed < estado.books"> Busca em {{ estado.indexed }} de {{ estado.books }} livros.</template>
    </p>

    <ul class="lista resultados">
      <li v-for="r in resultados" :key="`${r.book_id}-${r.page}-${r.anchor}`">
        <button type="button" @click="emit('abrir', r.book_id, r.anchor)">
          <span class="livro">{{ r.title }} <span class="pequeno">{{ onde(r) }}</span></span>
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

  <p v-else class="explicacao">Busca no texto de todos os livros da biblioteca. Toque num trecho para abrir o livro naquela página.</p>
</template>

<style scoped>
.busca-form {
  display: flex;
  gap: var(--e2);
}

.busca-form .busca {
  flex: 1;
  min-width: 0;
}

.busca .campo {
  padding-right: var(--e3);
}

.aviso {
  max-width: var(--leitura);
}

.contagem,
.explicacao {
  max-width: var(--leitura);
  margin: 0 0 var(--e3);
  color: var(--texto-suave);
}

.resultados {
  max-width: var(--leitura);
}

.resultados button {
  display: grid;
  gap: var(--e1);
  width: 100%;
  padding: var(--e3) 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.resultados button:hover .livro {
  color: var(--link);
}

.livro {
  font-size: 14.5px;
  font-weight: 600;
  transition: color var(--transicao);
}

.livro .pequeno {
  margin-left: var(--e1);
}

.trecho {
  color: var(--texto-suave);
  font-family: var(--fonte-livro);
  font-size: 15px;
  line-height: 1.55;
}

mark {
  color: var(--texto);
  background: var(--azul-fundo);
  border-radius: 3px;
  box-shadow: 0 0 0 2px var(--azul-fundo);
}

.fora {
  max-width: var(--leitura);
  margin-top: var(--e5);
}

.fora summary {
  cursor: pointer;
}

.fora ul {
  margin: var(--e2) 0 0;
  padding-left: var(--e5);
  font-size: 13.5px;
}
</style>
