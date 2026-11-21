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
  gap: var(--e1);
}

button {
  min-width: 44px;
  height: var(--controle);
  padding: 0 var(--e2);
  font-size: 13px;
  font-weight: 500;
  color: var(--texto-suave);
  background: transparent;
  border: 1px solid var(--borda);
  border-radius: var(--raio-p);
  cursor: pointer;
  transition: background var(--transicao), color var(--transicao), border-color var(--transicao);
}

button:hover {
  color: var(--texto);
  border-color: var(--borda-forte);
}

.li[aria-pressed='true'] {
  color: var(--verde);
  background: var(--verde-fundo);
  border-color: transparent;
}

.nao-li[aria-pressed='true'] {
  color: var(--vermelho);
  background: var(--vermelho-fundo);
  border-color: transparent;
}
</style>
