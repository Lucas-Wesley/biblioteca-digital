<script setup>
import { onMounted, ref } from 'vue'
import Leitor from './Leitor.vue'

const versao = ref('')
const apiOk = ref(null)
const livros = ref([])
const livroAberto = ref(null)

onMounted(async () => {
  try {
    const [saude, listaLivros] = await Promise.all([fetch('/api/health'), fetch('/api/books')])
    apiOk.value = saude.ok
    versao.value = (await saude.json()).version
    livros.value = await listaLivros.json()
  } catch {
    apiOk.value = false
  }
})
</script>

<template>
  <Leitor v-if="livroAberto" :livro="livroAberto" @fechar="livroAberto = null" />
  <main v-else class="inicio">
    <h1>Hello World</h1>
    <p>Biblioteca Digital</p>

    <h2>Livros</h2>
    <ul v-if="livros.length" class="livros">
      <li v-for="livro in livros" :key="livro.id">
        <button type="button" @click="livroAberto = livro">{{ livro.title }}</button>
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

.livros {
  list-style: none;
  margin: 0;
  padding: 0;
}

.livros button {
  width: 100%;
  min-height: 44px;
  padding: 0.5rem 1rem;
  font: inherit;
  text-align: left;
  color: inherit;
  background: #eef2f6;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

.estado {
  margin-top: 2rem;
  color: #5a6776;
  font-size: 0.875rem;
}
</style>
