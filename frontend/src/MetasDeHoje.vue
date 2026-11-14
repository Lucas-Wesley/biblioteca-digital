<script setup>
import { computed, ref } from 'vue'
import Icone from './Icone.vue'
import MarcaMeta from './MarcaMeta.vue'
import { ancorasDaMeta, marcarMeta, metaParaLer, resumo, ritmoDeLeitura, rotuloDaMeta, tempoDaMeta } from './planos.js'

// As metas de hoje, de todos os planos, para marcar ou ler sem abrir cada um (R35, R38).
// Aparece nos Planos de leitura e no Início, antes do "Continuar lendo".
const props = defineProps({
  planos: { type: Array, required: true },
  livros: { type: Array, required: true },
  hoje: { type: String, required: true },
  registros: { type: Array, default: () => [] },
  titulo: { type: String, default: 'Hoje' },
})
const emit = defineEmits(['abrir-plano', 'abrir'])

const abrindoMeta = ref('')
const erroAoAbrir = ref('')

const comResumo = computed(() => props.planos.map((plano) => ({ plano, r: resumo(plano, props.hoje) })))
const deHoje = computed(() => comResumo.value.flatMap(({ plano, r }) => r.hoje.map((meta) => ({ plano, meta }))))
const atrasadasNoTotal = computed(() => comResumo.value.filter((x) => !x.r.concluido).reduce((n, x) => n + x.r.atrasadas, 0))

const tempoDe = (plano, meta) => tempoDaMeta(plano, meta, ritmoDeLeitura(props.registros, plano.book_id))

// O play: abre o livro digital no começo da meta para ler (a primeira ainda não lida).
async function lerMeta(plano) {
  erroAoAbrir.value = ''
  const livro = props.livros.find((l) => l.id === plano.book_id)
  if (!livro) {
    erroAoAbrir.value = `"${plano.title}" não está mais na biblioteca.`
    return
  }
  const meta = metaParaLer(plano)
  let ancora = ''
  abrindoMeta.value = plano.id
  try {
    if (meta) ancora = (await ancorasDaMeta(plano, meta)).inicio
  } catch {
    // Sem achar o ponto (fora de casa, por exemplo), o livro abre onde parou.
  } finally {
    abrindoMeta.value = ''
  }
  emit('abrir', livro, ancora, plano.id)
}

function textoDoPlay(plano) {
  const meta = metaParaLer(plano)
  return meta ? `Ler a meta: ${rotuloDaMeta(plano, meta)}` : `Abrir ${plano.title}`
}
</script>

<template>
  <section class="secao" aria-labelledby="t-hoje">
    <h2 id="t-hoje" class="rotulo">{{ titulo }}</h2>
    <p v-if="erroAoAbrir" class="falha" role="alert">{{ erroAoAbrir }}</p>
    <ul v-if="deHoje.length" class="metas">
      <li v-for="{ plano, meta } in deHoje" :key="meta.id">
        <button type="button" class="texto-meta" @click="emit('abrir-plano', plano)">
          <span class="nome-livro">{{ plano.title }}</span>
          <span class="rotulo-meta">{{ rotuloDaMeta(plano, meta) }}</span>
          <span v-if="tempoDe(plano, meta)" class="tempo-meta">{{ tempoDe(plano, meta) }} de leitura</span>
        </button>
        <button
          v-if="plano.book_id"
          type="button"
          class="play pequeno"
          :aria-label="textoDoPlay(plano)"
          :title="textoDoPlay(plano)"
          :disabled="abrindoMeta === plano.id"
          @click="lerMeta(plano)"
        ><Icone nome="play" /></button>
        <MarcaMeta :estado="meta.state" :rotulo="`${plano.title}: ${rotuloDaMeta(plano, meta)}`" @mudar="marcarMeta(planos, plano, meta, $event)" />
      </li>
    </ul>
    <p v-else class="vazio">Nenhuma meta para hoje.</p>
    <p v-if="atrasadasNoTotal" class="atraso">
      {{ atrasadasNoTotal === 1 ? '1 meta ficou para trás' : `${atrasadasNoTotal} metas ficaram para trás` }}. Abra o plano para marcar ou reorganizar.
    </p>
  </section>
</template>

<style scoped>
.secao {
  max-width: 48rem;
  margin-bottom: 2.25rem;
}

.secao > .rotulo {
  margin: 0 0 0.75rem;
}

.vazio {
  color: var(--texto-suave);
  font-size: 0.9375rem;
}

.falha {
  color: var(--perigo);
}

.metas {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--linha);
}

.metas li {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.625rem 0;
  border-bottom: 1px solid var(--linha);
}

.texto-meta {
  display: grid;
  flex: 1;
  gap: 0.125rem;
  min-width: 0;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.nome-livro {
  color: var(--texto-suave);
  font-size: 0.8125rem;
}

.tempo-meta {
  color: var(--texto-fraco);
  font-size: 0.75rem;
}

.rotulo-meta {
  font-size: 0.9375rem;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.atraso {
  margin: 0.75rem 0 0;
  color: var(--vermelho);
  font-size: 0.875rem;
}

.play {
  display: grid;
  flex: none;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--marca-texto);
  background: var(--marca);
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.play :deep(svg) {
  width: 16px;
  height: 16px;
  margin-left: 2px;
}

.play:disabled {
  opacity: 0.6;
  cursor: progress;
}
</style>
