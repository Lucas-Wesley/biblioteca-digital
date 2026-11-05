<script setup>
import { preferencias, TEMAS } from './preferencias.js'
</script>

<template>
  <div class="temas" role="group" aria-label="Tema">
    <button
      v-for="(tema, chave) in TEMAS"
      :key="chave"
      type="button"
      :aria-label="tema.rotulo"
      :aria-pressed="preferencias.tema === chave"
      :title="tema.rotulo"
      :style="{ background: tema.fundo, color: tema.texto }"
      @click="preferencias.tema = chave"
    >
      Aa
    </button>
  </div>
</template>

<style scoped>
.temas {
  display: flex;
  gap: 0.75rem;
}

button {
  width: 44px;
  height: 44px;
  padding: 0;
  font-size: 0.875rem;
  border: 1px solid var(--linha);
  border-radius: 50%;
  cursor: pointer;
}

button[aria-pressed='true'] {
  outline: 2px solid var(--destaque);
  outline-offset: 2px;
}
</style>
