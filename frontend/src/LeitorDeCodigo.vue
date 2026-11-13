<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

// Lê o código de barras de trás do livro (o ISBN, EAN-13 começando em 978 ou 979) pela câmera.
// Usa o BarcodeDetector do Chrome (Android e Mac); onde não existe, avisa para digitar.
const emit = defineEmits(['lido', 'fechar'])

const video = ref(null)
const erro = ref('')
let fluxo = null
let timer = null

onMounted(async () => {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    erro.value = 'Este navegador não lê código de barras. Digite o ISBN (fica embaixo do código).'
    return
  }
  try {
    const detector = new window.BarcodeDetector({ formats: ['ean_13'] })
    fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    video.value.srcObject = fluxo
    await video.value.play()
    timer = setInterval(async () => {
      if (!video.value || video.value.readyState < 2) return
      const achados = await detector.detect(video.value).catch(() => [])
      const isbn = achados.map((c) => c.rawValue).find((v) => /^97[89]\d{10}$/.test(v))
      if (isbn) {
        parar()
        emit('lido', isbn)
      }
    }, 250)
  } catch {
    erro.value = 'Não foi possível abrir a câmera. Libere o acesso nas permissões do site ou digite o ISBN.'
  }
})

function parar() {
  clearInterval(timer)
  fluxo?.getTracks().forEach((t) => t.stop())
  fluxo = null
}

onBeforeUnmount(parar)
</script>

<template>
  <div class="leitor-codigo">
    <p v-if="erro" class="erro" role="alert">{{ erro }}</p>
    <template v-else>
      <video ref="video" muted playsinline aria-label="Câmera"></video>
      <p class="dica">Aponte para o código de barras de trás do livro.</p>
    </template>
    <button type="button" class="fechar" @click="parar(); emit('fechar')">Fechar a câmera</button>
  </div>
</template>

<style scoped>
.leitor-codigo {
  display: grid;
  gap: 0.5rem;
}

video {
  width: 100%;
  max-height: 16rem;
  object-fit: cover;
  background: #000000;
  border-radius: var(--raio);
}

.dica,
.erro {
  margin: 0;
  color: var(--texto-suave);
  font-size: 0.8125rem;
}

.erro {
  color: var(--perigo);
}

.fechar {
  justify-self: start;
  min-height: 36px;
  padding: 0 0.875rem;
  font: inherit;
  font-size: 0.875rem;
  background: transparent;
  border: 1px solid var(--linha);
  border-radius: var(--raio-p);
  cursor: pointer;
}
</style>
