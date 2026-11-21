<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icone from './Icone.vue'

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
    <p v-if="erro" class="aviso" role="alert">{{ erro }}</p>
    <template v-else>
      <div class="visor">
        <video ref="video" muted playsinline aria-label="Câmera"></video>
        <button type="button" class="disparo" :disabled="!pronta" aria-label="Fotografar esta página" @click="fotografar"></button>
      </div>
      <p class="dica">Uma foto por página do sumário, de frente e com luz. {{ fotos.length ? `${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'}.` : '' }}</p>
      <ul v-if="fotos.length" class="miniaturas">
        <li v-for="(f, i) in fotos" :key="f.url">
          <img :src="f.url" :alt="`Foto ${i + 1}`" />
          <button type="button" :aria-label="`Tirar a foto ${i + 1}`" @click="tirar(i)"><Icone nome="fechar" :tamanho="14" /></button>
        </li>
      </ul>
    </template>
    <div class="acoes">
      <button v-if="fotos.length" type="button" class="botao primario" @click="concluir">Ler o sumário</button>
      <button type="button" class="botao" @click="parar(); emit('fechar')">Cancelar</button>
    </div>
  </div>
</template>

<style scoped>
.camera {
  display: grid;
  gap: var(--e3);
}

.visor {
  position: relative;
}

video {
  display: block;
  width: 100%;
  max-height: 60dvh;
  object-fit: cover;
  background: var(--camera);
  border-radius: var(--raio);
}

.disparo {
  position: absolute;
  bottom: var(--e4);
  left: 50%;
  width: 64px;
  height: 64px;
  padding: 0;
  background: var(--camera-disparo);
  border: 4px solid color-mix(in srgb, var(--camera-disparo) 45%, transparent);
  border-radius: 50%;
  background-clip: padding-box;
  transform: translateX(-50%);
  cursor: pointer;
}

.disparo:active {
  transform: translateX(-50%) scale(0.92);
}

.disparo:disabled {
  opacity: 0.5;
}

.dica {
  margin: 0;
  color: var(--texto-suave);
  font-size: 13px;
}

.aviso {
  margin: 0;
}

.miniaturas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--e2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.miniaturas li {
  position: relative;
}

.miniaturas img {
  display: block;
  width: 64px;
  height: 88px;
  object-fit: cover;
  border: 1px solid var(--borda);
  border-radius: var(--raio-p);
}

.miniaturas button {
  position: absolute;
  top: -8px;
  right: -8px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--texto);
  background: var(--superficie-2);
  border: 1px solid var(--borda-forte);
  border-radius: 50%;
  cursor: pointer;
}

.acoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--e2);
}
</style>
