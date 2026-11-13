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
    <path v-else-if="nome === 'expandir'" d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    <path v-else-if="nome === 'recolher'" d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />
    <path v-else-if="nome === 'livro'" d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2zM12 6.5v13" />
    <path v-else-if="nome === 'inicio'" d="M4 10.5L12 4l8 6.5V19a1 1 0 01-1 1h-4.5v-5.5h-5V20H5a1 1 0 01-1-1z" />
    <path v-else-if="nome === 'grafico'" d="M5 20v-8M12 20V5M19 20v-5" />
    <path v-else-if="nome === 'enviar'" d="M12 15V4.5M7.5 9L12 4.5 16.5 9M5 15v3.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V15" />
    <template v-else-if="nome === 'busca-texto'">
      <path d="M4 6h13M4 11h6M4 16h5" />
      <circle cx="15.5" cy="15" r="3.5" />
      <path d="M18 17.5l2.5 2.5" />
    </template>
    <template v-else-if="nome === 'calendario'">
      <rect x="4" y="5.5" width="16" height="14.5" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4M8.5 14.5l2 2 4-4" />
    </template>
    <template v-else-if="nome === 'ajustes'">
      <path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9" />
      <circle cx="15" cy="7.5" r="2" />
      <circle cx="9" cy="16.5" r="2" />
    </template>
    <template v-else-if="nome === 'copiar'">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5.5 15H5a1.5 1.5 0 01-1.5-1.5v-9A1.5 1.5 0 015 3h9a1.5 1.5 0 011.5 1.5V5" />
    </template>
    <template v-else-if="nome === 'pesquisar'">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </template>
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
