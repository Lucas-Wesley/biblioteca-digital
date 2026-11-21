<script setup>
import { preferencias, TEMAS } from './preferencias.js'

// O tema do livro aberto (claro, sépia ou escuro), nos Ajustes do leitor. O do app fica em Ajustes.
const props = defineProps({ alvo: { type: Object, default: () => preferencias } })
</script>

<template>
  <div class="temas" role="group" aria-label="Tema">
    <button
      v-for="(tema, chave) in TEMAS"
      :key="chave"
      type="button"
      :aria-label="tema.rotulo"
      :aria-pressed="props.alvo.tema === chave"
      :title="tema.rotulo"
      :style="{ background: tema.fundo, color: tema.texto }"
      @click="props.alvo.tema = chave"
    >
      Aa
    </button>
  </div>
</template>

<style scoped>
.temas {
  display: flex;
  gap: var(--e3);
}

button {
  width: 44px;
  height: 44px;
  padding: 0;
  font-family: var(--fonte-titulo);
  font-size: 15px;
  border: 1px solid var(--borda-forte);
  border-radius: 50%;
  cursor: pointer;
}

button[aria-pressed='true'] {
  outline: 2px solid var(--texto);
  outline-offset: 2px;
}
</style>
