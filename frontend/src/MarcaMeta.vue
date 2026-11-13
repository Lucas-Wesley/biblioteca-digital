<script setup>
// Os dois botões de uma meta: Li e Não li. Tocar no que já está marcado desmarca.
const props = defineProps({ estado: { type: String, default: '' }, rotulo: { type: String, required: true } })
const emit = defineEmits(['mudar'])

function tocar(estado) {
  emit('mudar', props.estado === estado ? '' : estado)
}
</script>

<template>
  <div class="marca-meta" role="group" :aria-label="`Marcar: ${rotulo}`">
    <button type="button" class="li" :aria-pressed="estado === 'lida'" @click="tocar('lida')">Li</button>
    <button type="button" class="nao-li" :aria-pressed="estado === 'nao-lida'" @click="tocar('nao-lida')">Não li</button>
  </div>
</template>

<style scoped>
.marca-meta {
  display: flex;
  flex: none;
  gap: 0.25rem;
}

button {
  min-width: 3.25rem;
  min-height: 34px;
  padding: 0 0.625rem;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--texto-suave);
  background: transparent;
  border: 1px solid var(--linha);
  border-radius: 999px;
  cursor: pointer;
}

button:hover {
  color: var(--texto);
  background: var(--superficie);
}

.li[aria-pressed='true'] {
  color: var(--marca-texto);
  font-weight: 600;
  background: var(--marca);
  border-color: var(--marca);
}

.nao-li[aria-pressed='true'] {
  color: var(--vermelho);
  font-weight: 600;
  background: var(--vermelho-fundo);
  border-color: transparent;
}
</style>
