<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ePub from 'epubjs'

const props = defineProps({
  livro: { type: Object, required: true },
})
defineEmits(['fechar'])

const area = ref(null)
const localizacao = ref('')
const erro = ref(false)

let livroEpub
let rendition

function anterior() {
  rendition?.prev()
}

function proxima() {
  rendition?.next()
}

function aoTeclar(evento) {
  if (evento.key === 'ArrowLeft') anterior()
  if (evento.key === 'ArrowRight') proxima()
}

onMounted(async () => {
  window.addEventListener('keydown', aoTeclar)
  try {
    livroEpub = ePub(`/api/books/${encodeURIComponent(props.livro.id)}/file`, { openAs: 'epub' })
    rendition = livroEpub.renderTo(area.value, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'none',
    })
    rendition.on('relocated', (local) => {
      localizacao.value = local.start.cfi
    })
    rendition.on('keydown', aoTeclar)
    await rendition.display()
  } catch {
    erro.value = true
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', aoTeclar)
  livroEpub?.destroy()
})
</script>

<template>
  <div class="leitor" :data-localizacao="localizacao">
    <header>
      <button type="button" @click="$emit('fechar')">Voltar</button>
      <h1>{{ livro.title }}</h1>
    </header>
    <p v-if="erro" class="erro">Não foi possível abrir este livro.</p>
    <div ref="area" class="area"></div>
    <footer>
      <button type="button" @click="anterior">Anterior</button>
      <button type="button" @click="proxima">Próxima</button>
    </footer>
  </div>
</template>

<style scoped>
.leitor {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

header,
footer {
  display: flex;
  flex: none;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 1rem;
}

footer {
  justify-content: space-between;
}

h1 {
  margin: 0;
  font-size: 1rem;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.area {
  flex: 1;
  min-height: 0;
}

.erro {
  padding: 0 1rem;
  color: #a4262c;
}

button {
  min-height: 44px;
  padding: 0 1rem;
  font: inherit;
  color: inherit;
  background: #eef2f6;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}
</style>
