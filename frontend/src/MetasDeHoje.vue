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
  <section class="quadro metas-de-hoje" aria-labelledby="t-hoje">
    <div class="quadro-topo">
      <h2 id="t-hoje" class="rotulo-secao">{{ titulo }}</h2>
      <span v-if="deHoje.length" class="pequeno">{{ deHoje.length === 1 ? '1 meta' : `${deHoje.length} metas` }}</span>
    </div>
    <p v-if="erroAoAbrir" class="aviso falha" role="alert">{{ erroAoAbrir }}</p>
    <ul v-if="deHoje.length" class="lista metas">
      <li v-for="{ plano, meta } in deHoje" :key="meta.id">
        <button type="button" class="texto-meta" @click="emit('abrir-plano', plano)">
          <span class="nome-livro">{{ plano.title }}</span>
          <span class="rotulo-meta">{{ rotuloDaMeta(plano, meta) }}</span>
          <span v-if="tempoDe(plano, meta)" class="tempo-meta">{{ tempoDe(plano, meta) }} de leitura</span>
        </button>
        <div class="acoes-meta">
          <button
            v-if="plano.book_id"
            type="button"
            class="botao icone play"
            :aria-label="textoDoPlay(plano)"
            :title="textoDoPlay(plano)"
            :disabled="abrindoMeta === plano.id"
            @click="lerMeta(plano)"
          ><Icone nome="play" :tamanho="14" /></button>
          <MarcaMeta :estado="meta.state" :rotulo="`${plano.title}: ${rotuloDaMeta(plano, meta)}`" @mudar="marcarMeta(planos, plano, meta, $event)" />
        </div>
      </li>
    </ul>
    <p v-else class="sem-metas">Nenhuma meta para hoje.</p>
    <p v-if="atrasadasNoTotal" class="atraso">
      {{ atrasadasNoTotal === 1 ? '1 meta ficou para trás' : `${atrasadasNoTotal} metas ficaram para trás` }}. Abra o plano para marcar ou reorganizar.
    </p>
  </section>
</template>

<style scoped>
.metas-de-hoje > .aviso {
  margin: 0 0 var(--e2);
}

.sem-metas {
  margin: 0;
  color: var(--texto-suave);
}

.metas li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--e2) var(--e3);
  align-items: center;
  padding: var(--e2) 0;
}

.texto-meta {
  display: grid;
  flex: 1 1 160px;
  gap: 1px;
  min-width: 0;
  padding: 0;
  text-align: left;
  background: transparent;
  border: 0;
  cursor: pointer;
}

.texto-meta:hover .rotulo-meta {
  color: var(--link);
}

.nome-livro {
  color: var(--texto-suave);
  font-size: 12.5px;
}

.rotulo-meta {
  font-size: 14.5px;
  font-weight: 600;
  overflow-wrap: anywhere;
  transition: color var(--transicao);
}

.tempo-meta {
  color: var(--texto-fraco);
  font-size: 12.5px;
}

.acoes-meta {
  display: flex;
  flex: none;
  gap: var(--e2);
  align-items: center;
  margin-left: auto;
}

.play:disabled {
  cursor: progress;
}

.atraso {
  margin: var(--e3) 0 0;
  color: var(--vermelho);
  font-size: 13px;
}
</style>
