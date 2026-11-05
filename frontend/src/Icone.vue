<script setup>
defineProps({ nome: { type: String, required: true } })
</script>

<template>
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path v-if="nome === 'voltar'" d="M15 5l-7 7 7 7" />
    <path v-else-if="nome === 'avancar'" d="M9 5l7 7-7 7" />
    <path v-else-if="nome === 'lista'" d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
    <path v-else-if="nome === 'menu'" d="M4 7h16M4 12h16M4 17h16" />
    <path v-else-if="nome === 'nota'" d="M5 19l1-4L16.5 4.5a2.1 2.1 0 013 3L9 18l-4 1z" />
    <path v-else-if="nome === 'fechar'" d="M6 6l12 12M18 6L6 18" />
    <template v-else-if="nome === 'baixar'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v8M8.5 12.5l3.5 3.5 3.5-3.5" />
    </template>
    <template v-else-if="nome === 'baixado'">
      <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
      <path d="M8 12.5l2.7 2.7L16 9.5" stroke="var(--fundo)" />
    </template>
  </svg>
</template>
