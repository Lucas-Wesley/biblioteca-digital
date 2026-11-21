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
    <p v-if="erro" class="aviso" role="alert">{{ erro }}</p>
    <template v-else>
      <video ref="video" muted playsinline aria-label="Câmera"></video>
      <p class="dica">Aponte para o código de barras de trás do livro.</p>
    </template>
    <button type="button" class="botao fechar" @click="parar(); emit('fechar')">Fechar a câmera</button>
  </div>
</template>

<style scoped>
.leitor-codigo {
  display: grid;
  gap: var(--e2);
}

video {
  width: 100%;
  max-height: 256px;
  object-fit: cover;
  background: var(--camera);
  border-radius: var(--raio);
}

.dica {
  margin: 0;
  color: var(--texto-suave);
  font-size: 13px;
}

.aviso {
  margin: 0;
}

.fechar {
  justify-self: start;
}
</style>
