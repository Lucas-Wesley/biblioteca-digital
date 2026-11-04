<script setup>
import { onMounted, ref } from 'vue'

const versao = ref('')
const apiOk = ref(null)

onMounted(async () => {
  try {
    const resposta = await fetch('/api/health')
    const saude = await resposta.json()
    apiOk.value = resposta.ok
    versao.value = saude.version
  } catch {
    apiOk.value = false
  }
})
</script>

<template>
  <main class="inicio">
    <h1>Hello World</h1>
    <p>Biblioteca Digital</p>
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

.estado {
  color: #5a6776;
  font-size: 0.875rem;
}
</style>
