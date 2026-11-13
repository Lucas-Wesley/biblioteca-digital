<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

// Câmera dentro do app para fotografar o sumário (R36): uma foto por página, sem sair do formulário.
const emit = defineEmits(['pronto', 'fechar'])

const video = ref(null)
const erro = ref('')
const fotos = ref([]) // { blob, url }
const pronta = ref(false)
let fluxo = null

onMounted(async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    erro.value = 'Este navegador não abre a câmera aqui. Use "Da galeria".'
    return
  }
  try {
    // Pede a maior resolução que a câmera traseira der: o texto do sumário precisa de nitidez.
    fluxo = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
    })
    video.value.srcObject = fluxo
    await video.value.play()
    pronta.value = true
  } catch {
    erro.value = 'Não foi possível abrir a câmera. Libere o acesso nas permissões do site ou use "Da galeria".'
  }
})

async function fotografar() {
  const v = video.value
  if (!v?.videoWidth) return
  const tela = document.createElement('canvas')
  tela.width = v.videoWidth
  tela.height = v.videoHeight
  tela.getContext('2d').drawImage(v, 0, 0)
  const blob = await new Promise((ok) => tela.toBlob(ok, 'image/jpeg', 0.9))
  if (blob) fotos.value = [...fotos.value, { blob, url: URL.createObjectURL(blob) }]
}

function tirar(i) {
  URL.revokeObjectURL(fotos.value[i].url)
  fotos.value = fotos.value.filter((_, j) => j !== i)
}

function parar() {
  fluxo?.getTracks().forEach((t) => t.stop())
  fluxo = null
}

function concluir() {
  const blobs = fotos.value.map((f) => f.blob)
  parar()
  emit('pronto', blobs)
}

onBeforeUnmount(() => {
  parar()
  fotos.value.forEach((f) => URL.revokeObjectURL(f.url))
})
</script>

<template>
  <div class="camera">
    <p v-if="erro" class="erro" role="alert">{{ erro }}</p>
    <template v-else>
      <div class="visor">
        <video ref="video" muted playsinline aria-label="Câmera"></video>
        <button type="button" class="disparo" :disabled="!pronta" aria-label="Fotografar esta página" @click="fotografar"></button>
      </div>
      <p class="dica">Uma foto por página do sumário, de frente e com luz. {{ fotos.length ? `${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'}.` : '' }}</p>
      <ul v-if="fotos.length" class="miniaturas">
        <li v-for="(f, i) in fotos" :key="f.url">
          <img :src="f.url" :alt="`Foto ${i + 1}`" />
          <button type="button" :aria-label="`Tirar a foto ${i + 1}`" @click="tirar(i)">×</button>
        </li>
      </ul>
    </template>
    <div class="acoes">
      <button v-if="fotos.length" type="button" class="principal" @click="concluir">Ler o sumário</button>
      <button type="button" class="secundario" @click="parar(); emit('fechar')">Cancelar</button>
    </div>
  </div>
</template>

<style scoped>
.camera {
  display: grid;
  gap: 0.625rem;
}

.visor {
  position: relative;
}

video {
  display: block;
  width: 100%;
  max-height: 60dvh;
  object-fit: cover;
  background: #000000;
  border-radius: var(--raio);
}

.disparo {
  position: absolute;
  bottom: 0.875rem;
  left: 50%;
  width: 64px;
  height: 64px;
  padding: 0;
  background: #ffffff;
  border: 4px solid rgb(255 255 255 / 45%);
  border-radius: 50%;
  background-clip: padding-box;
  box-shadow: 0 2px 10px rgb(0 0 0 / 35%);
  transform: translateX(-50%);
  cursor: pointer;
}

.disparo:active {
  transform: translateX(-50%) scale(0.92);
}

.disparo:disabled {
  opacity: 0.5;
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

.miniaturas {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.miniaturas li {
  position: relative;
}

.miniaturas img {
  display: block;
  width: 4rem;
  height: 5.5rem;
  object-fit: cover;
  border-radius: 6px;
  box-shadow: 0 0 0 1px var(--linha);
}

.miniaturas button {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 26px;
  height: 26px;
  padding: 0;
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  color: #ffffff;
  background: rgb(0 0 0 / 70%);
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.acoes {
  display: flex;
  gap: 0.5rem;
}

.principal,
.secundario {
  min-height: 42px;
  padding: 0 1rem;
  font: inherit;
  font-size: 0.875rem;
  border-radius: var(--raio-p);
  cursor: pointer;
}

.principal {
  font-weight: 600;
  color: var(--destaque-texto);
  background: var(--destaque);
  border: 0;
}

.secundario {
  color: var(--texto);
  background: transparent;
  border: 1px solid var(--superficie-forte);
}
</style>
