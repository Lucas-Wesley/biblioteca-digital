<script setup>
import { computed, onMounted, ref } from 'vue'
import Leitor from './Leitor.vue'

const versao = ref('')
const apiOk = ref(null)
const livros = ref([])
const livroAberto = ref(null)
const enviando = ref(false)
const adicionados = ref(0)
const falhas = ref([])

const livrosOrdenados = computed(() =>
  [...livros.value].sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')),
)

onMounted(async () => {
  try {
    const [saude, listaLivros] = await Promise.all([fetch('/api/health'), fetch('/api/books')])
    apiOk.value = saude.ok
    versao.value = (await saude.json()).version
    if (listaLivros.ok) livros.value = await listaLivros.json()
  } catch {
    apiOk.value = false
  }
})

async function enviarArquivo(arquivo) {
  const formulario = new FormData()
  formulario.append('file', arquivo)
  try {
    const resposta = await fetch('/api/books', { method: 'POST', body: formulario })
    const corpo = await resposta.json()
    if (!resposta.ok) throw new Error(corpo.error)
    livros.value.push(corpo)
    adicionados.value++
  } catch (erro) {
    falhas.value.push(`${arquivo.name}: ${erro.message}`)
  }
}

async function enviar(evento) {
  const arquivos = [...evento.target.files]
  // Limpa o campo para o mesmo arquivo poder ser escolhido de novo.
  evento.target.value = ''
  enviando.value = true
  adicionados.value = 0
  falhas.value = []
  for (const arquivo of arquivos) await enviarArquivo(arquivo)
  enviando.value = false
}
</script>

<template>
  <Leitor v-if="livroAberto" :livro="livroAberto" @fechar="livroAberto = null" />
  <main v-else class="inicio">
    <h1>Hello World</h1>
    <p>Biblioteca Digital</p>

    <div class="cabecalho">
      <h2>Livros</h2>
      <label class="enviar" :class="{ ocupado: enviando }">
        {{ enviando ? 'Enviando…' : 'Enviar EPUB' }}
        <input
          type="file"
          accept=".epub,application/epub+zip"
          multiple
          :disabled="enviando"
          @change="enviar"
        />
      </label>
    </div>

    <div class="envio" aria-live="polite">
      <p v-if="adicionados">
        {{ adicionados === 1 ? '1 livro adicionado.' : `${adicionados} livros adicionados.` }}
      </p>
      <p v-for="falha in falhas" :key="falha" class="falha">{{ falha }}</p>
    </div>

    <ul v-if="livros.length" class="livros">
      <li v-for="livro in livrosOrdenados" :key="livro.id">
        <button type="button" @click="livroAberto = livro">
          <img v-if="livro.has_cover" :src="`/api/books/${encodeURIComponent(livro.id)}/cover`" alt="" />
          <span v-else class="sem-capa"></span>
          <span class="dados">
            <span class="titulo">{{ livro.title }}</span>
            <span v-if="livro.author" class="autor">{{ livro.author }}</span>
          </span>
        </button>
      </li>
    </ul>
    <p v-else-if="apiOk">Nenhum livro encontrado.</p>

    <p v-if="apiOk === false" class="estado">API indisponível</p>
    <p v-else-if="apiOk" class="estado">API ok · versão {{ versao.slice(0, 7) }}</p>
  </main>
</template>

<style scoped>
.inicio {
  max-width: 40rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}

.cabecalho {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}

.enviar {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  min-height: 44px;
  padding: 0 1rem;
  color: #ffffff;
  background: #1f3a5f;
  border-radius: 6px;
  cursor: pointer;
}

.enviar.ocupado {
  opacity: 0.7;
  cursor: progress;
}

.enviar:focus-within {
  outline: 2px solid #1f3a5f;
  outline-offset: 2px;
}

.enviar input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.envio p {
  margin: 0.5rem 0;
}

.falha {
  color: #a4262c;
}

.livros {
  display: grid;
  gap: 0.5rem;
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
}

.livros button {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  width: 100%;
  min-height: 44px;
  padding: 0.5rem;
  font: inherit;
  text-align: left;
  color: inherit;
  background: #eef2f6;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

.livros img,
.sem-capa {
  flex: none;
  width: 3rem;
  height: 4.5rem;
  object-fit: cover;
  background: #d5dde6;
  border-radius: 3px;
}

.dados {
  display: grid;
  gap: 0.125rem;
  min-width: 0;
}

.titulo {
  overflow-wrap: anywhere;
}

.autor {
  color: #5a6776;
  font-size: 0.875rem;
}

.estado {
  margin-top: 2rem;
  color: #5a6776;
  font-size: 0.875rem;
}
</style>
